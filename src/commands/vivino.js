/* global require */
/* global console */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");
const restClient = require("../rest-client");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

function scrapeWineInfo(query) {
  const context = `Search for wine '${query}'`;
  return new Promise((resolve, reject) => {
    let args = {
      parameters: {
        q: query
      }
    };

    let req = restClient.get("https://www.vivino.com/search/wines", args, function(data, _) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }
      //console.log(data);

      const dom = new JSDOM(data);

      var cardDiv = dom.window.document.querySelector(".search-results-list > div:first-child");

      if (!cardDiv) {
        reject({
          source: context,
          message: "Couldn't find matching wine!"
        });
        return;
      }

      var winePageLink = `http://vivino.com${cardDiv.querySelector("a").getAttribute("href")}`;
      var imageLink = cardDiv
        .querySelector("figure.wine-card__image")
        .getAttribute("style")
        .match(/url\(\/\/(.+)\)/)[1];
      imageLink = `http://${imageLink}`;
      var wineName = cardDiv.querySelector(".wine-card__name span").textContent.trim();
      var region = cardDiv.querySelector(".wine-card__region a").textContent;
      var country = cardDiv.querySelector('.wine-card__region a[data-item-type="country"]').textContent;
      var averageRating = parseFloat(cardDiv.querySelector(".average__number").textContent.replace(",", "."));
      var ratingCountElement = cardDiv.querySelector(".average__stars .text-micro");
      var ratingCount = ratingCountElement ? parseInt(ratingCountElement.textContent.split(" ")[0]) : 0;

      resolve({
        query: query,
        name: wineName,
        link: winePageLink,
        rating_score: averageRating,
        rating_count: ratingCount,
        label_url: imageLink,
        region: region,
        country: country
      });
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString() });
    });
  });
}

function scrapeWineDetails(wineInfo) {
  const context = `Fetching wine details for '${wineInfo.name}'`;
  return new Promise((resolve, reject) => {
    let args = {
      parameters: {}
    };

    let req = restClient.get(wineInfo.link, args, function(data, _) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }

      // this is very unsafe but oh well
      const dom = new JSDOM(data, { runScripts: "dangerously" });
      console.log(dom.window.__PRELOADED_STATE__.winePageInformation);

      /*
      var grapesElement = dom.window.document.querySelector(".wineFacts__container--eIljB a");
      if (grapesElement) {
        wineInfo.grapes = grapesElement.textContent;
      }

      var wineTypeElement = dom.window.document.querySelector("span.wineLocationHeader__wineType--14nrC");
      if (wineTypeElement) {
        wineInfo.type = wineTypeElement.childNodes[0].textContent;
      }
      */

      resolve(wineInfo);
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString() });
    });
  });
}

/**
 * @param {string} source The user ID that made the request
 * @param {string} query The original request
 * @param {object[]} wineInfos Vivino's beer info
 * @return {string} The rich slack message
 */
function formatWineInfoSlackMessage(source, query, wineInfos) {
  // See https://api.slack.com/docs/message-formatting
  let slackMessage = {
    response_type: "in_channel",
    attachments: []
  };

  // add in-error attachments first
  for (let wineInfo of wineInfos) {
    if (wineInfo.inError) {
      let attachment = {
        color: "#ff0000",
        text: `*Couldn't find matching wine for :* \`${wineInfo.query}\``
      };
      slackMessage.attachments.push(attachment);
    }
  }

  // filter 'em out
  wineInfos = wineInfos.filter(x => !x.inError);

  // order by score, descending
  wineInfos.sort((a, b) => b.rating_score - a.rating_score);

  for (let wineInfo of wineInfos) {
    let ratingString = `${util.getRatingString(wineInfo.rating_score, true)} (${wineInfo.rating_count} ratings)`;
    let typeString = "";
    if (wineInfo.type) {
      typeString = `${wineInfo.type} from `;
    }
    let attachment = {
      color: "#ffcc00",
      title_link: `${wineInfo.link}`,
      thumb_url: wineInfo.label_url,
      text: `${ratingString}\n_${typeString}${wineInfo.region} — ${wineInfo.country}_`
    };
    if (wineInfos.length > 1) {
      attachment.text = `:mag: \`${wineInfo.query}\`\n${attachment.text}`;
    }
    if (wineInfo.grapes) {
      attachment.text = `${attachment.text}\n:grapes: ${wineInfo.grapes}`;
    }
    attachment.title = `${wineInfo.name}`;

    slackMessage.attachments.push(attachment);
  }

  if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>: \`/vivino ${query}\``;

  return slackMessage;
}

const handler = async function(payload, res) {
  try {
    res.status(200).json(util.formatReceipt());

    // strip newlines and replace with spaces
    let text = payload.text.replace(/[\n\r]/g, " ");
    const wineQueries = util.getQueries(text);

    let wineInfos = await Promise.all(wineQueries.map(x => scrapeWineInfo(x.trim())));
    wineInfos = await Promise.all(wineInfos.map(x => scrapeWineDetails(x)));

    const message = formatWineInfoSlackMessage(payload.user_id, text, wineInfos);

    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "vivino" };
