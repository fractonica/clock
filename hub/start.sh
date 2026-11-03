#!/usr/bin/env bash
# Starts the Fractonica Hub and its embedding worker on this machine together; Ctrl-C stops both.
#
#   hub/start.sh                                  # http://localhost:8787, data in hub/data
#   hub/start.sh --port 8788 --data ~/hub-data    # any `hub serve` flag goes to the hub
#   hub/start.sh --no-worker                      # the hub alone
#   FX_MODALITIES=text,image hub/start.sh         # the worker's settings from the environment (worker/README.md)
#
# The worker takes the token `fx-worker login` saved when this hub knows it, else one the hub makes on the first run
# and keeps in its data folder (`hub worker-token`): no pairing. Its Python environment is brought up to date with uv
# first (the first run installs PyTorch; the model's first start downloads 2.8 GB). When a hub already answers on the
# port, only the worker starts. When the worker stops, the hub runs on (search falls back to keywords).

here=$(cd "$(dirname "$0")" && pwd)
port=8787 host= data= want_worker=1
serve=() data_arg=()
while [ $# -gt 0 ]; do
  case $1 in
    --no-worker) want_worker= ;;
    --port | --host | --data)
      [ $# -ge 2 ] || { echo "$1 needs a value" >&2; exit 2; }
      case $1 in --port) port=$2 ;; --host) host=$2 ;; --data) data=$2 ;; esac
      serve+=("$1" "$2")
      shift ;;
    --port=*) port=${1#*=}; serve+=("$1") ;;
    --host=*) host=${1#*=}; serve+=("$1") ;;
    --data=*) data=${1#*=}; serve+=("$1") ;;
    -h | --help) sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) serve+=("$1") ;;
  esac
  shift
done
[ -n "$data" ] && data_arg=(--data "$data")
case $host in '' | 0.0.0.0 | :: | '[::]') url=http://127.0.0.1:$port ;; *:*) url=http://[$host]:$port ;; *) url=http://$host:$port ;; esac

command -v node >/dev/null || { echo "The hub needs Node 22.13 or later (node is not on PATH)." >&2; exit 1; }
uv=$(command -v uv || echo "$HOME/.local/bin/uv")

# each line of the two told apart (by an awk that outlives Ctrl-C, to pass on their last lines)
tag() {
  trap '' INT HUP
  awk -v p="$1" '{ print p $0; fflush() }'
}
say() { echo "$1" | tag "$2"; }
hub_tag='hub    │ ' worker_tag='worker │ '

hub_pid= worker_pid=
stop() {
  trap '' INT TERM HUP
  for p in $worker_pid $hub_pid; do kill -TERM "$p" 2>/dev/null; done
  for _ in $(seq 50); do
    alive=
    for p in $worker_pid $hub_pid; do kill -0 "$p" 2>/dev/null && alive=1; done
    [ -z "$alive" ] && break
    sleep 0.2
  done
  for p in $worker_pid $hub_pid; do kill -KILL "$p" 2>/dev/null; done
  sleep 0.2 # their last lines through `tag`
  exit 0
}
trap stop INT TERM HUP

answers() { curl -fsS -o /dev/null --max-time 1 "$url/v1" 2>/dev/null; }

if answers; then
  [ -n "$want_worker" ] || { say "already running at $url" "$hub_tag"; exit 0; }
  if curl -fsS --max-time 2 "$url/v1" | grep -q '"worker":true'; then
    say "already running at $url, a worker connected to it: nothing to start" "$hub_tag"
    exit 0
  fi
  say "already running at $url: starting only the worker" "$hub_tag"
else
  node "$here/bin/hub.mjs" serve "${serve[@]}" > >(tag "$hub_tag") 2>&1 &
  hub_pid=$!
  for _ in $(seq 100); do
    kill -0 "$hub_pid" 2>/dev/null || { wait "$hub_pid"; status=$?; sleep 0.1; exit "$status"; }
    answers && break
    sleep 0.1
  done
fi

start_worker() {
  if [ ! -x "$uv" ]; then
    say "not started: it needs uv (https://docs.astral.sh/uv/: curl -LsSf https://astral.sh/uv/install.sh | sh)" "$worker_tag"
    return
  fi
  command -v ffmpeg >/dev/null || say "ffmpeg is not on PATH (brew install ffmpeg): voice notes and videos won't be embedded" "$worker_tag"
  local token
  token=$(node "$here/bin/hub.mjs" worker-token "${data_arg[@]}") || { say "not started: no token" "$worker_tag"; return; }
  case $(printf 'Authorization: Bearer %s\n' "$token" | curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -H @- "$url/v1/me" 2>/dev/null) in
    200) ;;
    401 | 403) say "not started: the hub at $url does not take its token (is it serving another data folder? pass --data)" "$worker_tag"; return ;;
    *) say "not started: the hub at $url does not answer" "$worker_tag"; return ;;
  esac
  [ -d "$here/worker/.venv" ] || say "setting up its Python environment (the first time takes a few minutes)" "$worker_tag"
  "$uv" sync --project "$here/worker" --quiet > >(tag "$worker_tag") 2>&1 || { say "not started: uv sync failed" "$worker_tag"; return; }
  FX_HUB=$url FX_TOKEN=$token "$here/worker/.venv/bin/fx-worker" > >(tag "$worker_tag") 2>&1 &
  worker_pid=$!
}
[ -n "$want_worker" ] && start_worker
[ -n "$hub_pid" ] || [ -n "$worker_pid" ] || exit 1

while :; do
  if [ -n "$hub_pid" ] && ! kill -0 "$hub_pid" 2>/dev/null; then
    wait "$hub_pid"
    status=$?
    say "stopped (exit $status)" "$hub_tag"
    trap - INT TERM HUP
    [ -n "$worker_pid" ] && kill -TERM "$worker_pid" 2>/dev/null && wait "$worker_pid"
    sleep 0.1
    exit "$status"
  fi
  if [ -n "$worker_pid" ] && ! kill -0 "$worker_pid" 2>/dev/null; then
    wait "$worker_pid"
    status=$?
    worker_pid=
    [ -n "$hub_pid" ] || { say "stopped (exit $status)" "$worker_tag"; exit "$status"; }
    say "stopped (exit $status); the hub runs on, searching by keywords" "$worker_tag"
  fi
  sleep 1 & wait $! # (a trap runs at once only while `wait` waits)
done
