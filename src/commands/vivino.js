/* global require */
/* global console */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const axios = require("axios").default;
const http = require("http");
const https = require("https");
const moment = require("moment");

const agent = new http.Agent({ keepAlive: true });
const secureAgent = new https.Agent({ keepAlive: true });
const waitFor = 10;
const requestsPerBatch = 50;
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:53.0) Gecko/20100101 Firefox/53.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.79 Safari/537.36 Edge/14.14393",
  "Mozilla/5.0 (iPad; CPU OS 8_4_1 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Version/8.0 Mobile/12H321 Safari/600.1.4",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E304 Safari/602.1"
];

var requestsLeft = requestsPerBatch;
var refillPending = false;
var totalResults = 0;
var resultsToGet = 0;
var batchIndex = 0;

var sleepEnd = moment();

function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function handleHttpError(err, context, query, reject, retry) {
  if (err.response && err.response.status == 429) {
    console.log(`Sleeping ${waitFor} seconds after a 429 on ${query}`);
    sleepEnd = moment().add(waitFor, "seconds");
    sleep(waitFor * 1000).then(retry);
    return;
  }
  reject({
    source: context,
    message: err,
    exactQuery: query
  });
}

function scrapeWineInfoPromise(query) {
  return new Promise((resolve, reject) => {
    scrapeWineInfo(query, resolve, reject);
  });
}

function scrapeWineInfo(query, resolve, reject) {
  const retry = () => {
    scrapeWineInfo(query, resolve, reject);
  };

  var fillRequests = false;
  if (requestsLeft <= 0) {
    if (!refillPending) console.log(`Requests depleted, waiting ${waitFor} seconds...`);
    sleepEnd = moment().add(waitFor, "seconds");
    if (!refillPending) fillRequests = true;
    refillPending = true;
  }

  const msToWait = sleepEnd.diff(moment(), "milliseconds");
  if (msToWait > 0) {
    sleep(msToWait).then(() => {
      if (fillRequests) {
        console.log("Refilled request pool.");
        requestsLeft = requestsPerBatch;
        fillRequests = false;
        refillPending = false;
        batchIndex++;
      }
      retry();
    });
    return;
  }

  requestsLeft--;

  console.log(`Sending info for ${query}... (${requestsLeft} requests left in pool)`);

  const context = `Search for wine '${query}'`;
  axios
    .get("https://www.vivino.com/search/wines", {
      params: { q: query },
      headers: { "user-agent": userAgents[Math.min(batchIndex, userAgents.length - 1)] },
      httpAgent: agent,
      httpsAgent: secureAgent
    })
    .then(function(response) {
      var data = response.data;
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }
      //console.log(data);
      totalResults++;
      console.log(`${totalResults}/${resultsToGet}`);

      if (requestsLeft == 0) {
        sleepEnd = moment().add(waitFor, "seconds");
      }

      const dom = new JSDOM(data);

      try {
        var cardDiv = dom.window.document.querySelector(".search-results-list > div:first-child");
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
      handleHttpError(err, context, query, reject, retry);
    });
}

function scrapeWineDetailsPromise(wineInfo) {
  return new Promise((resolve, reject) => {
    scrapeWineDetails(wineInfo, resolve, reject);
  });
}

function scrapeWineDetails(wineInfo, resolve, reject) {
  const retry = () => {
    console.log(`Retrying info for ${query}...`);
    scrapeWineDetails(wineInfo, resolve, reject);
  };

  if (sleepEnd) {
    const msToWait = sleepEnd.diff(moment(), "milliseconds");
    if (msToWait > 0) {
      console.log(`Sleeping ${msToWait / 1000} second on details for ${query} (we are otherwise sleeping)`);
      sleep(msToWait).then(retry);
      return;
    }
  }

  const context = `Fetching wine details for '${wineInfo.name}'`;
  axios
    .get(wineInfo.link, {
      httpAgent: agent,
      httpsAgent: secureAgent
    })
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
      handleHttpError(err, context, query, reject, retry);
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
        text: `*Couldn't find matching wine for :* \`${wineInfo.query}\`\n\`\`\`(${wineInfo.errorMessage})\`\`\``
      };
      slackMessage.attachments.push(attachment);
    }
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

  if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>:\n\`\`\`/vivino ${shortQuery}\`\`\``;

  return slackMessage;
}

const handler = async function(payload, res) {
  try {
    res.status(200).json(util.formatReceipt());

    totalResults = 0;
    batchIndex = 0;
    requestsLeft = requestsPerBatch;

    // strip newlines and replace with spaces
    let text = payload.text.replace(/[\n\r]/g, " ");
    const wineQueries = util.getQueries(text);
    resultsToGet = wineQueries.length;
    const wineInfoPromises = wineQueries.map(x => scrapeWineInfoPromise(x.trim()));

    const wineInfos = await Promise.all(
      wineInfoPromises.map(p =>
        p.catch(err => {
          // ignore errors
          return { inError: true, query: err.exactQuery, errorMessage: err.message };
        })
      )
    );

    const wineDetails = await Promise.all(wineInfos.map(x => (x.inError ? x : scrapeWineDetailsPromise(x)))).catch(util.onErrorRethrow);

    const message = formatWineInfoSlackMessage(payload.user_id, text, wineDetails);

    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "vivino" };
