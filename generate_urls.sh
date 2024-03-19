#echo "" > valid_urls # orphaned code
echo "" > matches
echo "" > possibly_available_urls

./sanitize_dictionary.sh > sanitized_dictionary.txt
while read -r raw_tld; do
    # convert TLD to lower case
    tld=$(echo $raw_tld | sed 's/.*/\L&/g')
    echo $tld
    regex_string=".*$tld$"
    awk -v IGNORECASE=1 -v tld="$tld" -v regex_string="$regex_string" 'match($0, regex_string) {print substr($0, RSTART, RLENGTH - length(tld)) "." tld}' sanitized_dictionary.txt >> matches 
#done < "tlds-alpha-by-domain.txt"
done < "all_tlds"

# Valid URLS start with a letter
#cat matches | grep -i ^[a-zA-Z] > alpha_matches
./sanitize_matches.sh > alpha_matches
sort alpha_matches > sorted_matches
exit
total_lines=$(wc -l sorted_matches)
while ((i++)); read -r url; do
    printf "total progress $i/$total_lines\n" >&2
    echo "$url"
    if whois $url 2> /dev/null;
     then
      echo "$url already exists."
     else
      echo "$url" >> possibly_available_urls
      echo "$url possibly available."
    fi
    wait 0.2
done < "sorted_matches"

#done < "com"
#done < "tlds-alpha-by-domain.txt"
#echo "waiting"
#wait
#echo "done waiting"
