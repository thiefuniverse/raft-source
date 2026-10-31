#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/wsl-common.sh"
mkdir -p "$log_dir"
if ! docker info >/dev/null 2>&1; then
  # A separate session keeps Docker port proxies alive after the launcher exits.
  setsid --fork dockerd --config-file /etc/docker/daemon.json > "$log_dir/docker.log" 2>&1 < /dev/null
  for attempt in {1..40}; do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
  done
  docker info >/dev/null
fi
docker compose --env-file "$env_file" -f "$compose_file" up -d
node "$script_dir/check-databases.mjs" "$app_root"
nginx -t
if [ -f /run/nginx.pid ] && kill -0 "$(cat /run/nginx.pid)" 2>/dev/null; then nginx -s reload; else nginx; fi
printf 'set -g remain-on-exit on\n' > "$(getent passwd "$service_user" | cut -d: -f6)/.tmux.conf"
chown "$service_user:$service_user" "$(getent passwd "$service_user" | cut -d: -f6)/.tmux.conf"
printf -v server_command 'bash %q %q %q %q' "$script_dir/wsl-run-server.sh" "$deployment_root" "$service_home" "$service_user"
if ! runuser -u "$service_user" -- tmux has-session -t raftlocal 2>/dev/null; then
  runuser -u "$service_user" -- tmux new-session -d -s raftlocal -n server "$server_command"
elif ! runuser -u "$service_user" -- tmux list-windows -t raftlocal -F '#{window_name}' | grep -Fxq server; then
  runuser -u "$service_user" -- tmux new-window -t raftlocal -n server "$server_command"
elif [ "$(runuser -u "$service_user" -- tmux display-message -p -t raftlocal:server '#{pane_dead}')" = 1 ]; then
  runuser -u "$service_user" -- tmux respawn-window -t raftlocal:server "$server_command"
fi
for attempt in {1..60}; do
  if curl --noproxy '*' -fsS "$SERVER_URL/health" >/dev/null 2>&1; then
    printf 'Raft web/API is ready. Agent execution is managed by Windows Computer.\n'
    exit 0
  fi
  sleep 1
done
printf 'API did not become healthy; check the deployment logs.\n' >&2
exit 1
