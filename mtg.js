var GlobalCards;
var GlobalQueryResults;

class Store
{
    constructor(name, shortName, url)
    {
        this.name = name;
        this.shortName = shortName.toLowerCase();
        this.url = url;
        this.proxy = "https://cors-anywhere.herokuapp.com/"; //TODO: Find a proxy with higher allowed throughput
        this.cellId = shortName + "Price";
        this.requestsSent = 0;
        this.requestsCompleted = 0;
    }

    //Executes upon an AJAX request succeeding
    ajaxSuccess(result, cardName, rowId)
    {
        //Parse the resulting HTML into a list of card info objects
        try
        {
            var html = $.parseHTML(result);
            var cardData = this.parseReply(html, cardName);
            if (cardData == undefined)
                console.log("parseReply (" + this.name + ", " + cardName + "): invalid response!"); //This will fall through to the N/A result

            //Remove cards not in stock
            var filteredData = cardData.filter(filterInStock);

            //If there is no data, fill N/A into the relevant cell and return
            if (filteredData.length == 0)
                fillCell(rowId, this.cellId, "N/A", "stockEmpty");
            else
            {
                //Sort results by price, ascending
                var sortedData = filteredData.sort(sortByPrice);

                //Add to global results
                GlobalQueryResults[rowId].push([this.name, sortedData]);

                //Display the best price with the proper highlight
                var count = sortedData[0]['count'];
                var cellClass = count > 3 ? "stockOk" : (count > 0 ? "stockLow" : "stockEmpty");
                fillCell(rowId, this.cellId, sortedData[0]['price'], cellClass);
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
        ++this.requestsCompleted;
        updateCounter(requestsCompleted, requestsSent);

        if (this.requestsCompleted >= this.requestsSent)
            finalizeTable();
    }

    //Executes an async AJAX query for the specified card name and row ID
    executeQuery(cardName, rowId)
    {
        var thisClass = this;
        var successFunc = function f(r) { thisClass.ajaxSuccess(r, cardName, rowId); };
        var failFunc = function f() { thisClass.ajaxFail(rowId); };

        //Increment request counter BEFORE requests are sent, so that an immediate resolve has no chance of accidentally triggering table finalization
        ++this.requestsSent; 

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
                if (!isCardCorrect(name, cardName))
                {
                    console.log(this.name + ": " + name + " is not " + cardName);
                    i += 2;
                    continue;
                }
        
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
        for(var i = 1; i < trlist.length; ++i)
        {
            try
            {
                var name = $(trlist[i]).find('.tdTitle')[0].innerText.trim();
                if (!isCardCorrect(name, cardName))
                {
                    console.log(this.name + ": " + name + " is not " + cardName);
                    continue;
                }

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

        results = [];
        for(var i = 0; i < divs.length; ++i)
        {
            try
            {
                var name = $(divs[i]).find('h2')[0].innerText;
                if (!isCardCorrect(name, cardName))
                {
                    console.log(this.name + ": " + name + " is not " + cardName);
                    continue;
                }

                var prices = $(divs[i]).find('.prices');
                var dds = $(prices[0]).find('dd');
                var count = $(dds[0]).find('.stock_quantity')[0].innerText.split(' ')[0];
                count = parseInt(count.substring(1, count.length));
                var priceStr = $(prices[1]).find('.cenasdph')[0].innerText.split(' ')[0].replace('/,/g', '.');
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

        results = [];
        for(var i = 1; i < trs.length; ++i)
        {
            try
            {
                var tds = $(trs[i]).find('td');
                var name = $(tds[0]).find('a')[0].innerText;
                if (!isCardCorrect(name, cardName))
                {
                    console.log(this.name + ": " + name + " is not " + cardName);
                    continue;
                }

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

function createSumRow(sum)
{
    var contents =  "<tr id=\"row_sum\">";
        contents += "<td  class=\"name\" id=\"sumname\"><b>Celkem</b></td>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"name\"></id>";
        contents += "<td class=\"value\" id=\"bestSum\"><b>" + sum + "</b></id>";
        contents += "</tr>";
    $("#result_table > tbody").append(contents);
}

//Clears the table except for the header
function clearTable()
{
    $("#result_table > tbody:last").children().remove();
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
function isCardCorrect(suspectedCard, cardName)
{
    var sus = suspectedCard.replace(/\W/g, '').toLowerCase();
    var corr = cardName.replace(/\W/g, '').toLowerCase();
    if (!sus.includes(corr))
        return false;

    var tmp = sus.replace(corr, "").trim();
    if (tmp.includes("emblem") || tmp.includes("oversized"))
        return false;

    return true;
}

//Resets everything and starts the price-checking process
function checkPrices()
{
    //Clear old results
    requestsSent = 0;
    requestsCompleted = 0;
    GlobalQueryResults = [];
    clearTable();

    //Initialize data
    var stores = [new Rytir(), new Najada(), new Lotus(), new Rishada()];
    GlobalCards = getCards();
    for (var i = 0; i < GlobalCards.length; ++i)
        GlobalQueryResults.push([]);

    createTableWithCards(GlobalCards);
    updateCounter(0, GlobalCards.length);

    //Send queries
    console.log("Checking " + GlobalCards.length + " cards");
    for (var i = 0; i < GlobalCards.length; ++i)
       stores.forEach(store => store.executeQuery(GlobalCards[i], i));
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

            //If we have a valid result, update the total sum and relevant cells
            if (extractedResults != undefined && extractedResults.length > 0)
            {
                var bestResult = extractedResults[0];

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
    createSumRow(bestSum);
}

/*
function tryFinalizeTable(force = false)
{
    updateCounter(requestsCompleted, requestsSent);
    
    if (!force && requestsCompleted < requestsSent)
        return;

    //All requests have resolved, finalize table
    var bestSum = 0;
    for (var i = 0; i < queryResults.length; ++i)
    {
        //If no results exist
        if (queryResults[i] == undefined || queryResults[i].length == 0)
        {
            $("#row_" + i + " > #bestPrice")[0].innerHTML = "<span class=\"stockEmpty\">N/A</span>";
            $("#row_" + i + " > #bestStore")[0].innerText = "N/A";
            continue;
        }

        var results = [];
        for (var j = 0; j < queryResults[i].length; ++j)
        {
            var store = queryResults[i][j][0];
            var sorted = queryResults[i][j][1];
            var price = sorted[0]['price'];
            var count = sorted[0]['count'];
            var name = sorted[0]['name'];
            results.push({price, count, name, store});
        }

        if (results != undefined && results.length > 0)
        {
            bestSum += results[0]['price'];

            var span = "<span class=\"" + (results[0]['count'] > 3 ? "stockOk" : (results[0]['count'] > 0 ? "stockLow" : "stockEmpty")) + "\">";
            var priceHtml = span + results[0]['price'] + "</span>";

            $("#row_" + i + " > #bestPrice")[0].innerHTML = priceHtml;
            $("#row_" + i + " > #bestStore")[0].innerText = results[0]['store'] + " (" + results[0]['name'] + ")";
        }
    }

    var contents = "<tr id=\"row_sum\">";
        contents += "<td  class=\"name\" id=\"sumname\"><b>Celkem</b></td>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        contents += "<td class=\"name\"></id>";
        contents += "<td class=\"value\" id=\"bestSum\"><b>" + bestSum + "</b></id>";
        contents += "</tr>";
        $("#result_table > tbody").append(contents);
}

/*
function checkPrices()
{
    //Clear old results
    requestsSent = 0;
    requestsCompleted = 0;

    cards = [];
    queryResults = [];

    $("#result_table > tbody:last").children().remove();

    //Get cards
    cards = $('textarea#card_list').val().split("\n").filter(function (e) { return e != ""; });

    //Refresh info
    $("#doneCounter")[0].innerText = 0 + "/" + cards.length;
    
    //Initialize result storage
    for (var i = 0; i < cards.length; ++i)
        queryResults.push([]);

    //Create table
    for (var i = 0; i < cards.length; ++i)
    {
        var contents = "<tr id=\"row_" + i + "\">";
        contents += "<td  class=\"name\" id=\"cardname\">" + cards[i] + "</td>";
        contents += "<td class=\"value\" id=\"crPrice\"></id>";
        //contents += "<td class=\"value\" id=\"crCount\"></id>";
        contents += "<td class=\"value\" id=\"njPrice\"></id>";
        //contents += "<td class=\"value\" id=\"njCount\"></id>";
        contents += "<td class=\"value\" id=\"blPrice\"></id>";
        //contents += "<td class=\"value\" id=\"blCount\"></id>";
        contents += "<td class=\"value\" id=\"riPrice\"></id>";
        //contents += "<td class=\"value\" id=\"riCount\"></id>";
        contents += "<td class=\"name\" id=\"bestStore\"></id>";
        contents += "<td class=\"value\" id=\"bestPrice\"></id>";
        contents += "</tr>";
        $("#result_table > tbody").append(contents);
    }

    //Send queries
    console.log("Will check " + cards.length + " cards");
    for (var i = 0; i < cards.length; ++i)
    {
        console.log("Checking " + cards[i]);
        CR_query(cards[i], i);
        NJ_query(cards[i], i);
        BL_query(cards[i], i);
        RI_query(cards[i], i);
    }
}



///////////////////////////////////////////////////////////////////////////
//Rishada.cz
///////////////////////////////////////////////////////////////////////////
function RI_query(cardName, rowId)
{
    console.log("RI Query for " + cardName);
    ++requestsSent;
    $.get(proxy + riURL + RI_getQuery(cardName), function f(r) { RI_onReceive(r, cardName, rowId); }).fail(RI_onFail);
}

function RI_onFail()
{
    console.log("RI FAILED");
    ++requestsCompleted;
}

function RI_onReceive(response, cardName, rowId)
{
    var result = RI_parseHTML(response, cardName);
    result = result.filter(filterInStock);

    if (result.length == 0)
    {
        $("#row_" + rowId + " > #riPrice")[0].innerHTML = "<span class=\"stockEmpty\">N/A</span>";
        //$("#row_" + rowId + " > #riCount")[0].innerText = "N/A";
        ++requestsCompleted;
        return;
    }

    var sorted = result.sort(sortByPrice);
    queryResults[rowId].push(["Rishada", sorted]);

    var count = sorted[0]['count'];
    var span = "<span class=\"" + (count > 3 ? "stockOk" : (count > 0 ? "stockLow" : "stockEmpty")) + "\">";
    var priceHtml = span + sorted[0]['price']; + "</span>";

    $("#row_" + rowId + " > #riPrice")[0].innerHTML = priceHtml;
    //$("#row_" + rowId + " > #riCount")[0].innerText = count;

    ++requestsCompleted;
    tryFinalizeTable();
}

function RI_getQuery(cardName)
{
    return "?fulltext=" + encodeURIComponent(cardName);
}

function RI_parseHTML(htmlString, cardName)
{
    var html = $.parseHTML(htmlString);
    var tables = $(html).find('.buytable');
    var trs = $(tables[0]).find('tr');
    
    if (tables == undefined || trs == undefined || trs.length == 0)
    {
        console.log("Got invalid response!");
        return undefined;
    }

    results = [];
    for(var i = 1; i < trs.length; ++i)
    {
        var tds = $(trs[i]).find('td');
        var name = $(tds[0]).find('a')[0].innerText;

        if (!isCardCorrect(name, cardName))
        {
            console.log("CR: " + name + " is not " + cardName);
            continue;
        }

        var priceStr = tds[5].innerText.split(' ')[0];
        var countStr = tds[6].innerText.split(' ')[0];
        var count = parseInt(countStr);
        var price = parseInt(priceStr);

        //console.log(name + " | " + count + " | " + price);
        results.push({name, count, price});

    }

    return results;
}
///////////////////////////////////////////////////////////////////////////
//BlackLotus.cz
///////////////////////////////////////////////////////////////////////////
function BL_query(cardName, rowId)
{
    console.log("BL Query for " + cardName);
    ++requestsSent;
    $.get(proxy + blURL + BL_getQuery(cardName), function f(r) { BL_onReceive(r, cardName, rowId); }).fail(BL_onFail);
}

function BL_onFail()
{
    console.log("BL FAILED");
    ++requestsCompleted;
}

function BL_onReceive(response, cardName, rowId)
{
    var result = BL_parseHTML(response, cardName);
    result = result.filter(filterInStock);

    if (result.length == 0)
    {
        $("#row_" + rowId + " > #blPrice")[0].innerHTML = "<span class=\"stockEmpty\">N/A</span>";
        //$("#row_" + rowId + " > #blCount")[0].innerText = "N/A";
        ++requestsCompleted;
        return;
    }

    var sorted = result.sort(sortByPrice);
    queryResults[rowId].push(["Lotus", sorted]);

    var count = sorted[0]['count'];
    var span = "<span class=\"" + (count > 3 ? "stockOk" : (count > 0 ? "stockLow" : "stockEmpty")) + "\">";
    var priceHtml = span + sorted[0]['price']; + "</span>";

    $("#row_" + rowId + " > #blPrice")[0].innerHTML = priceHtml;
    //$("#row_" + rowId + " > #blCount")[0].innerText = count;

    ++requestsCompleted;
    tryFinalizeTable();
}

function BL_getQuery(cardName)
{
    return "?page=search&search=" + btoa("nazev;" + cardName + ";popis;;15;0;4;0;7;0;from13;;to13;;from14;;to14;;from12;;to12;;pricemin;;pricemax;;6;0") + "&catid=3";
}

function BL_parseHTML(htmlString, cardName)
{
    var html = $.parseHTML(htmlString);
    var lists = $(html).find('#list');
    var divs = $(lists[0]).find('.inner');
    
    if (lists == undefined || divs == undefined || divs.length == 0)
    {
        console.log("Got invalid response!");
        return undefined;
    }

    results = [];
    for(var i = 0; i < divs.length; ++i)
    {
        try
        {
            var name = $(divs[i]).find('h2')[0].innerText;

            if (!isCardCorrect(name, cardName))
            {
                console.log("BL: " + name + " is not " + cardName);
                continue;
            }

            var prices = $(divs[i]).find('.prices');
            var dds = $(prices[0]).find('dd');
            var count = $(dds[0]).find('.stock_quantity')[0].innerText.split(' ')[0];
            count = parseInt(count.substring(1, count.length));
            var priceStr = $(prices[1]).find('.cenasdph')[0].innerText.split(' ')[0].replace('/,/g', '.');
            var price = Math.ceil(parseFloat(priceStr));

            //console.log(name + " | " + count + " | " + price);
            results.push({name, count, price});
        }
        catch (err) {
            console.log("BL - caught: " + err);
        }
    }

    return results;
}

///////////////////////////////////////////////////////////////////////////
//Najada.cz
///////////////////////////////////////////////////////////////////////////
function NJ_query(cardName, rowId)
{
    console.log("NJ Query for " + cardName);
    ++requestsSent;
    $.get(proxy + njURL + NJ_getQuery(cardName), function f(r) { NJ_onReceive(r, cardName, rowId); }).fail(NJ_onFail);
}

function NJ_onFail()
{
    console.log("NJ FAILED");
    ++requestsCompleted;
}

function NJ_onReceive(response, cardName, rowId)
{
    var result = NJ_parseHTML(response, cardName)
    result = result.filter(filterInStock);

    if (result.length == 0)
    {
        $("#row_" + rowId + " > #njPrice")[0].innerHTML = "<span class=\"stockEmpty\">N/A</span>";
        //$("#row_" + rowId + " > #njCount")[0].innerText = "N/A";
        ++requestsCompleted;
        return;
    }

    var sorted = result.sort(sortByPrice);
    queryResults[rowId].push(["Najada", sorted]);

    var count = sorted[0]['count'];
    var span = "<span class=\"" + (count > 3 ? "stockOk" : (count > 0 ? "stockLow" : "stockEmpty")) + "\">";
    var priceHtml = span + sorted[0]['price']; + "</span>";

    $("#row_" + rowId + " > #njPrice")[0].innerHTML = priceHtml;
    //$("#row_" + rowId + " > #njCount")[0].innerText = count;

    ++requestsCompleted;
    tryFinalizeTable();
}

function NJ_getQuery(cardName)
{
    return "?Search=" + encodeURIComponent(cardName) + "&MagicCardSet=-1";
}

function NJ_parseHTML(htmlString, cardName)
{
    var html = $.parseHTML(htmlString);
    var table = $(html).find('table.tabArt')[0];
    var trlist = $(table).find('tr');

    if (table == undefined || trlist == undefined || trlist.length == 0)
    {
        console.log("Got invalid response!");
        return undefined;
    }

    var results = [];
    for(var i = 1; i < trlist.length; ++i)
    {
        var name = $(trlist[i]).find('.tdTitle')[0].innerText.trim();

        if (!isCardCorrect(name, cardName))
        {
            console.log("NJ: " + name + " is not " + cardName);
            continue;
        }

        var priceCount = $(trlist[i]).find('.tdPrice')[0].innerText.trim().split(' ');
        var price = parseInt(priceCount[0]);
        var count = parseInt(priceCount[2].substring(1, priceCount[2].length - 1));
        results.push({name, count, price});
    }
    return results;
}

///////////////////////////////////////////////////////////////////////////
//CernyRytir.cz
///////////////////////////////////////////////////////////////////////////
function CR_query(cardName, rowId)
{
    console.log("CR Query for " + cardName);
    ++requestsSent;
    $.post(proxy + crURL, CR_getQuery(cardName), function f(r) { CR_onReceive(r, cardName, rowId); }).fail(CR_onFail);
}

function CR_onFail()
{
    console.log("CR FAILED");
    ++requestsCompleted;
}

function CR_onReceive(response, cardName, rowId)
{
    var result = CR_parseHTML(response, cardName);
    result = result.filter(filterInStock);

    if (result.length == 0)
    {
        $("#row_" + rowId + " > #crPrice")[0].innerHTML = "<span class=\"stockEmpty\">N/A</span>";
        //$("#row_" + rowId + " > #crCount")[0].innerText = "N/A";
        ++requestsCompleted;
        return;
    }

    var sorted = result.sort(sortByPrice);
    queryResults[rowId].push(["Rytir", sorted]);

    var count = sorted[0]['count'];
    var span = "<span class=\"" + (count > 3 ? "stockOk" : (count > 0 ? "stockLow" : "stockEmpty")) + "\">";
    var priceHtml = span + sorted[0]['price']; + "</span>";

    $("#row_" + rowId + " > #crPrice")[0].innerHTML = priceHtml;
    //$("#row_" + rowId + " > #crCount")[0].innerText = count;

    ++requestsCompleted;
    tryFinalizeTable();
}

function CR_getQuery(cardName)
{
    return {"edice_magic": "libovolna", "rarita": "A", "foil": "A", "jmenokarty": cardName, "triditpodle": "ceny", "submit": "Vyhledej"};
}

function CR_parseHTML(htmlString, cardName)
{
    var html = $.parseHTML(htmlString);
    var tables = $(html).find('table.kusovkytext');
    var table = tables[1];
    
    var trlist = $(table).find('tbody').find('tr');

    if (table == undefined || trlist == undefined || trlist.length == 0)
    {
        console.log("Got invalid response!");
        return undefined;
    }

    var results = [];
    for(var i = 0; i < trlist.length; i += 0)
    {
        var tt = $(trlist[i++]);
        var font = tt.find('font')[0];
        var name = font.innerText;

        if (!isCardCorrect(name, cardName))
        {
            console.log("CR: " + name + " is not " + cardName);
            i += 2;
            continue;
        }

        i++;
        var tds = $(trlist[i++]).find('td');
        var countStr = $(tds[1]).find('font')[0].innerText.split(' ')[0];
        var priceStr = $(tds[2]).find('font')[0].innerText.split(' ')[0];
        var count = parseInt(countStr);
        var price = parseInt(priceStr);

        //console.log(name + " | " + count + " | " + price);
        results.push({name, count, price});
    }

    return results;
}
*/