/* global require */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");

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
      ratingString = `${ratingString} — ${(beerInfo.rating_score / beerInfo.price).toFixed(2)} :fullbeer:/:dollar:`;
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

const handler = async function(payload, res) {
  try {
    res.status(200).json(util.formatReceipt());

    // strip newlines and replace with spaces
    payload.text = payload.text.replace(/[\n\r]/g, " ");

    const splitText = payload.text.split(",");

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

    const message = formatBeerInfoSlackMessage(payload.user_id, payload.text, beerInfos);
    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "untappd" };
