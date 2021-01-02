//v0.5, (c) dex 2020
var GlobalCards;
var GlobalResults;
var GlobalRequestsSent;
var GlobalRequestsReceived;
var GlobalQueryResults;
var GlobalStores;
var GlobalStoreSums;

//Contains all settings
class Settings
{
    //List of words which, when appearing in the name of a card we would otherwise accept, make us discard it instead
    static badWords = ["emblem", "oversized", "art series"];
}

//Contains utility functions
class Util
{
    //Sorts objects by 'price' in ascending order
    static sortByPrice(a, b)
    {
        var pa = a['price'];
        var pb = b['price'];
        return (pa > pb) ? 1 : ((pa < pb) ? -1 : 0);
    }

    //Sorts objects primarily by 'store', secondarily by 'price' in ascending order
    static sortByStoreThenPrice(a, b)
    {
        var sa = a['store'];
        var sb = b['store'];
        if (sa > sb)
            return 1;
        else if (sa < sb)
            return -1;
        else
            return Util.sortByPrice(a, b);
    }


    //Filters out objects where 'count' is zero or nonexistent
    static filterInStock(obj)
    {
        return obj['count'] != undefined && obj['count'] > 0;
    }

    //Filters out stores not matching the specified name
    static filterStoreName(obj, storeName)
    {
        return obj['store'] != undefined && obj['store'] == storeName;
    }

    //Check whether the name matches while ignoring nonalphanumeric characters
    static filterCorrectName(suspectedCard, cardName, badWords)
    {
        var sus = suspectedCard.replace(/\W/g, '').toLowerCase();
        var corr = cardName.replace(/\W/g, '').toLowerCase();

        if (!sus.includes(corr))
            return false;

        //Check for bad words
        var tmp = sus.replace(corr, "").trim();
        for (var i = 0; i < badWords.length; ++i)
        {
            var badWord = badWords[i].replace(/\W/g, '').toLowerCase().trim();
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
    }

    //Add a card result to the map
    addResult(cardId, storeCountPrice)
    {
        if (!this.resultMap.has(cardId))
            this.resultMap.set(cardId, []);

        this.resultMap.get(cardId).push(storeCountPrice);
    }

    //Logs that a store failed for a particular card
    addFail(cardId, storeName)
    {
        if (!this.failMap.has(cardId))
            this.failMap.set(cardId, []);

        this.failMap.get(cardId).push({store: storeName});
    }

    //Get a map of failed queries
    getFails()
    {
        return this.failMap;
    }


    //Get a map of cheapest cards
    getBestPrices()
    {
        var result = new Map();

        //For each card
        for (let [key, val] of this.getBestStorePrices())
        {
            //Get the single best priced card of all stores
            var sorted = val.sort(Util.sortByPrice);
            result.set(key, sorted[0]);
        }

        return result;
    }

    //Get a map of cards with the cheapest price for all stores
    getBestStorePrices()
    {
        var result = new Map();

        //For each card
        for (let [key, val] of this.resultMap)
        {
            var sorted = val.sort(Util.sortByStoreThenPrice);
            result.set(key, []);

            //For each store, get the best price
            var storesDone = [];
            for (var j = 0; j < sorted.length; ++j)
            {
                if (storesDone.includes(sorted[j]['store']))
                    continue;

                result.get(key).push({store: sorted[j]['store'], count: sorted[j]['count'], price: sorted[j]['price']});
                storesDone.push(sorted[j]['store']);
            }
        }

        return result;
    }

    //Total sum for all cards with the best stores
    getBestSum()
    {
        var result = 0;
        for (let [key, val] of this.getBestPrices())
            result += val['price'];
        return result;
    }

    //Per-store sum of card prices
    getStoreSums()
    {
        var result = new Map();
        for (let [id, val] of this.getBestStorePrices())
        {
            for (var i = 0; i < val.length; ++i)
            {
                var key = val[i]['store'];
                if (!result.has(key))
                    result.set(key, 0);
                
                if (val[i]['count'] > 0)
                    result.set(key, result.get(key) + val[i]['price']);
            }
        }
        return result;
    }
}

//Base class for stores, contains generic logic
class Store
{
    constructor(name, url)
    {
        this.name = name;
        this.url = url;
        this.proxy = "https://cors-anywhere.herokuapp.com/";
        this.cellId = name + "Price";
        this.sumId = name + "Sum";
    }

    //Executes upon an AJAX request succeeding
    ajaxSuccess(result, cardName, rowId)
    {
        //Parse the resulting HTML into a list of card info objects
        try
        {
            var html = $.parseHTML(result);
            var cardData = this.parseReply(html, cardName);
            var filteredStock = [];
            if (cardData == undefined)
                console.log("parseReply (" + this.name + ", " + cardName + "): invalid response!"); //This will fall through to the N/A result
            else
            {
                //Remove cards with incorrect names
                var filteredNames = cardData.filter(function f(val) { return Util.filterCorrectName(val.name, cardName, Settings.badWords);});

                //Log all incorrect finds to console
                let diff = cardData.filter(x => !filteredNames.includes(x));
                diff.forEach(x => console.log(this.name + ": " + x.name + " is not " + cardName));

                //Remove cards not in stock
                filteredStock = filteredNames.filter(Util.filterInStock);
            }

            //Add data to results
            if (filteredStock.length == 0)
                GlobalResults.addFail(rowId, this.name);
            else
                for (var i = 0; i < filteredStock.length; ++i)
                        GlobalResults.addResult(rowId, {store: this.name, count: filteredStock[i]['count'], price: filteredStock[i]['price']});

            //If there is no data, fill N/A into the relevant cell and return
            /*if (filteredStock.length == 0)
            {
                Site.fillCell(rowId, this.cellId, "N/A", "stockEmpty");
                GlobalStoreSums.get(this.name).hasAll = false;
            }
            else
            {
                //Sort results by price, ascending
                var sortedData = filteredStock.sort(Util.sortByPrice);

                //Add to global results
                GlobalQueryResults[rowId].push([this.name, sortedData]);

                //Display the best price with the proper highlight
                var count = sortedData[0]['count'];
                var cellClass = count > 3 ? "stockOk" : (count > 0 ? "stockLow" : "stockEmpty");
                var price = sortedData[0]['price']
                Site.fillCell(rowId, this.cellId, price, cellClass);
                GlobalStoreSums.get(this.name).sum += price;
            }*/
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
        Site.fillCell(rowId, this.cellId, "FAIL", "stockEmpty");
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
        var thisClass = this;
        var successFunc = function f(r) { thisClass.ajaxSuccess(r, cardName, rowId); };
        var failFunc = function f() { thisClass.ajaxFail(rowId); };

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
        super("Rytir", "https://www.cernyrytir.cz/index.php3?akce=3");
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
        var table = $(html).find('table.kusovkytext')[1];
        var trlist = $(table).find('tbody').find('tr');
        if (table == undefined || trlist == undefined || trlist.length == 0)
            return undefined;
    
        var results = [];
        for(var i = 0; i < trlist.length; i += 0)
        {
            try
            {
                var tt = $(trlist[i++]);
                var name = tt.find('font')[0].innerText;        
                i++;
                var tds = $(trlist[i++]).find('td');
                var count = parseInt($(tds[1]).find('font')[0].innerText.split(' ')[0]);
                var price = parseInt($(tds[2]).find('font')[0].innerText.split(' ')[0]);        
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
        super("Najada", "https://www.najada.cz/cz/kusovky-mtg/");
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
        var table = $(html).find('table.tabArt')[0];
        var trlist = $(table).find('tr');
        if (table == undefined || trlist == undefined || trlist.length == 0)
            return undefined;

        var results = [];
        var prevName = "";
        for(var i = 1; i < trlist.length; ++i)
        {
            try
            {
                var name = $(trlist[i]).find('.tdTitle')[0].innerText.trim();

                 //Use previous name if next entry is nameless
                if (name == "")
                    name = prevName;
                else
                    prevName = name;

                var priceCount = $(trlist[i]).find('.tdPrice')[0].innerText.trim().split(' ');
                var price = parseInt(priceCount[0]);
                var count = parseInt(priceCount[2].substring(1, priceCount[2].length - 1));
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
        super("Lotus", "http://www.blacklotus.cz/magic-vyhledavani/");
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
        var lists = $(html).find('#list');
        var divs = $(lists[0]).find('.inner');
        if (lists == undefined || divs == undefined || divs.length == 0)
            return undefined;

        var results = [];
        for(var i = 0; i < divs.length; ++i)
        {
            try
            {
                var name = $(divs[i]).find('h2')[0].innerText;
                var prices = $(divs[i]).find('.prices');
                var dds = $(prices[0]).find('dd');
                var count = 0;
                if ($(dds[0]).find('.stock_quantity').length > 0)
                {
                    count = $(dds[0]).find('.stock_quantity')[0].innerText.split(' ')[0];
                    count = parseInt(count.substring(1, count.length));
                }
                var priceStr = $(prices[1]).find('.cenasdph')[0].innerText.split('K')[0].replace(/,/g, '.').replace(/\s/g, '');
                var price = Math.ceil(parseFloat(priceStr));
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
        super("Rishada", "http://rishada.cz/hledani");
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
        var tables = $(html).find('.buytable');
        var trs = $(tables[0]).find('tr');
        if (tables == undefined || trs == undefined || trs.length == 0)
            return undefined;

        var results = [];
        for(var i = 1; i < trs.length; ++i)
        {
            try
            {
                var tds = $(trs[i]).find('td');
                var name = $(tds[0]).find('a')[0].innerText;
                var price = parseInt(tds[5].innerText.split(' ')[0]);
                var count = parseInt(tds[6].innerText.split(' ')[0]);
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
    static fillCell(rowId, cellId, value, cellClass = undefined)
    {
        var content = (cellClass == undefined) ? value : ("<span class=\"" + cellClass + "\">" + value + "</span>");
        $("#row_" + rowId + " > #" + cellId)[0].innerHTML = content;
    }

    //Get an array of card data from the textarea. Filters out empty lines
    static getCards()
    {
        var cards = $('textarea#card_list').val().split("\n").filter(function (e) { return e != ""; });
        var result = [];
        for (var i = 0; i < cards.length; ++i)
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
        for (var i = 0; i < cards.length; ++i)
        {
            var contents =  "<tr id=\"row_" + i + "\">";
                contents += "<td  class=\"name\" id=\"cardname\">" + cards[i] + "</td>";

                GlobalStores.forEach(s => contents += "<td class=\"value\" id=\"" + s.name + "Price\"></id>");

                contents += "<td class=\"name\" id=\"bestStore\"></id>";
                contents += "<td class=\"value\" id=\"bestPrice\"></id>";
                contents += "</tr>";
            $("#result_table > tbody").append(contents);
        }
    }

    //Create the last row of the table with sums and display the sum legend
    static createSumRow()
    {
        var contents =  "<tr id=\"row_sum\">";
            contents += "<td class=\"name\" id=\"sumname\"><b>Celkem</b></td>";
            
            GlobalStores.forEach(s => contents += "<td class=\"value\" id=\"" + s.name + "Sum\"></id>");

            contents += "<td class=\"name\" id=\"storeStats\"></id>";
            contents += "<td class=\"value\" id=\"bestSum\"><b></b></id>";
            contents += "</tr>";
        $("#result_table > tbody").append(contents);
        $("#sum_legend").css("display", "block");
    }

    //Clears the table except for the header
    static clearTable()
    {
        $("#result_table > tbody:last").children().remove();
        $("#sum_legend").css("display", "none");
    }

    //Refreshes the table
    static refreshTable()
    {
        for (let [id, data] of GlobalResults.getBestStorePrices())
        {
            for (var i = 0; i < data.length; ++i)
            {
                var cellClass = data[i]['count'] > 3 ? "stockOk" : (data[i]['count'] > 0 ? "stockLow" : "stockEmpty");
                this.fillCell(id, data[i]['store'] + "Price", data[i]['price'], cellClass);
            }
        }

        for (let [id, data] of GlobalResults.getFails())
        {
            for (var i = 0; i < data.length; ++i)
            {
                this.fillCell(id, data[i]['store'] + "Price", "N/A", "stockEmpty");
            }
        }
    }

    //Assumes the table is fully populated and computes the sums and best stores
    /*static finalizeTable()
    {
        var bestSum = 0;
        var storeCounts = new Map();
        GlobalStores.forEach(s => storeCounts.set(s.name, {count: 0}));

        for (var i = 0; i < GlobalQueryResults.length; ++i)
        {
            try
            {
                //If no results exist
                if (GlobalQueryResults[i] == undefined || GlobalQueryResults[i].length == 0)
                {
                    Site.fillCell(i, "bestPrice", "N/A", "stockEmpty");
                    continue;
                }
                
                //Extract data from results
                var extractedResults = [];
                for (var j = 0; j < GlobalQueryResults[i].length; ++j)
                {
                    var store = GlobalQueryResults[i][j][0];
                    var sorted = GlobalQueryResults[i][j][1];
                    var price = sorted[0]['price'];
                    var count = sorted[0]['count'];
                    var name = sorted[0]['name'];
                    extractedResults.push({price, count, name, store});
                }

                var sortedResults = extractedResults.sort(Util.sortByPrice);

                //If we have a valid result, update the total sum and relevant cells
                if (sortedResults != undefined && sortedResults.length > 0)
                {
                    var bestResult = sortedResults[0];

                    bestSum += bestResult['price'];
                    var cellClass = bestResult['count'] > 3 ? "stockOk" : (bestResult['count'] > 0 ? "stockLow" : "stockEmpty");
                    var priceHtml = bestResult['price']
                    var store = bestResult['store'];
                    var storeText = store + " (" + bestResult['name'] + ")";

                    Site.fillCell(i, "bestPrice", priceHtml, cellClass);
                    Site.fillCell(i, "bestStore", storeText);

                    //Add 1 to the specified store counter
                    storeCounts.get(store).count += 1;
                }
            }
            catch (e)
            {
                Site.fillCell(i, "bestPrice", "FAILED", "stockEmpty");
                console.error("finalizeTable: " + e.message);
            }
        }

        //Create sum row
        if ($("#row_sum").length == 0)
        Site.createSumRow();

        //Fill sums for stores
        for (var i = 0; i < GlobalStores.length; ++i)
        {
            var result = GlobalStoreSums.get(GlobalStores[i].name);
            var cellClass = result.hasAll ? "stockOk" : "stockEmpty";
            Site.fillCell("sum", GlobalStores[i].sumId, result.sum, cellClass);
        }

        //Fill best sum
        Site.fillCell("sum", "bestSum", bestSum);

        //Fill store stats
        var storeStats = "";
        for (var i = 0; i < GlobalStores.length; ++i)
        {
            var store = GlobalStores[i].name;
            storeStats += store + ": " + storeCounts.get(store).count;
            if (i != GlobalStores.length - 1)
                storeStats += ", ";
        }
        Site.fillCell("sum", "storeStats", storeStats);
    }*/
}

//Resets everything and starts the price-checking process
function checkPrices()
{
    //Clear old results
    GlobalRequestsSent = 0;
    GlobalRequestsCompleted = 0;
    GlobalQueryResults = [];
    Site.clearTable();

    //Initialize stores and store totals
    GlobalStores = [new Rytir(), new Najada(), new Lotus(), new Rishada()];
    GlobalResults = new Results();
    GlobalStoreSums = new Map();
    GlobalStores.forEach(s => GlobalStoreSums.set(s.name, {sum: 0, hasAll: true}));

    //Initialize cards
    GlobalCards = Site.getCards();
    for (var i = 0; i < GlobalCards.length; ++i)
        GlobalQueryResults.push([]);  

    //Initialize table
    Site.createTableWithCards(GlobalCards);
    Site.updateCounter(0, GlobalCards.length);

    //Send queries
    console.log("Checking " + GlobalCards.length + " cards");
    for (var i = 0; i < GlobalCards.length; ++i)
       GlobalStores.forEach(s => s.executeQuery(GlobalCards[i], i));
}

//Assumes the table is fully populated and computes the sums and best stores
function finalizeTable()
{
    //Fill best price for each card
    var bestPrices = GlobalResults.getBestPrices();
    for (var i = 0; i < GlobalCards.length; ++i)
    {
        if (!bestPrices.has(i))
        {
            Site.fillCell(i, "bestPrice", "N/A", "stockEmpty");
            continue;
        }

        var data = bestPrices.get(i);
        var cellClass = data['count'] > 3 ? "stockOk" : (data['count'] > 0 ? "stockLow" : "stockEmpty");
        Site.fillCell(i, "bestPrice", data['price'], cellClass);
    }

    //Create sum row if it doesn't yet exist
    if ($("#row_sum").length == 0)
        Site.createSumRow();

    //Fill store sums
    var storeSums = GlobalResults.getStoreSums();
    for (var i = 0; i < GlobalStores.length; ++i)
    {
        var store = GlobalStores[i].name;
        if (!storeSums.has(store))
        {
            Site.fillCell("sum", store + "Sum", 0, "stockEmpty");
            continue;
        }

        //TODO style
        Site.fillCell("sum", store + "Sum", storeSums.get(store));
    }

    //Fill best sum
    Site.fillCell("sum", "bestSum", GlobalResults.getBestSum());

    //Fill store stats
    /*var storeStats = "";
    for (var i = 0; i < GlobalStores.length; ++i)
    {
        var store = GlobalStores[i].name;
        storeStats += store + ": " + storeCounts.get(store).count;
        if (i != GlobalStores.length - 1)
            storeStats += ", ";
    }
    Site.fillCell("sum", "storeStats", storeStats);*/
}