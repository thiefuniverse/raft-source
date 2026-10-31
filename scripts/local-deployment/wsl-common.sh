#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin
deployment_root=${1:?Pass the WSL path of the deployment directory}
service_home=${2:-/opt/raft}
service_user=${3:-raft}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
app_root=$service_home/app
env_file=$service_home/config/service.env
compose_file=$deployment_root/config/compose.yaml
log_dir=$deployment_root/logs
set -a
source "$env_file"
if [ -f "$deployment_root/config/proxy.env" ]; then source "$deployment_root/config/proxy.env"; fi
set +a
