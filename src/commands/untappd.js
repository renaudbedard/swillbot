/* global require */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");

/**
 * @param {Number} rating An untappd rating from 0 to 5
 * @return {Number} The exponential rating centered on 3.75
 */
function exponentialRating(rating) {
  return rating / (15.0 - 3.0 * rating);
}

/**
 * @param {string} source The user ID that made the request
 * @param {string} query The original request
 * @param {object[]} beerInfos Untappd's beer info
 * @return {string} The rich slack message
 */
function formatBeerInfoSlackMessage(source, query, beerInfos) {
  // See https://api.slack.com/docs/message-formatting
  let slackMessage = {
    response_type: "in_channel",
    attachments: []
  };

  // add in-error attachments first
  for (let beerInfo of beerInfos) {
    if (beerInfo.inError) {
      let attachment = {
        color: "#ff0000",
        text: `*Couldn't find matching beer for :* \`${beerInfo.query}\``
      };
      slackMessage.attachments.push(attachment);
    }
  }

  // filter 'em out
  beerInfos = beerInfos.filter(x => !x.inError);

  // order by score, descending
  beerInfos.sort((a, b) => b.rating_score - a.rating_score);

  for (let beerInfo of beerInfos) {
    let ratingString = `${util.getRatingString(beerInfo.rating_score)} (${beerInfo.rating_count} ratings)`;
    if (beerInfo.price) {
      const ratingPerDollar = exponentialRating(beerInfo.rating_score) / (beerInfo.price / 4.0);
      ratingString = `${ratingString} — *${ratingPerDollar.toFixed(2)}* :fullbeer:/:dollar:`;
    }
    let attachment = {
      color: "#ffcc00",
      title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
      thumb_url: beerInfo.beer_label,
      text: `${ratingString}\n_${beerInfo.beer_style} — ${beerInfo.beer_abv}% ABV — ${beerInfo.beer_ibu || 0} IBU_`
    };
    if (beerInfos.length > 1) {
      attachment.text = `:mag: \`${beerInfo.query}\`\n${attachment.text}`;
    }
    if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
    else attachment.title = `${beerInfo.beer_name}`;
    if (beerInfo.beer_description) attachment.text += `\n${beerInfo.beer_description}`;

    slackMessage.attachments.push(attachment);
  }

  if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>: \`/untappd ${query}\``;

  return slackMessage;
}

function indexOfFirstOf(haystack, needles, startIndex) {
  let minIndex = Infinity;
  let foundNeedle = null;
  for (let needle of needles) {
    let index = haystack.indexOf(needle, startIndex);
    if (index != -1 && index < minIndex) {
      minIndex = index;
      foundNeedle = needle;
    }
  }
  return { symbol: foundNeedle, index: minIndex == Infinity ? -1 : minIndex };
}

const handler = async function(payload, res) {
  try {
    res.status(200).json(util.formatReceipt());

    // strip newlines and replace with spaces
    let text = payload.text.replace(/[\n\r]/g, " ");

    const splitText = [];
    let queryText;
    let queryStart = 0;
    let openBraceIndex;
    let closeBraceIndex = 0;
    let commaIndex;
    do {
      commaIndex = text.indexOf(",", queryStart);
      if (commaIndex == -1) commaIndex = text.length;
      openBraceIndex = text.indexOf("(", queryStart);
      if (openBraceIndex != -1 && openBraceIndex < commaIndex) {
        // potential beer group
        const brewery = text.substring(queryStart, openBraceIndex).trim();
        // match count of opening and closing braces
        let openCount = 1;
        let lastSymbolIndex = openBraceIndex;
        while (openCount > 0) {
          let result = indexOfFirstOf(text, ["(", ")"], lastSymbolIndex + 1);
          if (result.symbol == "(") openCount++;
          if (result.symbol == ")") openCount--;
          if (result.index != -1) lastSymbolIndex = result.index;
          else {
            // unbalanced parenthesis! abort and ganbatte kudasai
            console.log("unbalanced parenthesis!");
            lastSymbolIndex = text.indexOf(")", openBraceIndex + 1);
            break;
          }
        }
        closeBraceIndex = lastSymbolIndex;
        const beers = text
          .substring(openBraceIndex + 1, closeBraceIndex)
          .split(",")
          .map(x => x.trim());
        if (beers.length > 1) {
          // actual beer group
          for (var beer of beers) splitText.push(`${brewery} ${beer}`);
          commaIndex = text.indexOf(",", closeBraceIndex);
          if (commaIndex == -1) commaIndex = text.length;
        } else {
          // this is most likely just a year tag; treat it as not-a-group
          queryText = text.substring(queryStart, commaIndex).trim();
          if (queryText.length > 0) splitText.push(queryText);
        }
        queryStart = commaIndex + 1;
      } else {
        // this query does not have a beer group
        queryText = text.substring(queryStart, commaIndex).trim();
        if (queryText.length > 0) splitText.push(queryText);
        queryStart = commaIndex + 1;
      }
    } while (commaIndex < text.length);
    // we're done!

    // DEBUG
    //for (var query of splitText) console.log(query);

    const beerQueries = splitText.map(x => x.split("$")[0]);
    const beerPrices = splitText.map(x => x.split("$")[1]);

    const beerIdPromises = beerQueries.map(x => util.searchForBeerId(x.trim()));
    const beerIds = await Promise.all(
      beerIdPromises.map(p =>
        p.catch(err => {
          // ignore errors
          return { inError: true, query: err.exactQuery };
        })
      )
    );
    const beerInfos = await Promise.all(beerIds.map(x => (x.inError ? x : util.getBeerInfo(x.id, x.query)))).catch(util.onErrorRethrow);

    for (var i = 0; i < beerInfos.length; i++) beerInfos[i].price = Number.parseInt(beerPrices[i]);

    const message = formatBeerInfoSlackMessage(payload.user_id, text, beerInfos);
    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "untappd" };
