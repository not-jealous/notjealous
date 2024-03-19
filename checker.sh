echo "" > urls_to_show
total_lines=$(wc -l sorted_urls)
while ((i++)); read -r url; do
  printf "total progress $i/$total_lines\n" >&2
  echo "$url"
  result=$(dig +short +time=2 +retries=0 A {} $url)
  if [[ -z "$result" ]];
    then
    echo "result is $result"
    echo "$url" >> urls_to_show
    echo "$url possibly available."
  else
    echo "result is $result"
    echo "$url already exists."
  fi
done < "sorted_urls"