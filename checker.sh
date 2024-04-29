#!/usr/bin/env bash
set -xe
pids=()
total_lines=$(wc -l "sorted_urls")
log_file="test_log.txt" # log files simplify multithreading debugging
timeout=${1:-"2"} # dig timeout defaults to 2 seconds
retries=${2:-"0"} # dig retries defaults to 0 retries
input_file="sorted_urls"
output_file="urls_to_show"

initialize() {
  printf '' > $output_file
  printf '' > "tracked_pids"
  printf '' > "$log_file"
}

log() {
  message=$1
  echo "$message" >> "$log_file"
}

bulldog() {
  url=$1
  log "$url digging for A record"
  result=$(dig +short +time=$timeout +retries=$retries A {} $url)

  if [[ -z "$result" ]]; then
    log "$url possibly available and has no A record"
    echo "$url" >> $output_file
  else
    log "$url already exists and has the A record $result"
  fi
}

initialize
while read -r url; do
  log "$url"
  bulldog $url &
  pid="$!"
  log $pid
  pids+=("$pid")
done < "$input_file"

echo "one" >> $log_file
for pid in "${pids[@]}"; do
  #printf "total progress $i/$total_lines\n" >&2
  log "$pid pid waiting to finish"
  wait -n $pid
  log "$pid pid waiting to finish"
done

# TODO we should cleanup any background tasks before exiting  
log "done determining available URLs"
