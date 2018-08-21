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

  for (let beerInfo of beerInfos) {
    let ratingString = util.getRatingString(beerInfo.rating_score);

    let attachment = {
      color: "#ffcc00",
      title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
      thumb_url: beerInfo.beer_label,
      text: `${ratingString} (${beerInfo.rating_count} ratings)\n_${beerInfo.beer_style} — ${beerInfo.beer_abv}% ABV — ${beerInfo.beer_ibu || 0} IBU_`
    };
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

    const beerIds = await Promise.all(payload.text.split(",").map(x => util.searchForBeerId(x.trim()))).catch(util.onErrorRethrow);
    const beerInfos = await Promise.all(beerIds.map(x => util.getBeerInfo(x))).catch(util.onErrorRethrow);

    const message = formatBeerInfoSlackMessage(payload.user_id, payload.text, beerInfos);
    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "untappd" };
