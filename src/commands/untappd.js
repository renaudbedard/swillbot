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
        text: `*Couldn't find matching beer for :* \`${beerInfo.query}\` (_${beerInfo.message}_)`
      };
      slackMessage.attachments.push(attachment);
    }
  }

  // filter 'em out
  beerInfos = beerInfos.filter(x => !x.inError);

  // order by score, descending
  beerInfos.sort((a, b) => b.rating_score - a.rating_score);

  for (let beerInfo of beerInfos) {
    let ratingString = `${util.getRatingString(beerInfo.rating_score)} (*${beerInfo.weighted_rating_score.toFixed(2)}* weighted) (${
      beerInfo.rating_count
    } ratings)`;
    if (beerInfo.price) {
      const ratingPerDollar = exponentialRating(beerInfo.rating_score) / (beerInfo.price / 4.0);
      ratingString = `${ratingString} — *${ratingPerDollar.toFixed(2)}* :fullbeer:/:dollar:`;
    }
    let ibuFragment = beerInfo.beer_ibu ? ` — ${beerInfo.beer_ibu} IBU` : "";
    let attachment = {
      color: "#ffcc00",
      title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
      thumb_url: beerInfo.beer_label,
      text: `${ratingString}\n_${beerInfo.beer_style} — ${beerInfo.beer_abv}% ABV${ibuFragment}_`
    };
    if (beerInfos.length > 1) {
      attachment.text = `:mag: \`${beerInfo.query}\`\n${attachment.text}`;
    }
    if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
    else attachment.title = `${beerInfo.beer_name}`;
    if (beerInfo.beer_description) attachment.text += `\n${beerInfo.beer_description}`;

    slackMessage.attachments.push(attachment);
  }

  if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>: \`\`\`/u ${query}\`\`\``;

  return slackMessage;
}

const handler = async function(payload, res) {
  try {
    // for the lulz
    if (payload.text.includes("kill VIP")) {
      res.status(200).json({
        response_type: "in_channel",
        attachments: [
          {
            title: "KILL MODE ACTIVATED",
            text: ":robot_face: :knife: :wine_glass::100:"
          }
        ]
      });
      return;
    }

    res.status(200).json(util.formatReceipt());

    // strip newlines and replace with spaces
    let text = payload.text.replace(/[\n\r]/g, " ");
    const splitText = util.getQueries(text);

    // DEBUG
    //for (var query of splitText) console.log(query);

    const beerQueries = splitText.map(x => x.split("$")[0]);
    const beerPrices = splitText.map(x => x.split("$")[1]);

    const beerIdPromises = beerQueries.map(x => util.searchForBeerId(x.trim()));
    const beerIds = await Promise.all(
      beerIdPromises.map(p =>
        p.catch(err => {
          // ignore errors
          return { inError: true, query: err.exactQuery, message: err.message };
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
