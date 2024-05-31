let display_array = [];
let base_url_array = [];
let url_array = [];
let namesPerPage = 5;
let currentPage = 1;

async function readUrlListIntoArray() {
    const response = await fetch("./urls_to_show");
    const file_text = await response.text();
    base_url_array = file_text.split('\n');
    base_url_array.pop(); // remove empty last element
    const list_to_add_url = document.getElementById('nameList');
    display_array = [...base_url_array]; // set url array for future searching
}

function oldSearchNames() {
    var input, filter, ul, li, a, i, txtValue;
    input = document.getElementById('myInput');
    filter = input.value.toUpperCase();
    url_array = [];
    for (i = 0; i < base_url_array.length; i++) {     
    url = base_url_array[i];

    if (url.toUpperCase().indexOf(filter) > -1) {
        url_array.push(url);
    }
    currentPage = 1
    displayDomainNames(currentPage); 
    } 
};

function searchNames() {
    var input, filter, ul, li, a, i, txtValue;

    const options = {
      includeScore: false,
      includeMatches: false,
      threshold: 0.2
    }

    input = document.getElementById('myInput').value;
    if (input.length > 0) {;
      // fuzzy search
      const fuse = new Fuse(base_url_array, options);
      const rabbit_array = fuse.search(input);
      display_array = rabbit_array.map(ar_element => ar_element.item);
    } else {
      // return all items
      display_array = [...base_url_array]; // set url array for future searching
    }

    currentPage = 1;
    displayDomainNames(currentPage);
}

async function displayDomainNames(page) {
    currentPage=page;
    filt = document.getElementById('names_per_page');
    namesPerPage = Number(filt.value);
    // This populates the domain names on the web page
    const startIndex = (page - 1) * namesPerPage; // page offset
    const endIndex = startIndex + namesPerPage;
    const domainNamesDiplayed = display_array.slice(startIndex, endIndex);
    const listElement = document.getElementById('nameList');
    listElement.innerHTML = '';

    domainNamesDiplayed.forEach(name => {
    const listItem = document.createElement('li');
    //listItem.textContent = name.textContent || name.innerText;
    listItem.textContent = name;
    listElement.appendChild(listItem);
    });

    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${Math.ceil(display_array.length / namesPerPage)}`; // set pagination stats
}

function changePage(offset) {
    console.log("offset:");
    console.log(offset);
    currentPage += offset;
    nameList = document.getElementById("nameList");
    nameListCollection = nameList.getElementsByTagName('li');
    currentPage = Math.max(1, Math.min(currentPage, Math.ceil(display_array.length / namesPerPage)));
    displayDomainNames(currentPage);
}

function randomPage() {
    //TODO: small error when changing result size after random page
    console.log(display_array);
    console.log(Math.floor(Math.random() * Math.ceil(display_array.length / namesPerPage))+1);
    return (Math.floor(Math.random() * Math.ceil(display_array.length / namesPerPage))+1); // Why are we starting the ar at 1??
}

async function initialize() {
    await readUrlListIntoArray(url_array); // TODO: this should not be done every reload, will cause errors
    displayDomainNames(randomPage());
}

document.getElementById('prev').addEventListener('click', () => changePage(-1));
document.getElementById('next').addEventListener('click', () => changePage(1));
document.getElementById('random').addEventListener('click', () => displayDomainNames(randomPage()));
document.getElementById('names_per_page').addEventListener('change', () => displayDomainNames(currentPage));

initialize();
