#!/bin/sh
set -eu

profile_name="${DSH_PROFILE:-feishu-assistant}"
dsh_home="${DSH_HOME:-/app/var/dsh}"
dsh_executable="${DSH_EXECUTABLE:-dsh}"
project_root="${QUARK_PROJECT_ROOT:-/app}"
profile_manifest="${dsh_home}/profiles/${profile_name}/package.json"

export DSH_HOME="${dsh_home}"

if [ ! -f "${profile_manifest}" ]; then
  "${dsh_executable}" plugin --profile "${profile_name}" add "link:${project_root}"
fi

cd "${project_root}"
exec node dist/app.js
