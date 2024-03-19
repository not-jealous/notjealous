set -xe
current_hash() { # determine hash of all files in current dir
 echo $(ls -lah --full-time | sha256sum)
}
export -f current_hash

hot_server() {
    nohup ./node_modules/http-server/bin/http-server &>/dev/null &
    pid=$!
    watch -g -x bash -c "current_hash"
    kill -9 $pid
}

while true; do
    hot_server
done
