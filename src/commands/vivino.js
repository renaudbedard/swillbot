/* global require */
/* global console */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const axios = require("axios").default;

const maxRequests = 50;

function scrapeWineInfoPromise(query) {
  return new Promise((resolve, reject) => {
    scrapeWineInfo(query, resolve, reject);
  });
}

function scrapeWineInfo(query, resolve, reject) {
  const context = `Search for wine '${query}'`;
  axios
    .get("https://www.vivino.com/search/wines", {
      params: { q: query }
    })
    .then(function(response) {
      var data = response.data;
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }
      //console.log(data);

      const dom = new JSDOM(data);

      try {
        var cardDiv = dom.window.document.querySelector(".search-results-list > div:first-child");
        if (!cardDiv) throw new Error("Missing card div element in wine info page; this wine probably couldn't be matched.");
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
          country: country,
          emojiPrefix: null
        });
      } catch (err) {
        reject({
          source: context,
          message: `${err}`,
          exactQuery: query
        });
      }
    })
    .catch(function(err) {
      reject({
        source: context,
        message: `${err}`,
        exactQuery: query
      });
    });
}

function scrapeWineDetailsPromise(wineInfo) {
  return new Promise((resolve, reject) => {
    scrapeWineDetails(wineInfo, resolve, reject);
  });
}

function scrapeWineDetails(wineInfo, resolve, reject) {
  const context = `Fetching wine details for '${wineInfo.name}'`;
  axios
    .get(wineInfo.link)
    .then(function(response) {
      var data = response.data;
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }
      //console.log(data);

      try {
        // this is very unsafe but oh well
        const dom = new JSDOM(data, { runScripts: "dangerously" });
        //console.log(dom.window.__PRELOADED_STATE__.winePageInformation);

        var pageInfo = dom.window.__PRELOADED_STATE__.winePageInformation || dom.window.__PRELOADED_STATE__.vintagePageInformation;

        if (pageInfo && pageInfo.vintage && pageInfo.vintage.wine) {
          const wineMetadata = pageInfo.vintage.wine;

          if (wineMetadata.grapes) {
            wineInfo.grapes = wineMetadata.grapes.map(x => x.name).join(", ");
          }

          if (wineMetadata.type_id) {
            switch (wineMetadata.type_id) {
              case 1:
                wineInfo.type = "Red wine";
                break;
              case 2:
                wineInfo.type = "White wine";
                wineInfo.emojiPrefix = "white";
                break;
              case 3:
                wineInfo.type = "Sparkling wine";
                break;
              case 4:
                wineInfo.type = "Rosé wine";
                wineInfo.emojiPrefix = "rosé";
                break;
              case 24:
                wineInfo.type = "Fortified wine";
                break;
              case 7:
                wineInfo.type = "Dessert wine";
                break;
            }
          }

          if (wineInfo.rating_count == 0 && wineMetadata.statistics) {
            wineInfo.rating_score = wineMetadata.statistics.ratings_average;
            wineInfo.rating_count = wineMetadata.statistics.ratings_count;
            wineInfo.ratings_all_vintages = true;
          }
        }

        resolve(wineInfo);
      } catch (err) {
        reject({
          source: context,
          message: `${err}`,
          exactQuery: query
        });
      }
    })
    .catch(function(err) {
      reject({
        source: context,
        message: `${err}`,
        exactQuery: query
      });
    });
}

function groupBy(list, keyGetter) {
  const map = new Map();
  list.forEach(item => {
    const key = keyGetter(item);
    const collection = map.get(key);
    if (!collection) {
      map.set(key, [item]);
    } else {
      collection.push(item);
    }
  });
  return map;
}

/**
 * @param {string} source The user ID that made the request
 * @param {string} query The original request
 * @param {object[]} wineInfos Vivino's beer info
 * @return {string} The rich slack message
 */
function formatWineInfoSlackMessage(source, query, wineInfos, nextQueries) {
  // See https://api.slack.com/docs/message-formatting
  let slackMessage = {
    response_type: "in_channel",
    attachments: []
  };

  if (nextQueries.length > 0) {
    slackMessage.attachments.push({
      color: "#ff00ff",
      text: `More than ${maxRequests} wines provided, continue with query : \n\`\`\`/v ${nextQueries.join(", ")}\`\`\``
    });
  }

  // add in-error attachments first
  const wineInfosPerError = groupBy(wineInfos.filter(x => x.inError), x => x.errorMessage);
  for (const [errorMessage, infos] of wineInfosPerError.entries()) {
    let attachment = {
      color: "#ff0000",
      text: `*Couldn't find matching wine for :* \`${infos.map(x => x.query).join(", ")}\`\n\`\`\`${errorMessage}\`\`\``
    };
    slackMessage.attachments.push(attachment);
  }

  // filter 'em out
  wineInfos = wineInfos.filter(x => !x.inError);

  // order by score, descending
  wineInfos.sort((a, b) => b.rating_score - a.rating_score);

  for (let wineInfo of wineInfos) {
    const ratingSuffix = wineInfo.ratings_all_vintages ? " [all vintages]" : "";
    let ratingString = `${util.getRatingString(wineInfo.rating_score, true, wineInfo.emojiPrefix)} (${wineInfo.rating_count} ratings)${ratingSuffix}`;
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

  var shortQuery = query;
  if (query.length > 1900) shortQuery = query.substring(0, 1900) + " [...]";

  if (slackMessage.attachments.length > 0) {
    if (shortQuery.includes(",")) slackMessage.attachments[0].pretext = `<@${source}>:\n\`\`\`/vivino ${shortQuery}\`\`\``;
    else slackMessage.attachments[0].pretext = `<@${source}>: \`/vivino ${shortQuery}\``;
  }

  return slackMessage;
}

const handler = async function(payload, res) {
  try {
    res.status(200).json(util.formatReceipt());

    // strip newlines and replace with spaces
    let text = payload.text.replace(/[\n\r]/g, " ");
    let wineQueries = util.getQueries(text);
    let nextQueries = [];
    if (wineQueries.length > maxRequests) {
      const cappedQueries = wineQueries.slice(0, maxRequests);
      nextQueries = wineQueries.slice(maxRequests, wineQueries.length - maxRequests);
      wineQueries = cappedQueries;
    }
    const wineInfoPromises = wineQueries.map(x => scrapeWineInfoPromise(x.trim()));

    const wineInfos = await Promise.all(
      wineInfoPromises.map(p =>
        p.catch(err => {
          // ignore errors
          return { inError: true, query: err.exactQuery, errorMessage: err.message };
        })
      )
    );

    if (wineInfos.some(x => x.inError && x.errorMessage && x.errorMessage.includes("status code 429"))) {
      util.sendDelayedResponse(
        util.formatError({ source: "Fetching wine infos from Vivino", message: "Too many requests, try again later" }),
        payload.response_url
      );
      return;
    }

    const wineDetails = await Promise.all(wineInfos.map(x => (x.inError ? x : scrapeWineDetailsPromise(x)))).catch(util.onErrorRethrow);

    const message = formatWineInfoSlackMessage(payload.user_id, text, wineDetails, nextQueries);

    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "vivino" };
