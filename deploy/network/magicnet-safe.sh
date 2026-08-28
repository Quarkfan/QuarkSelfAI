#!/bin/bash

set -euo pipefail

readonly TARGET_SSID="blacklake"
readonly TARGET_GATEWAY="172.16.40.2"
readonly TARGET_PREFIX="172.16.40"
readonly SOURCE_PREFIX="172.16.48"
readonly NETWORKSETUP="/usr/sbin/networksetup"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
[[ "${EUID}" -eq 0 ]] || die "must run through the reviewed privileged helper"
mode="${1:-on}"
[[ "$mode" == "on" || "$mode" == "off" ]] || die "usage: $0 [on|off]"

wifi_device="$($NETWORKSETUP -listallhardwareports | awk '
  /^Hardware Port: (Wi-Fi|AirPort)$/ { wifi = 1; next }
  /^Hardware Port:/ { wifi = 0 }
  wifi && /^Device: / { print $2; exit }
')"
[[ -n "$wifi_device" ]] || die "Wi-Fi device not found"
wifi_service_line="$($NETWORKSETUP -listnetworkserviceorder | awk -v device="$wifi_device" '
  /^\([0-9*]+\) / { service = $0; next }
  index($0, "Device: " device ")") { print service; exit }
')"
[[ -n "$wifi_service_line" && "$wifi_service_line" != "(*) "* ]] || die "active Wi-Fi service not found"
wifi_service="$(printf '%s\n' "$wifi_service_line" | sed -E 's/^\([^)]*\) //')"

network_info="$($NETWORKSETUP -getinfo "$wifi_service")"
dns_info="$($NETWORKSETUP -getdnsservers "$wifi_service")"

if [[ "$mode" == "off" ]]; then
  config_mode="$(printf '%s\n' "$network_info" | awk 'NR == 1 { print; exit }')"
  router="$(printf '%s\n' "$network_info" | awk -F': ' '/^Router: / { print $2; exit }')"
  if [[ "$config_mode" == "DHCP Configuration" ]] && [[ "$dns_info" == "There aren't any DNS Servers set on $wifi_service." ]]; then
    printf 'already restored\n'
    exit 0
  fi
  [[ "$config_mode" == "Manual Configuration" && "$router" == "$TARGET_GATEWAY" && "$dns_info" == "$TARGET_GATEWAY" ]] || \
    die "refusing to overwrite a network configuration not owned by magicnet-safe"
  "$NETWORKSETUP" -setdhcp "$wifi_service"
  "$NETWORKSETUP" -setdnsservers "$wifi_service" empty
  printf 'restored DHCP and automatic DNS\n'
  exit 0
fi

ssid_output="$($NETWORKSETUP -getairportnetwork "$wifi_device")"
ssid="${ssid_output#*: }"
[[ "$ssid_output" == "Current Wi-Fi Network: $TARGET_SSID" || "$ssid" == "$TARGET_SSID" ]] || \
  die "refusing to modify a Wi-Fi network other than $TARGET_SSID (observed: $ssid_output)"

config_mode="$(printf '%s\n' "$network_info" | awk 'NR == 1 { print; exit }')"
router="$(printf '%s\n' "$network_info" | awk -F': ' '/^Router: / { print $2; exit }')"
ip_address="$(printf '%s\n' "$network_info" | awk -F': ' '/^IP address: / { print $2; exit }')"
subnet_mask="$(printf '%s\n' "$network_info" | awk -F': ' '/^Subnet mask: / { print $2; exit }')"

if [[ "$config_mode" == "Manual Configuration" && "$router" == "$TARGET_GATEWAY" && "$dns_info" == "$TARGET_GATEWAY" && "$ip_address" == "$TARGET_PREFIX."* ]]; then
  printf 'already enabled: %s\n' "$ip_address"
  exit 0
fi

[[ "$config_mode" == "DHCP Configuration" ]] || die "expected DHCP before activation, observed: $config_mode"
[[ "$dns_info" == "There aren't any DNS Servers set on $wifi_service." ]] || die "manual DNS exists; refusing to overwrite it"
[[ "$subnet_mask" == "255.255.255.0" ]] || die "unexpected subnet mask: $subnet_mask"
[[ "$ip_address" == "$SOURCE_PREFIX."* ]] || die "unexpected blacklake DHCP range: $ip_address"
host_octet="${ip_address##*.}"
[[ "$host_octet" =~ ^[0-9]+$ && "$host_octet" -ge 2 && "$host_octet" -le 254 ]] || die "invalid DHCP host octet: $host_octet"
new_ip="$TARGET_PREFIX.$host_octet"

rollback_required=true
rollback() {
  if [[ "$rollback_required" == true ]]; then
    "$NETWORKSETUP" -setdhcp "$wifi_service" || true
    "$NETWORKSETUP" -setdnsservers "$wifi_service" empty || true
  fi
}
trap rollback EXIT
"$NETWORKSETUP" -setmanual "$wifi_service" "$new_ip" "$subnet_mask" "$TARGET_GATEWAY"
"$NETWORKSETUP" -setdnsservers "$wifi_service" "$TARGET_GATEWAY"

updated_info="$($NETWORKSETUP -getinfo "$wifi_service")"
updated_dns="$($NETWORKSETUP -getdnsservers "$wifi_service")"
grep -q '^Manual Configuration$' <<<"$updated_info" || die "manual mode was not applied"
grep -q "^IP address: $new_ip$" <<<"$updated_info" || die "static IP read-back mismatch"
grep -q "^Router: $TARGET_GATEWAY$" <<<"$updated_info" || die "gateway read-back mismatch"
[[ "$updated_dns" == "$TARGET_GATEWAY" ]] || die "DNS read-back mismatch"
rollback_required=false
trap - EXIT
printf 'enabled: IP=%s gateway=%s DNS=%s\n' "$new_ip" "$TARGET_GATEWAY" "$TARGET_GATEWAY"
