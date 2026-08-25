#!/bin/sh
set -eu

application_mode="${QUARK_APPLICATION_MODE:-compatibility}"
dsh_home="${DSH_HOME:-/app/var/dsh}"
dsh_executable="${DSH_EXECUTABLE:-dsh}"
project_root="${QUARK_PROJECT_ROOT:-/app}"

case "${application_mode}" in
  compatibility)
    application_entry="dist/app.js"
    profile_name="${DSH_PROFILE:-feishu-assistant}"
    profile_patch="compat/cordis.compat.patch.yml"
    ;;
  native)
    application_entry="dist/product/app.js"
    profile_name="${DSH_NATIVE_PROFILE:-feishu-assistant-native}"
    profile_patch=""
    ;;
  *)
    echo "QUARK_APPLICATION_MODE must be compatibility or native" >&2
    exit 64
    ;;
esac

case "${profile_name}" in
  ""|*[!A-Za-z0-9._-]*)
    echo "DSH profile name contains unsupported characters" >&2
    exit 64
    ;;
esac

profile_manifest="${dsh_home}/profiles/${profile_name}/package.json"
profile_directory="${dsh_home}/profiles/${profile_name}"

export DSH_HOME="${dsh_home}"

if [ ! -f "${profile_manifest}" ]; then
  "${dsh_executable}" plugin --profile "${profile_name}" add "link:${project_root}"
fi

if [ -n "${profile_patch}" ]; then
  cp "${project_root}/${profile_patch}" "${profile_directory}/cordis.patch.yml"
else
  printf '[]\n' > "${profile_directory}/cordis.patch.yml"
fi

cd "${project_root}"
exec node "${application_entry}"
