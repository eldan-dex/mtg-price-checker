var proxy = 'https://cors-anywhere.herokuapp.com/';
var crURL = "https://www.cernyrytir.cz/index.php3?akce=3";
var njURL = "https://www.najada.cz/cz/kusovky-mtg/";
var blURL = "http://www.blacklotus.cz/magic-vyhledavani/"
var riURL = "http://rishada.cz/hledani"
var requestsSent = 0;
var requestsCompleted = 0;
var cards;
var queryResults;

class Store
{
    constructor(name, shortName, url)
    {
        this.name = name;
        this.shortName = shortName.toLowerCase();
        this.url = url;
        this.priceId = shortName + "Price";
    }
}


function Ajax_fail(rowId, store)
{
    $("#row_" + rowId + " > #" + store.priceId)[0].innerHTML = "<span class=\"stockEmpty\">FAIL</span>";
    ++requestsCompleted;
}

function Ajax_success(result, cardName, rowId, store)
{

}

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

function tryFinalizeTable(force = false)
{
    $("#doneCounter")[0].innerText = requestsCompleted + "/" + requestsSent;

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
            results.sort(sortByPrice);
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
        //contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        //contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        //contents += "<td class=\"value\"></id>";
        contents += "<td class=\"value\"></id>";
        //contents += "<td class=\"value\"></id>";
        contents += "<td class=\"name\"></id>";
        contents += "<td class=\"value\" id=\"bestSum\"><b>" + bestSum + "</b></id>";
        contents += "</tr>";
        $("#result_table > tbody").append(contents);
}

function sortByPrice(a, b) {
    var pa = a['price'];
    var pb = b['price'];
    return (pa > pb) ? 1 : ((pa < pb) ? -1 : 0);
}

function filterInStock(obj) {
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
    if (tmp.includes("emblem"))
        return false;

    return true;
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