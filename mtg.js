//v0.5, (c) dex 2020
var GlobalCards;
var GlobalQueryResults;
var GlobalRequestsSent;
var GlobalRequestsReceived;
var GlobalStores;
var GlobalStoreSums;

class Settings
{
    static badWords = ["emblem", "oversized", "art series"];
}

class Store
{
    constructor(name, shortName, url)
    {
        this.name = name;
        this.shortName = shortName.toLowerCase();
        this.url = url;
        this.proxy = "https://cors-anywhere.herokuapp.com/"; //TODO: Find a proxy with higher allowed throughput
        this.cellId = shortName + "Price";
        this.sumId = shortName + "Sum";
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
                var filteredNames = cardData.filter(function f(val) { return filterCorrectName(val.name, cardName, Settings.badWords);});

                //Log all incorrect finds to console
                let diff = cardData.filter(x => !filteredNames.includes(x));
                diff.forEach(x => console.log(this.name + ": " + x.name + " is not " + cardName));

                //Remove cards not in stock
                filteredStock = filteredNames.filter(filterInStock);
            }

            //If there is no data, fill N/A into the relevant cell and return
            if (filteredStock.length == 0)
            {
                fillCell(rowId, this.cellId, "N/A", "stockEmpty");
                GlobalStoreSums.get(this.name).hasAll = false;
            }
            else
            {
                //Sort results by price, ascending
                var sortedData = filteredStock.sort(sortByPrice);

                //Add to global results
                GlobalQueryResults[rowId].push([this.name, sortedData]);

                //Display the best price with the proper highlight
                var count = sortedData[0]['count'];
                var cellClass = count > 3 ? "stockOk" : (count > 0 ? "stockLow" : "stockEmpty");
                var price = sortedData[0]['price']
                fillCell(rowId, this.cellId, price, cellClass);
                GlobalStoreSums.get(this.name).sum += price;
            }
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
        fillCell(rowId, this.cellId, "FAIL", "stockEmpty");
        this.completeRequest();
    }

    //Completes a query request and finalizes the table if this was the last one
    completeRequest()
    {
        ++GlobalRequestsCompleted;
        updateCounter(GlobalRequestsCompleted, GlobalRequestsSent);

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

//cernyrytir.cz store object
class Rytir extends Store
{
    constructor()
    {
        super("Rytir", "cr", "https://www.cernyrytir.cz/index.php3?akce=3");
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
        super("Najada", "nj", "https://www.najada.cz/cz/kusovky-mtg/");
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
        super("Lotus", "bl", "http://www.blacklotus.cz/magic-vyhledavani/");
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
        super("Rishada", "ri", "http://rishada.cz/hledani");
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

//Assign a value to a specified cell in a specified row. If cellClass is provided, value is placed inside a span with the given class
function fillCell(rowId, cellId, value, cellClass = undefined)
{
    var content = (cellClass == undefined) ? value : ("<span class=\"" + cellClass + "\">" + value + "</span>");
    $("#row_" + rowId + " > #" + cellId)[0].innerHTML = content;
}

//Get an array of card data from the textarea. Filters out empty lines
function getCards()
{
    return $('textarea#card_list').val().split("\n").filter(function (e) { return e != ""; });
}

//Updates the 'processed' counter
function updateCounter(current, total)
{
    $("#doneCounter")[0].innerText = current + "/" + total;
}

//Creates a table with the given array of card names and the rest of cells empty
function createTableWithCards(cards)
{
    for (var i = 0; i < cards.length; ++i)
    {
        var contents =  "<tr id=\"row_" + i + "\">";
            contents += "<td  class=\"name\" id=\"cardname\">" + cards[i] + "</td>";
            contents += "<td class=\"value\" id=\"crPrice\"></id>";
            contents += "<td class=\"value\" id=\"njPrice\"></id>";
            contents += "<td class=\"value\" id=\"blPrice\"></id>";
            contents += "<td class=\"value\" id=\"riPrice\"></id>";
            contents += "<td class=\"name\" id=\"bestStore\"></id>";
            contents += "<td class=\"value\" id=\"bestPrice\"></id>";
            contents += "</tr>";
        $("#result_table > tbody").append(contents);
    }
}

function createSumRow()
{
    var contents =  "<tr id=\"row_sum\">";
        contents += "<td class=\"name\" id=\"sumname\"><b>Celkem</b></td>";
        contents += "<td class=\"value\" id=\"crSum\"></id>";
        contents += "<td class=\"value\" id=\"njSum\"></id>";
        contents += "<td class=\"value\" id=\"blSum\"></id>";
        contents += "<td class=\"value\" id=\"riSum\"></id>";
        contents += "<td class=\"name\"></id>";
        contents += "<td class=\"value\" id=\"bestSum\"><b></b></id>";
        contents += "</tr>";
    $("#result_table > tbody").append(contents);
    $("#sum_legend").css("display", "block");
}

//Clears the table except for the header
function clearTable()
{
    $("#result_table > tbody:last").children().remove();
    $("#sum_legend").css("display", "none");
}

//Sorts objects by 'price' in ascending order
function sortByPrice(a, b)
{
    var pa = a['price'];
    var pb = b['price'];
    return (pa > pb) ? 1 : ((pa < pb) ? -1 : 0);
}

//Filters out objects where 'count' is zero or nonexistent
function filterInStock(obj)
{
    return obj['count'] != undefined && obj['count'] > 0;
}

 //Check whether the name matches while ignoring nonalphanumeric characters
function filterCorrectName(suspectedCard, cardName, badWords)
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

//Resets everything and starts the price-checking process
function checkPrices()
{
    //Clear old results
    GlobalRequestsSent = 0;
    GlobalRequestsCompleted = 0;
    GlobalQueryResults = [];
    clearTable();

    //Initialize stores and store totals
    GlobalStores = [new Rytir(), new Najada(), new Lotus(), new Rishada()];
    GlobalStoreSums = new Map();
    GlobalStores.forEach(s => GlobalStoreSums.set(s.name, {sum: 0, hasAll: true}));

    //Initialize cards
    GlobalCards = getCards();
    for (var i = 0; i < GlobalCards.length; ++i)
        GlobalQueryResults.push([]);  

    //Initialize table
    createTableWithCards(GlobalCards);
    updateCounter(0, GlobalCards.length);

    //Send queries
    console.log("Checking " + GlobalCards.length + " cards");
    for (var i = 0; i < GlobalCards.length; ++i)
       GlobalStores.forEach(s => s.executeQuery(GlobalCards[i], i));
}

function finalizeTable()
{
    var bestSum = 0;

    for (var i = 0; i < GlobalQueryResults.length; ++i)
    {
        try
        {
            //If no results exist
            if (GlobalQueryResults[i] == undefined || GlobalQueryResults[i].length == 0)
            {
                fillCell(i, "bestPrice", "N/A", "stockEmpty");
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

            var sortedResults = extractedResults.sort(sortByPrice);

            //If we have a valid result, update the total sum and relevant cells
            if (sortedResults != undefined && sortedResults.length > 0)
            {
                var bestResult = sortedResults[0];

                bestSum += bestResult['price'];
                var cellClass = bestResult['count'] > 3 ? "stockOk" : (bestResult['count'] > 0 ? "stockLow" : "stockEmpty");
                var priceHtml = bestResult['price']
                var storeText = bestResult['store'] + " (" + bestResult['name'] + ")";

                fillCell(i, "bestPrice", priceHtml, cellClass);
                fillCell(i, "bestStore", storeText);
            }
        }
        catch (e)
        {
            fillCell(i, "bestPrice", "FAILED", "stockEmpty");
            console.error("finalizeTable: " + e.message);
        }
    }

    //Create sum row
    if ($("#row_sum").length == 0)
        createSumRow();

    //Fill sums for stores
    for (var i = 0; i < GlobalStores.length; ++i)
    {
        var result = GlobalStoreSums.get(GlobalStores[i].name);
        var cellClass = result.hasAll ? "stockOk" : "stockEmpty";
        fillCell("sum", GlobalStores[i].sumId, result.sum, cellClass);
    }

    //Fill best sum
    fillCell("sum", "bestSum", bestSum);
}