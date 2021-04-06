/* global require */
/* global console */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");
const restClient = require("../rest-client");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

function scrapeWineInfo(query, cepage, natureOnly, webOnly) {
  const context = `Search for wine '${query}'`;
  return new Promise((resolve, reject) => {
    let args = {
      parameters: {
        q: query
      }
    };

    if (webOnly) args.parameters.availability = "Online";
    if (natureOnly) args.parameters.particularite = "Vin nature";
    if (cepage) args.parameters.cepage = cepage;

    let req = restClient.get("https://www.saq.com/fr/catalogsearch/result/index/", args, function(data, _) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }

      const dom = new JSDOM(data);

      try {
        // single-result case
        var singleResult = dom.window.document.querySelector(".detailed");
        if (singleResult) {
          var mainContent = dom.window.document.querySelector("#maincontent");
          var wineName = mainContent.querySelector(".page-title").textContent.trim();
          var wineId = mainContent.querySelector('ul.list-attributs strong[data-th="Code SAQ"]').textContent.trim();
          var winePageLink = `https://www.saq.com/fr/${wineId}`;
          var imageElem = mainContent.querySelector('#mtImageContainer img[itemprop="image"]');
          var imageLink = null;
          if (imageElem) imageLink = imageElem.getAttribute("src");
          var price = mainContent.querySelector(".price").textContent.replace("&nbsp;", "");
          var type = mainContent.querySelector(".identity .type").textContent.trim();
          var format = mainContent
            .querySelector(".format .type")
            .textContent.trim()
            .replace(/\s{2,}/, " ");
          var country = mainContent.querySelector(".country .type").textContent.trim();
          var inStockOnline = !mainContent.querySelector(".out-of-stock-online");
          var inStockShelf = mainContent.querySelector(".available-in-store");

          resolve({
            query: query,
            name: wineName,
            link: winePageLink,
            label_url: imageLink,
            country: country,
            type: type,
            format: format,
            price: price,
            inStockOnline: inStockOnline,
            inStockShelf: inStockShelf
          });
          return;
        }

        // Multi-result case
        for (let cardDiv of dom.window.document.querySelectorAll(".product-items > li")) {
          var wineName = cardDiv
            .querySelector(".product-item-link")
            .textContent.trim()
            .replace(/\s{2,}/, " ");
          var winePageLink = cardDiv.querySelector(".product-item-link").getAttribute("href");
          var imageLink = cardDiv.querySelector(".product-image-photo").getAttribute("src");
          var price = cardDiv.querySelector(".price").textContent.replace("&nbsp;", "");
          var identity = cardDiv.querySelector(".product-item-identity-format span").textContent.split("|");
          var type = identity[0].trim();
          var formatFragments = identity[1]
            .trim()
            .split(" ")
            .filter(function(el) {
              return el.length != 0;
            });
          var format = `${formatFragments[0].trim()} ${formatFragments[1].trim()}`;
          var country = identity[2].trim();
          var inStockOnline = cardDiv.querySelector(".availability-container span:first-child.in-stock");
          var inStockShelf = cardDiv.querySelector(".availability-container span:last-child.in-stock");

          resolve({
            query: query,
            name: wineName,
            link: winePageLink,
            label_url: imageLink,
            country: country,
            type: type,
            format: format,
            price: price,
            inStock: inStock
          });
          return;
        }

        reject({
          source: context,
          message: "Aucun résultat en stock!",
          exactQuery: query
        });
      } catch (err) {
        reject({
          source: context,
          message: err.stack,
          exactQuery: query
        });
        return;
      }
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString(), exactQuery: query });
    });
  });
}

/*
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

      // TODO: do we need to run scripts at all?
      //const dom = new JSDOM(data, { runScripts: "dangerously" });
      const dom = new JSDOM(data);
      //console.log(dom.window.__PRELOADED_STATE__.winePageInformation);

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
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString() });
    });
  });
}
*/
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
        text: `*Erreur de la requête :* \`${wineInfo.query}\`\n${wineInfo.message}`
      };
      slackMessage.attachments.push(attachment);
    }
  }

  // filter 'em out
  wineInfos = wineInfos.filter(x => !x.inError);

  // order by score, descending
  wineInfos.sort((a, b) => b.rating_score - a.rating_score);

  for (let wineInfo of wineInfos) {
    let ratingString = ""; // `${util.getRatingString(wineInfo.rating_score, true, wineInfo.emojiPrefix)} (${wineInfo.rating_count} ratings)`;
    let typeString = "";
    if (wineInfo.type) {
      typeString = `${wineInfo.type} — `;
    }
    let attachment = {
      color: "#ffcc00",
      title_link: `${wineInfo.link}`,
      thumb_url: wineInfo.label_url,
      text: `${ratingString}\n_${typeString}${wineInfo.country}_\n:dollar: ${wineInfo.price} (${wineInfo.format})\nEn ligne : ${
        wineInfo.inStockOnline ? ":white_check_mark:" : ":x:"
      } — Tablettes : ${wineInfo.inStockShelf ? ":white_check_mark:" : ":x:"}`
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

  if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>: \`/saq ${query}\``;

  return slackMessage;
}

const handler = async function(payload, res) {
  try {
    res.status(200).json(util.formatReceipt());

    // strip newlines and replace with spaces
    let text = payload.text.replace(/[\n\r]/g, " ");
    const wineQueries = util.getQueries(text);
    const wineInfoPromises = wineQueries.map(x => scrapeWineInfo(x.trim()));

    const wineInfos = await Promise.all(
      wineInfoPromises.map(p =>
        p.catch(err => {
          // ignore errors
          return { inError: true, query: err.exactQuery, message: err.message };
        })
      )
    );

    //const wineDetails = await Promise.all(wineInfos.map(x => (x.inError ? x : scrapeWineDetails(x)))).catch(util.onErrorRethrow);

    const message = formatWineInfoSlackMessage(payload.user_id, text, wineInfos);

    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "saq" };
