#!/usr/bin/env bash
source "$(dirname -- "${BASH_SOURCE[0]}")/wsl-common.sh"
if runuser -u "$service_user" -- tmux has-session -t raftlocal 2>/dev/null; then
  if runuser -u "$service_user" -- tmux list-windows -t raftlocal -F '#{window_name}' | grep -Fxq server; then
    if [ "$(runuser -u "$service_user" -- tmux display-message -p -t raftlocal:server '#{pane_dead}')" != 1 ]; then
      server_pid=$(runuser -u "$service_user" -- tmux display-message -p -t raftlocal:server '#{pane_pid}')
      kill -TERM "$server_pid" 2>/dev/null || true
      for attempt in {1..30}; do
        if [ "$(runuser -u "$service_user" -- tmux display-message -p -t raftlocal:server '#{pane_dead}')" = 1 ]; then break; fi
        sleep 1
      done
    fi
    runuser -u "$service_user" -- tmux kill-window -t raftlocal:server
  fi
fi
if [ -f /run/nginx.pid ] && kill -0 "$(cat /run/nginx.pid)" 2>/dev/null; then nginx -s quit; fi
if docker info >/dev/null 2>&1; then
  docker compose --env-file "$env_file" -f "$compose_file" stop -t 60 risingwave
  docker compose --env-file "$env_file" -f "$compose_file" stop -t 30 postgres redis
  if [ -f /var/run/docker.pid ]; then
    docker_pid=$(cat /var/run/docker.pid)
    kill -TERM "$docker_pid"
    for attempt in {1..40}; do
      if ! kill -0 "$docker_pid" 2>/dev/null; then break; fi
      sleep 0.25
    done
  fi
fi
printf 'Raft services stopped; persistent data is retained.\n'
