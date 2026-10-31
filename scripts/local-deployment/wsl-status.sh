#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/wsl-common.sh"
docker compose --env-file "$env_file" -f "$compose_file" ps
curl --noproxy '*' -fsS "$SERVER_URL/health"
