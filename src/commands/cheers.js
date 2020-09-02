/* global require */
/* global console */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");
const restClient = require("../rest-client");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

function scrapeCheers() {
  const context = `Get latest Cheers beers`;
  return new Promise((resolve, reject) => {
    let args = { };

    let req = restClient.get("https://boutiquecheers.com/products/new", args, async function(data, _) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }

      const dom = new JSDOM(data, { runScripts: "dangerously", resources: "usable" });

      await new Promise(r => setTimeout(r, 4000))

      console.log(dom.serialize());

      var gridDiv = dom.window.document.querySelector("#root > div > div > div > div > div > div > div");

      if (!gridDiv) {
        reject({
          source: context,
          message: "Couldn't scape!"
        });
        return;
      }

      let beerInfos = []

      resolve(beerInfos);
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString() });
    });
  });
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
      let ratingString = `${util.getRatingString(beerInfo.rating_score)} (*${beerInfo.weighted_rating_score.toFixed(2)}* weighted) (${beerInfo.rating_count} ratings)`;
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

const handler = async function(payload, res) {
  try {
    res.status(200).json(util.formatReceipt());

    let text = payload.text.replace(/[\n\r]/g, " ");

    let beerInfos = await scrapeCheers();

    const message = formatBeerInfoSlackMessage(payload.user_id, text, beerInfos);

    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "cheers" };
