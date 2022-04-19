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
    .get("http://www.cellartracker.com/list.asp?O=Quantity+DESC&Table=List", {
      params: { szSearch: query }
    })
    .then(function(response) {
      var data = response.data;
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }
      //console.log(data);

      const dom = new JSDOM(data);

      try {
        var mainTable = dom.window.document.querySelector("#main_table");
        if (!mainTable) throw new Error("Missing main table element; this wine probably couldn't be matched.");
        var moreA = mainTable.querySelector(".more");
        var winePageLink = `http://www.cellartracker.com/${moreA.getAttribute("href")}`;
        var nameHeader = mainTable.querySelector(".nam h3");
        var wineName = nameHeader.innerHTML;

        resolve({
          query: query,
          name: wineName,
          link: winePageLink
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
        //const dom = new JSDOM(data, { runScripts: "dangerously" });
        const dom = new JSDOM(data);

        wineInfo.type = ``;

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
 * @param {object[]} wineInfos Wine infos
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
    if (shortQuery.includes(",")) slackMessage.attachments[0].pretext = `<@${source}>:\n\`\`\`/cellartracker ${shortQuery}\`\`\``;
    else slackMessage.attachments[0].pretext = `<@${source}>: \`/cellartracker ${shortQuery}\``;
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
        util.formatError({ source: "Fetching wine infos from CellarTracker", message: "Too many requests, try again later" }),
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

module.exports = { handler: handler, name: "cellartracker" };
