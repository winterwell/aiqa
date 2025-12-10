PORT=$1

if [ -z "$PORT" ]; then
  echo "killport.sh Usage: $0 <port>"
  exit 1
fi

pids=$(ss -tlpn | grep ":$PORT" | awk '{print $NF}' | grep -oP 'pid=\K[0-9]+')
if [ -n "$pids" ]; then
  for pid in $pids; do
    kill -9 "$pid" && echo "Killed process $pid on port $PORT"
  done
else
  echo "No process found on port $PORT"
fi
