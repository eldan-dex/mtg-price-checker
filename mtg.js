//v0.86, (c) dex 2021
//This is my first attempt at writing something in JS, so I know this is awful. Hopefully somebody can help me refactor it?

var GlobalCards;
var GlobalStores;
var GlobalResults;
var GlobalRequestsSent;
var GlobalRequestsCompleted;

//Contains all settings
class Settings
{
    //List of words which, when appearing in the name of a card we would otherwise accept, make us discard it instead
    static badWords = [];

    //Stores for which to calculate shipping costs
    static storesWithShipping = [];

    //Stores marked as default
    static defaultStores = [];

    //Stores marked as preferred
    static preferredStores = [];

    //Resets the settings
    static reset() {
        this.badWords = [];
        this.storesWithShipping = [];
        this.defaultStores = [];
        this.preferredStores = [];
    }
}

//Contains utility functions
class Util
{
    //Sorts objects by 'price' in ascending order
    static sortByPrice(a, b)
    {
        return (a.price > b.price) ? 1 : ((a.price < b.price) ? -1 : 0);
    }

    //Sorts objects primarily by 'store', secondarily by 'price' in ascending order
    static sortByStoreThenPrice(a, b)
    {
        if (a.store > b.store)
            return 1;
        else if (a.store < b.store)
            return -1;
        else
            return Util.sortByPrice(a, b);
    }


    //Filters out objects where 'count' is zero or nonexistent
    static filterInStock(obj)
    {
        return obj.count != undefined && obj.count > 0;
    }

    //Filters out stores not matching the specified name
    static filterStoreName(obj, storeName)
    {
        return obj.store != undefined && obj.store == storeName;
    }

    //Check whether the name matches while ignoring nonalphanumeric characters
    static filterCorrectName(suspectedCard, cardName, badWords)
    {
        let sus = suspectedCard.replace(/\W/g, '').toLowerCase();
        let corr = cardName.replace(/\W/g, '').toLowerCase();

        if (!sus.includes(corr))
            return false;

        //Check for bad words
        let tmp = sus.replace(corr, "").trim();
        for (let i = 0; i < badWords.length; ++i)
        {
            let badWord = badWords[i].replace(/\W/g, '').toLowerCase().trim();
            if (tmp.includes(badWord))
            {
                console.log(suspectedCard + " is not " + cardName);
                return false;
            }
        }
        return true;
    }
}

//Contains all query results and supporting logic
class Results
{
    constructor()
    {
        this.resultMap = new Map();
        this.failMap = new Map();
        this.storeCardCounts = new Map();
    }

    //Add a card result to the map
    addResult(cardId, nameStoreCountPrice)
    {
        //Add card data
        if (!this.resultMap.has(cardId))
            this.resultMap.set(cardId, []);
        
        this.resultMap.get(cardId).push(nameStoreCountPrice);

        //Add card to store counter
        if (!this.storeCardCounts.has(nameStoreCountPrice.store))
            this.storeCardCounts.set(nameStoreCountPrice.store, 0);

        this.storeCardCounts.set(nameStoreCountPrice.store, this.storeCardCounts.get(nameStoreCountPrice.store) + 1);
    }

    //Logs that a store failed for a particular card
    addFail(cardId, storeName, failText)
    {
        if (!this.failMap.has(cardId))
            this.failMap.set(cardId, []);

        this.failMap.get(cardId).push({store: storeName, text: failText});
    }

    //Get a map of failed queries
    getFails()
    {
        return this.failMap;
    }

    //Numbers of cards obtained from all stores
    getStoreCardCounts()
    {
        return this.storeCardCounts;
    }


    //Get a map of cheapest cards
    getBestPrices()
    {
        let result = new Map();

        //For each card
        for (let [key, val] of this.getBestStorePrices())
        {
            //Get the single best priced card of all stores
            let sorted = val.sort(Util.sortByPrice);
            result.set(key, sorted[0]);
        }

        return result;
    }

    //Get a map of cards with the cheapest price for all stores
    getBestStorePrices()
    {
        let result = new Map();

        //For each card
        for (let [key, val] of this.resultMap)
        {
            let sorted = val.sort(Util.sortByStoreThenPrice);
            result.set(key, []);

            //For each store, get the best price
            let storesDone = [];
            for (let j = 0; j < sorted.length; ++j)
            {
                if (storesDone.includes(sorted[j].store))
                    continue;

                result.get(key).push(sorted[j]);
                storesDone.push(sorted[j].store);
            }
        }

        return result;
    }

    //Total sum for all cards with the best stores
    getBestSum()
    {
        let result = 0;
        for (let [key, val] of this.getBestPrices())
            result += val.price;
        return result;
    }

    //Per-store sum of card prices
    getStoreSums()
    {
        let result = new Map();
        for (let [id, val] of this.getBestStorePrices())
        {
            for (let i = 0; i < val.length; ++i)
            {
                var key = val[i].store;
                if (!result.has(key))
                    result.set(key, 0);
                
                if (val[i].count > 0)
                    result.set(key, result.get(key) + val[i].price);
            }
        }
        return result;
    }

	//Get the number of cards selected as best option for each store
    getBestPicksPerStore()
    {
        let result = new Map();
        for (let [key, val] of this.getBestPrices())
        {
            if (!result.has(val.store))
                result.set(val.store, 0);

            result.set(val.store, result.get(val.store) + 1);
        }
        return result;
    }

    //Gets best cards limited to a specific store
    getCardsByStore(store)
    {
        let result = new Map();

        //For each card
        for (let [key, val] of this.getBestStorePrices())
        {
            let filtered = val.filter(function f(x) { return Util.filterStoreName(x, store);});
            result.set(key, filtered);
        }

        return result;
    }

    //Get a specific card from all stores
    getCardsByCardId(cardId)
    {
        let allPrices = this.getBestStorePrices();
        if (!allPrices.has(cardId))
            return [];
        return allPrices.get(cardId);
    }
}

//Base class for stores, contains generic logic
class Store
{
    constructor(name, url, shipPrice)
    {
        this.name = name;
        this.url = url;
        this.proxy = "https://cors-anywhere.herokuapp.com/";
        this.cellId = name + "Price";
        this.sumId = name + "Sum";
        this.shipPrice = shipPrice;
    }

    //Executes upon an AJAX request succeeding
    ajaxSuccess(result, cardName, rowId)
    {
        //Parse the resulting HTML into a list of card info objects
        try
        {
            let html = $.parseHTML(result);
            let cardData = this.parseReply(html, cardName);
            let filteredStock = [];
            if (cardData == undefined)
                console.log("parseReply (" + this.name + ", " + cardName + "): invalid response!"); //This will fall through to the N/A result
            else
            {
                //Remove cards with incorrect names
                let filteredNames = cardData.filter(function f(val) { return Util.filterCorrectName(val.name, cardName, Settings.badWords);});

                //Log all incorrect finds to console
                let diff = cardData.filter(x => !filteredNames.includes(x));
                diff.forEach(x => console.log(this.name + ": " + x.name + " is not " + cardName));

                //Remove cards not in stock
                filteredStock = filteredNames.filter(Util.filterInStock);
            }

            //Add data to results
            if (filteredStock.length == 0)
            {
                GlobalResults.addFail(rowId, this.name, "N/A");
                console.log(this.name + ": " + cardName + " not found");
            }
            else
                for (let i = 0; i < filteredStock.length; ++i)
                        GlobalResults.addResult(rowId, {name: filteredStock[i].name, store: this.name, count: filteredStock[i].count, price: filteredStock[i].price});
        }
        catch (e)
        {
            console.log("ajaxSuccess (" + this.name + ", " + cardName + "): " + e.message);
        }
        finally
        {
            this.completeRequest();
        }
    }

    //Executes upon an AJAX request failing
    ajaxFail(rowId)
    {
        GlobalResults.addFail(rowId, this.name, "FAILED");
        this.completeRequest();
    }

    //Completes a query request and finalizes the table if this was the last one
    completeRequest()
    {
        ++GlobalRequestsCompleted;
        Site.updateCounter(GlobalRequestsCompleted, GlobalRequestsSent);
        Site.refreshTable();

        if (GlobalRequestsCompleted >= GlobalRequestsSent)
            finalizeTable();
    }

    //Executes an async AJAX query for the specified card name and row ID
    executeQuery(cardName, rowId)
    {
        let thisClass = this;
        let successFunc = function f(r) { thisClass.ajaxSuccess(r, cardName, rowId); };
        let failFunc = function f() { thisClass.ajaxFail(rowId); };

        //Increment request counter BEFORE requests are sent, so that an immediate resolve has no chance of accidentally triggering table finalization
        ++GlobalRequestsSent; 

        if (this.queryMethod == "post")
            $.post(this.proxy + this.url, this.createQuery(cardName), successFunc).fail(failFunc);
        else if (this.queryMethod == "get")
            $.get(this.proxy + this.url + this.createQuery(cardName), successFunc).fail(failFunc);
        else
            console.error("Unknown query method: " + this.queryMethod);
    }

    //Sets the query info and methods for this store
    setQueryInfo(queryMethod, createQuery, parseReply)
    {
        this.queryMethod = queryMethod;
        this.createQuery = createQuery;
        this.parseReply = parseReply;
    }
}

/////////////////////////////
//Store child classes, contain store-specific logic
/////////////////////////////
//cernyrytir.cz store object
class Rytir extends Store
{
    constructor()
    {
        super("Rytir", "https://www.cernyrytir.cz/index.php3?akce=3", 99);
        super.setQueryInfo("post", this.createQuery, this.parseReply);
    }

    //Creates the required query for this store
    createQuery(cardName)
    {
        return {"edice_magic": "libovolna", "rarita": "A", "foil": "A", "jmenokarty": cardName, "triditpodle": "ceny", "submit": "Vyhledej"};
    }

    //Parse the HTML response from this store into a list of [name, count, price] objects
    parseReply(html, cardName)
    {
        let table = $(html).find('table.kusovkytext')[1];
        if (table == undefined)
            return undefined;

        let trlist = $(table).find('tbody').find('tr');
        if (trlist == undefined || trlist.length == 0)
            return undefined;
    
        let results = [];
        for(let i = 0; i < trlist.length; i += 0)
        {
            try
            {
                let tt = $(trlist[i++]);
                let name = tt.find('font')[0].innerText.trim();        
                i++;
                let tds = $(trlist[i++]).find('td');
                let count = parseInt($(tds[1]).find('font')[0].innerText.split(' ')[0]);
                let price = parseInt($(tds[2]).find('font')[0].innerText.split(' ')[0]);        
                results.push({name, count, price});
            }
            catch (e)
            {
                console.error("parseReply (" + this.name + ", " + cardName + "): " + e.message);
            }
        }
        return results;
    }
}

//najada.cz store object
class Najada extends Store
{
    constructor()
    {
        super("Najada", "https://www.najada.cz/cz/kusovky-mtg/", 69);
        super.setQueryInfo("get", this.createQuery, this.parseReply);
    }

    //Creates the required query for this store
    createQuery(cardName)
    {
        return "?Search=" + encodeURIComponent(cardName) + "&MagicCardSet=-1";
    }

    //Parse the HTML response from this store into a list of [name, count, price] objects
    parseReply(html, cardName)
    {
        //Najada structure: [name, count, price] = table.tabArt > tr [1:] > [.tdTitle, .tdPrice[:' '], .tdPrice[' ':]]
        let table = $(html).find('table.tabArt')[0];
        if (table == undefined)
            return undefined;

        let trlist = $(table).find('tr');
        if (trlist == undefined || trlist.length == 0)
            return undefined;

        let results = [];
        let prevName = "";
        for(let i = 1; i < trlist.length; ++i)
        {
            try
            {
                let name = $(trlist[i]).find('.tdTitle')[0].innerText.trim();

                 //Use previous name if next entry is nameless
                if (name == "")
                    name = prevName;
                else
                    prevName = name;

                let priceCount = $(trlist[i]).find('.tdPrice')[0].innerText.trim().split(' ');
                let price = parseInt(priceCount[0]);
                let count = parseInt(priceCount[2].substring(1, priceCount[2].length - 1));
                results.push({name, count, price});
            }
            catch (e)
            {
                console.error("parseReply (" + this.name + ", " + cardName + "): " + e.message);
            }
        }
        return results;
    }
}

//blacklotus.cz store object
class Lotus extends Store
{
    constructor()
    {
        super("Lotus", "http://www.blacklotus.cz/magic-vyhledavani/", 69);
        super.setQueryInfo("get", this.createQuery, this.parseReply);
    }

    //Creates the required query for this store
    createQuery(cardName)
    {
        return "?page=search&search=" + btoa("nazev;" + cardName + ";popis;;15;0;4;0;7;0;from13;;to13;;from14;;to14;;from12;;to12;;pricemin;;pricemax;;6;0") + "&catid=3";
    }

    //Parse the HTML response from this store into a list of [name, count, price] objects
    parseReply(html, cardName)
    {
        //Lotus structure: [name, count, price] = #list [0] > .inner [all] > [h2, .prices > dd > .stock_quantity, .prices > dd > .cenasdph]
        let lists = $(html).find('#list');
        if (lists  == undefined)
            return undefined;

        let divs = $(lists[0]).find('.inner');
        if (divs == undefined || divs.length == 0)
            return undefined;

        let results = [];
        for(let i = 0; i < divs.length; ++i)
        {
            try
            {
                let name = $(divs[i]).find('h2')[0].innerText.trim();
                let prices = $(divs[i]).find('.prices');
                let dds = $(prices[0]).find('dd');
                let count = 0;
                if ($(dds[0]).find('.stock_quantity').length > 0)
                {
                    count = $(dds[0]).find('.stock_quantity')[0].innerText.split(' ')[0];
                    count = parseInt(count.substring(1, count.length));
                }
                let priceStr = $(prices[1]).find('.cenasdph')[0].innerText.split('K')[0].replace(/,/g, '.').replace(/\s/g, '');
                let price = Math.ceil(parseFloat(priceStr));
                results.push({name, count, price});
            }
            catch (e)
            {
                console.error("parseReply (" + this.name + ", " + cardName + "): " + e.message);
            }
        }
        return results;
    }
}

//rishada.cz store object
class Rishada extends Store
{
    constructor()
    {
        super("Rishada", "http://rishada.cz/hledani", 36);
        super.setQueryInfo("get", this.createQuery, this.parseReply);
    }

    //Creates the required query for this store
    createQuery(cardName)
    {
        return "?fulltext=" + encodeURIComponent(cardName);
    }

    //Parse the HTML response from this store into a list of [name, count, price] objects
    parseReply(html, cardName)
    {
        //Rishada structure: [name, count, price] = table.buytable [0] > tr [1:] > td [0,5,6]
        let tables = $(html).find('.buytable');
        if (tables == undefined)
            return undefined;

        let trs = $(tables[0]).find('tr');
        if (trs == undefined || trs.length == 0)
            return undefined;

            let results = [];
        for(let i = 1; i < trs.length; ++i)
        {
            try
            {
                let tds = $(trs[i]).find('td');
                let name = $(tds[0]).find('a')[0].innerText.trim();
                let price = parseInt(tds[5].innerText.split(' ')[0]);
                let count = parseInt(tds[6].innerText.split(' ')[0]);
                results.push({name, count, price});
            }
            catch (e)
            {
                console.error("parseReply (" + this.name + ", " + cardName + "): " + e.message);
            }
        }
        return results;       
    }
}

//mysticshop.cz store object
class Mystic extends Store
{
    constructor()
    {
        super("Mystic", "http://mysticshop.cz/mtgshop.php", 69);
        super.setQueryInfo("post", this.createQuery, this.parseReply);
    }

    //Creates the required query for this store
    createQuery(cardName)
    {
        //Automatically ignore cards not in stock: "nozeros"=1
        return {"set": 0, "language": 0, "name": cardName, "nozeros": 1, "limit": 100, "cmdsearch": "Vyhledej"};
    }

    //Parse the HTML response from this store into a list of [name, count, price] objects
    parseReply(html, cardName)
    {
        //Rishada structure: [name, count, price] = tbody > trs > tds [1, 7, 8]
        let tables = $(html).find('tbody');
        if (tables == undefined)
            return undefined;

        let trs = $(tables[0]).find('tr');
        if (trs == undefined || trs.length == 0)
            return undefined;

        let results = [];
        for(let i = 0; i < trs.length; ++i)
        {
            try
            {
                let tds = $(trs[i]).find('td');
                let name = $(tds[1]).find('a')[0].innerText.trim();
                let price = parseInt(tds[8].innerText);
                let count = parseInt(tds[7].innerText.split(',')[0]);
                results.push({name, count, price});
            }
            catch (e)
            {
                console.error("parseReply (" + this.name + ", " + cardName + "): " + e.message);
            }
        }
        return results;       
    }
}

/////////////////////////////
//Site-related code
/////////////////////////////
class Site
{
    //Assign a value to a specified cell in a specified row. If cellClass is provided, value is placed inside a span with the given class
    static fillCell(rowId, cellId, value, cellClass = undefined, cellStyle = undefined)
    {
        let styleContent = (cellStyle == undefined) ? value : ("<" + cellStyle + ">" + value + "</" + cellStyle + ">");
        let content = (cellClass == undefined) ? styleContent : ("<span class=\"" + cellClass + "\">" + styleContent + "</span>");
        $("#row_" + rowId + " > #" + cellId)[0].innerHTML = content;
    }

    //Get an array of card data from the textarea. Filters out empty lines
    static getCards()
    {
        let cards = $('textarea#card_list').val().split("\n").filter(function (e) { return e != ""; });
        let result = [];
        for (let i = 0; i < cards.length; ++i)
        {
            //If card doesn't start with a number, add it to result
            if (!cards[i].match(/^\d/))
            {
                result.push(cards[i]);
                continue;
            }

            //Otherwise assume a card count is present and remove it
            result.push(cards[i].substring(cards[i].indexOf(' ') + 1));
        }
        return result;
    }

    //Updates the 'processed' counter
    static updateCounter(current, total)
    {
        $("#doneCounter")[0].innerText = current + "/" + total;
    }

    //Creates a table with the given array of card names and the rest of cells empty
    static createTableWithCards(cards)
    {
        for (let i = 0; i < cards.length; ++i)
        {
            let rowStyle = (i % 2 == 0) ? "even" : "odd";
            let contents =  "<tr class=\"" + rowStyle + "\" id=\"row_" + i + "\">";
                contents += "<td  class=\"name\" id=\"cardname\">" + cards[i] + "</td>";

                GlobalStores.forEach(s => contents += "<td class=\"value\" id=\"" + s.name + "Price\"></id>");

                contents += "<td class=\"name\" id=\"bestStore\"></id>";
                contents += "<td class=\"value\" id=\"bestPrice\"></id>";
                contents += "</tr>";
            $("#result_table > tbody").append(contents);
        }
    }

    //Create the sum row and display the sum legend
    static createSumRow()
    {
        let contents =  "<tr id=\"row_sum\">";
            contents += "<td class=\"name\" id=\"sumname\"><b>Celkem</b></td>";
            
            GlobalStores.forEach(s => contents += "<td class=\"value\" id=\"" + s.name + "Sum\"></id>");

            contents += "<td class=\"name\" id=\"storeStats\"></id>";
            contents += "<td class=\"value\" id=\"bestSum\"><b></b></id>";
            contents += "</tr>";
        $("#result_table > tbody").append(contents);
        $("#sum_legend").css("display", "block");
    }

    //Create the shipping row and display the shipping legend
    static createShippingRow()
    {
        let contents =  "<tr id=\"row_ship\">";
            contents += "<td class=\"name\" id=\"sumname\"><b>Doprava</b></td>";
            
            GlobalStores.forEach(s => contents += "<td class=\"value\" id=\"" + s.name + "Ship\"></id>");

            contents += "<td class=\"name\" id=\"shipNote\"></id>";
            contents += "<td class=\"value\" id=\"shipSum\"><b></b></id>";
            contents += "</tr>";
        $("#result_table > tbody").append(contents);
        $("#ship_legend").css("display", "block");
    }

    //Clears the table except for the header
    static clearTable()
    {
        $("#result_table > tbody:last").children().remove();
        $("#sum_legend").css("display", "none");
        $("#ship_legend").css("display", "none");
    }

    //Refreshes the table
    static refreshTable()
    {
        for (let [id, data] of GlobalResults.getBestStorePrices())
        {
            for (let i = 0; i < data.length; ++i)
            {
                let cellClass = data[i].count > 3 ? "stockOk" : (data[i].count > 0 ? "stockLow" : "stockEmpty");
                this.fillCell(id, data[i].store + "Price", data[i].price, cellClass);
            }
        }

        for (let [id, data] of GlobalResults.getFails())
        {
            for (let i = 0; i < data.length; ++i)
            {
                this.fillCell(id, data[i].store + "Price", data[i].text, "stockEmpty");
            }
        }
    }
}

//Initializes the site
function init()
{
    //Initialize stores
    GlobalStores = [new Rytir(), new Najada(), new Lotus(), new Rishada(), new Mystic()];

    //Hackish way to consistently save the default settings
    saveSettings();
}

//Resets everything and starts the price-checking process
function checkPrices()
{
    //Clear old results
    GlobalRequestsSent = 0;
    GlobalRequestsCompleted = 0;

    //Initialize cards and results
    GlobalCards = Site.getCards();
    GlobalResults = new Results();

    //Initialize table
    Site.clearTable();
    Site.createTableWithCards(GlobalCards);
    Site.updateCounter(0, GlobalCards.length);

    //Send queries
    console.log("Checking " + GlobalCards.length + " cards");
    for (let i = 0; i < GlobalCards.length; ++i)
       GlobalStores.forEach(s => s.executeQuery(GlobalCards[i], i));
}

//Assumes the table is fully populated and computes the sums and best stores
function finalizeTable()
{
    //Fill best price for each card
    let bestPrices = GlobalResults.getBestPrices();
    for (let i = 0; i < GlobalCards.length; ++i)
    {
        if (!bestPrices.has(i))
        {
            Site.fillCell(i, "bestPrice", "N/A", "stockEmpty");
            continue;
        }

        let data = bestPrices.get(i);
        let cellClass = data.count > 3 ? "stockOk" : (data.count > 0 ? "stockLow" : "stockEmpty");
        Site.fillCell(i, "bestPrice", data.price, cellClass);
        Site.fillCell(i, "bestStore", data.store + " (" + data.name + ")");
    }

    //Create sum and shipping rows if they don't yet exist
    if ($("#row_ship").length == 0 && Settings.storesWithShipping.length > 0)
        Site.createShippingRow();

    if ($("#row_sum").length == 0)
        Site.createSumRow();

    //Fill store sums
    let storeSums = GlobalResults.getStoreSums();
    let storeCardCounts = GlobalResults.getStoreCardCounts();
    for (let i = 0; i < GlobalStores.length; ++i)
    {
        let store = GlobalStores[i].name;
        let shippingCost = 0;
        if (Settings.storesWithShipping.includes(store))
        {
            shippingCost = GlobalStores[i].shipPrice;
            Site.fillCell("ship", store + "Ship", "+ " + shippingCost);
        }
        else
            Site.fillCell("ship", store + "Ship", "");

        if (!storeSums.has(store))
        {
            Site.fillCell("sum", store + "Sum", 0, "stockEmpty", "i");
            continue;
        }

        let cellClass = storeCardCounts.get(store) == GlobalCards.length ? "stockOk" : (storeCardCounts.get(store) > 0 ? "stockLow" : "stockEmpty");
        Site.fillCell("sum", store + "Sum", storeSums.get(store) + shippingCost, cellClass, "i");
    }

    //Fill store stats
    let storeStats = "";
    let bestPicks = GlobalResults.getBestPicksPerStore();
    for (let [store, count] of bestPicks)
        storeStats += store + ": " + count + ", ";
    storeStats = storeStats.substr(0, storeStats.length - 2);
    Site.fillCell("sum", "storeStats", storeStats, undefined, "i");

    //Fill best sum plus any shipping
    let bestSum = GlobalResults.getBestSum();
    let bestSumWithShipping = bestSum;
    for (let i = 0; i < GlobalStores.length; ++i)
    {
        let store = GlobalStores[i].name;
        if (bestPicks.has(store) && bestPicks.get(store) > 0 && Settings.storesWithShipping.includes(store))
            bestSumWithShipping += GlobalStores[i].shipPrice;
    }

    Site.fillCell("sum", "bestSum", bestSum + " (" + bestSumWithShipping + " s dopravou)", undefined, "b");
}

//Display/hide the settings menu
function settings()
{
    if ($("#settings").css("display") == "none")
        $("#settings").css("display", "block");
    else
        $("#settings").css("display", "none");
}

//Apply settings
function saveSettings()
{
    //Reset settings
    Settings.reset();

    for (let i = 0; i < GlobalStores.length; ++i)
    {
        let store = GlobalStores[i].name;

        //Get stores with selected shipping costs
        if ($("#s_ship" + store + ":checked").length != 0)
            Settings.storesWithShipping.push(store);

        //Get default stores
        if ($("#s_def" + store + ":checked").length != 0)
            Settings.defaultStores.push(store);

        //Get preferred stores
        if ($("#s_pref" + store + ":checked").length != 0)
            Settings.preferredStores.push(store);
    }

    //Save filtered words
    let bads = $("#s_filters").val().trim().split(",");
    bads.forEach(x => Settings.badWords.push(x));

}