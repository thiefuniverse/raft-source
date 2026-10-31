#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/wsl-common.sh"
cd "$app_root/packages/server"
exec node --import @oxc-node/core/register src/server.ts >> "$log_dir/server.log" 2>&1
