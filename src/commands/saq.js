/* global require */
/* global console */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");
const restClient = require("../rest-client");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const nodeUtil = require("util");

const httpHeaders = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.85 Safari/537.36",
  "accept-encoding": "gzip, deflate, br",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9"
};

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function scrapeWineInfo(
  query,
  multiResult,
  natureOnly,
  webOnly,
  nouveautés,
  minPrice,
  maxPrice,
  loterie,
  soon,
  cépages,
  aoc,
  vin,
  rouge,
  blanc,
  rosé,
  orange
) {
  const context = `Search for wine '${query}'`;
  return new Promise((resolve, reject) => {
    let args = {
      parameters: {},
      headers: httpHeaders
    };

    if (query) args.parameters.q = query;
    if (webOnly) args.parameters.availability = "Online";
    if (natureOnly) args.parameters.particularite = ["Vin nature", "Produit bio"];
    if (minPrice || maxPrice) {
      if (!minPrice) minPrice = 0;
      if (!maxPrice) maxPrice = 9999;
      args.parameters.price = `${minPrice}-${maxPrice}`;
    }
    if (loterie) args.parameters.availability = `In a lottery${soon ? " shortly" : ""}`;
    else if (soon) args.parameters.availability = "Coming soon";
    if (cépages.length > 0)
      args.parameters.cepage = cépages.map(x => {
        return capitalizeFirstLetter(x);
      });
    if (aoc.length > 0) args.parameters.appellation = aoc.map(x => capitalizeFirstLetter(x));
    if (vin) args.parameters.cat = 44;
    if (blanc) args.parameters.cat = 212;
    else if (rouge) args.parameters.cat = 215;
    else if (rosé) args.parameters.cat = 218;
    else if (orange) args.parameters.particularite = ["Vin orange"];

    args.parameters.product_list_limit = 96;

    let url = "https://www.saq.com/fr/catalogsearch/result/index/";
    if (nouveautés) url = "https://www.saq.com/fr/nouveautes";
    else if (!query || query.length == 0) url = "https://www.saq.com/fr/produits";

    console.log(`url : ${url}`);
    console.log(JSON.stringify(args.parameters));

    let req = restClient.get(url, args, function(data, response) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }

      //console.log(`raw response : \n${nodeUtil.inspect(response)}`);

      const dom = new JSDOM(data);

      try {
        // single-result case
        var singleResult = dom.window.document.querySelector(".detailed");
        if (singleResult) {
          var mainContent = dom.window.document.querySelector("#maincontent");
          var wineName = mainContent
            .querySelector(".page-title")
            .textContent.trim()
            .replace(/\s{2,}/g, " ");
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
            .replace(/\s{2,}/g, " ");
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
        let results = [];
        for (let cardDiv of dom.window.document.querySelectorAll("#maincontent .product-items > li")) {
          var wineName = cardDiv
            .querySelector(".product-item-link")
            .textContent.trim()
            .replace(/\s{2,}/g, " ");
          var winePageLink = cardDiv.querySelector(".product-item-link").getAttribute("href");
          var imageLink = cardDiv.querySelector(".product-image-photo").getAttribute("src");
          var priceElem = cardDiv.querySelector(".price");
          if (!priceElem) continue;
          var price = priceElem.textContent.replace("&nbsp;", "");
          var identity = cardDiv.querySelector(".product-item-identity-format span").textContent.split("|");
          var type = identity[0].trim();
          var formatFragments = identity[1]
            .trim()
            .split(" ")
            .filter(function(el) {
              return el.length != 0;
            });
          var format = `${formatFragments[0].trim()} ${formatFragments[1].trim()}`;
          var country = identity[2] ? identity[2].trim() : "Inconnu";
          var inStockOnline = cardDiv.querySelector(".availability-container span:first-child.in-stock");
          var inStockShelf = cardDiv.querySelector(".availability-container span:last-child.in-stock");

          let result = {
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
          };
          if (multiResult) {
            if (inStockOnline || inStockShelf || soon || loterie) results.push(result);
          } else {
            resolve(result);
            return;
          }
        }

        if (multiResult && results.length > 0) {
          resolve(results);
          return;
        }

        reject({
          source: context,
          message: "Aucun résultat!",
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
      reject({ source: context, message: err.stack, exactQuery: query });
    });
  });
}

function scrapeWineDetails(wineInfo) {
  const context = `Fetching wine details for '${wineInfo.name}'`;
  return new Promise((resolve, reject) => {
    let args = {
      parameters: {},
      headers: httpHeaders
    };

    let req = restClient.get(wineInfo.link, args, function(data, _) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }

      const dom = new JSDOM(data);
      var singleResult = dom.window.document.querySelector(".detailed");
      if (singleResult) {
        var mainContent = dom.window.document.querySelector("#maincontent");
        var regionElem = mainContent.querySelector('ul.list-attributs strong[data-th="Région"]');
        var appelationElem = mainContent.querySelector('ul.list-attributs strong[data-th="Appellation d\'origine"]');
        var cepageElem = mainContent.querySelector('ul.list-attributs strong[data-th="Cépage"]');
        var alcoolElem = mainContent.querySelector('ul.list-attributs strong[data-th="Degré d\'alcool"]');
        var sucreElem = mainContent.querySelector('ul.list-attributs strong[data-th="Taux de sucre"]');
        var producteurElem = mainContent.querySelector('ul.list-attributs strong[data-th="Producteur"]');
        var agentElem = mainContent.querySelector('ul.list-attributs strong[data-th="Agent promotionnel"]');
        var descElem = mainContent.querySelector(".wrapper-description .wrapper-content-info p:first-child");

        if (regionElem) wineInfo.region = regionElem.textContent.trim();
        if (appelationElem) wineInfo.appelation = appelationElem.textContent.trim();
        if (cepageElem) wineInfo.grapes = cepageElem.textContent.trim();
        if (alcoolElem) wineInfo.alcool = alcoolElem.textContent.trim();
        if (sucreElem) wineInfo.sucre = sucreElem.textContent.trim();
        if (producteurElem) wineInfo.producteur = producteurElem.textContent.trim();
        if (agentElem) wineInfo.agent = agentElem.textContent.trim();
        if (descElem) wineInfo.description = descElem.textContent.trim();
      }

      switch (wineInfo.type) {
        case "Vin blanc":
          wineInfo.emojiPrefix = "white";
          break;
        case "Vin rosé":
          wineInfo.emojiPrefix = "rosé";
          break;
      }

      resolve(wineInfo);
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString() });
    });
  });
}

function scrapeWineScore(wineInfo) {
  const context = `Search for wine '${wineInfo.name}'`;
  return new Promise((resolve, reject) => {
    if (!wineInfo.type.toLowerCase().startsWith("vin")) {
      resolve(wineInfo);
      return;
    }

    let args = {
      parameters: {
        q: wineInfo.name
      }
    };

    let req = restClient.get("https://www.vivino.com/search/wines", args, function(data, _) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }
      //console.log(data);

      const dom = new JSDOM(data);

      try {
        var cardDiv = dom.window.document.querySelector(".search-results-list > div:first-child");
        var winePageLink = `http://vivino.com${cardDiv.querySelector("a").getAttribute("href")}`;
        var averageRating = parseFloat(cardDiv.querySelector(".average__number").textContent.replace(",", "."));
        var ratingCountElement = cardDiv.querySelector(".average__stars .text-micro");
        var ratingCount = ratingCountElement ? parseInt(ratingCountElement.textContent.split(" ")[0]) : 0;

        wineInfo.rating_score = averageRating;
        wineInfo.rating_count = ratingCount;
        wineInfo.vivino_link = winePageLink;

        if (!wineInfo.rating_score) {
          args = {
            parameters: {}
          };

          req = restClient.get(wineInfo.vivino_link, args, function(data, _) {
            if (Buffer.isBuffer(data)) {
              data = data.toString("utf8");
            }

            // this is very unsafe but oh well
            const dom = new JSDOM(data, { runScripts: "dangerously" });
            //console.log(dom.window.__PRELOADED_STATE__.winePageInformation);

            var pageInfo = dom.window.__PRELOADED_STATE__.winePageInformation || dom.window.__PRELOADED_STATE__.vintagePageInformation;

            if (pageInfo && pageInfo.vintage && pageInfo.vintage.wine) {
              const wineMetadata = pageInfo.vintage.wine;

              if (wineMetadata.statistics) {
                wineInfo.rating_score = wineMetadata.statistics.ratings_average;
                wineInfo.rating_count = wineMetadata.statistics.ratings_count;
                wineInfo.ratings_all_vintages = true;
              }
            }

            resolve(wineInfo);
          });
          req.on("error", function(err) {
            reject({ source: context, message: err.toString(), exactQuery: query });
          });
        } else {
          resolve(wineInfo);
          return;
        }
      } catch (err) {
        resolve(wineInfo);
        return;
      }
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString(), exactQuery: query });
    });
  });
}

function formatWineInfoSlackMessage(
  source,
  query,
  wineInfos,
  multiResult,
  nature,
  web,
  nouveautés,
  minPrice,
  maxPrice,
  loterie,
  soon,
  cépages,
  aoc,
  vin,
  rouge,
  blanc,
  rosé,
  orange
) {
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
    const ratingSuffix = wineInfo.ratings_all_vintages ? " [all vintages]" : "";
    let ratingString = "";
    if (wineInfo.rating_score) {
      ratingString = `${util.getRatingString(wineInfo.rating_score, true, wineInfo.emojiPrefix)} <${wineInfo.vivino_link}|(${
        wineInfo.rating_count
      } ratings)${ratingSuffix}>\n`;
    }
    let typeString = "";
    if (wineInfo.type) {
      typeString = `${wineInfo.type} — ${wineInfo.country}`;
    }
    if (wineInfo.region) {
      typeString = `${typeString}, ${wineInfo.region}`;
    }
    if (wineInfo.appelation) {
      typeString = `${typeString} (${wineInfo.appelation})`;
    }
    let attachment = {
      color: "#ffcc00",
      title_link: `${wineInfo.link}`,
      thumb_url: wineInfo.label_url,
      text: `${ratingString}_${typeString}_`
    };
    if (wineInfo.grapes) {
      attachment.text = `${attachment.text}\n:grapes: ${wineInfo.grapes}`;
    }
    attachment.text = `${attachment.text}\n:dollar: ${wineInfo.price} (${wineInfo.format})`;
    if (soon && loterie) attachment.text = `${attachment.text}\n:crossed_fingers::clock2: En loterie bientôt`;
    else if (soon) attachment.text = `${attachment.text}\n:clock2: Disponible bientôt`;
    else if (loterie) attachment.text = `${attachment.text}\n:crossed_fingers: En loterie`;
    else
      attachment.text = `${attachment.text}\nEn ligne : ${wineInfo.inStockOnline ? ":white_check_mark:" : ":x:"} — Tablettes : ${
        wineInfo.inStockShelf ? ":white_check_mark:" : ":x:"
      }`;
    if (wineInfos.length > 1 && !multiResult) {
      attachment.text = `:mag: \`${wineInfo.query}\`\n${attachment.text}`;
    }
    if (wineInfo.alcool) {
      attachment.text = `${attachment.text}\nAlcool : ${wineInfo.alcool}`;
    }
    if (wineInfo.sucre) {
      attachment.text = `${attachment.text} — Sucre : ${wineInfo.sucre}`;
    }
    if (wineInfo.producteur) {
      attachment.text = `${attachment.text}\nProducteur : ${wineInfo.producteur}`;
    }
    if (wineInfo.agent) {
      attachment.text = `${attachment.text}\nAgent : ${wineInfo.agent}`;
    }
    attachment.title = `${wineInfo.name}`;

    if (wineInfo.description)
      attachment.fields = [
        {
          title: "Infos détaillées",
          value: wineInfo.description,
          short: false
        }
      ];

    slackMessage.attachments.push(attachment);
  }

  if (multiResult) query = `~${query}`;
  if (nature) query = `${query} +nature`;
  if (web) query = `${query} +web`;
  if (nouveautés) query = `${query} +new`;
  if (soon) query = `${query} +soon`;
  if (loterie) query = `${query} +loterie`;
  if (minPrice) query = `${query} >${minPrice}$`;
  if (maxPrice) query = `${query} <${maxPrice}$`;
  if (vin) query = `${query} +vin`;
  if (rouge) query = `${query} +rouge`;
  if (blanc) query = `${query} +blanc`;
  if (rosé) query = `${query} +rosé`;
  if (orange) query = `${query} +orange`;
  if (cépages.length > 0) query = `${query} +cépages (${cépages.join(",")})`;
  if (aoc.length > 0) query = `${query} +aoc (${aoc.join(",")})`;
  if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>: \`/saq ${query}\``;

  return slackMessage;
}

const handler = async function(payload, res) {
  try {
    if (payload.text.trim().length == 0) {
      // help function
      res.status(200).json({
        response_type: "in_channel",
        attachments: [
          {
            title: ":mag: Options principales",
            fields: [
              {
                title: "Recherche simple : `/saq fou du beaujo`",
                value: "Retourne le premier produit qui correspond à la recherche. (qu'il soit en stock ou non)"
              },
              {
                title: "Recherche mutiple : `/saq ~sauternes`",
                value: "Retourne tous les produits en stock qui correspondent à la recherche."
              }
            ]
          },
          {
            title: ":gear: Modificateurs",
            fields: [
              {
                title: "Vins natures ou bio : `+nature`"
              },
              {
                title: "Produits disponibles en ligne : `+web`"
              },
              {
                title: "Produits nouvellement disponibles : `+new`"
              },
              {
                title: "Produits disponibles bientôt : `+soon`"
              },
              {
                title: "Produits en loterie : `+loterie`"
              },
              {
                title: "Produits en loterie bientôt : `+loterie +soon`"
              },
              {
                title: "Intervalle de prix : `<100$ >15$`",
                value: "On peut utiliser seulement `>` ou `<`, ou les deux."
              },
              {
                title: "Cépage(s) : `+cépage cabernet franc`, `+cépages (gamay, chardonnay)`",
                value: "Pour plusieurs cépages, utiliser le pluriel et les parenthèses, et séparer par des virgules."
              },
              {
                title: "Appellation(s) : `+aoc morgon`, `+aoc (morgon, juliénas)`",
                value: "Pour plusieurs appellations, utiliser des parenthèses et séparer par des virgules."
              },
              {
                title: "Vins : tous vins, rouges ou blancs uniquement : `+vin`, `+rouge`, `+blanc`, `+rosé`, `+orange`"
              }
            ]
          }
        ]
      });
      return;
    }

    res.status(200).json(util.formatReceipt());

    // strip newlines and replace with spaces
    let text = payload.text.replace(/[\n\r]/g, " ").trim();

    // special tokens
    let multiResult = false;
    let natureOnly = false;
    let webOnly = false;
    let nouveautés = false;
    let maxPrice = null;
    let minPrice = 0;
    let loterie = false;
    let soon = false;
    let cépages = [];
    let aoc = [];
    let vin = false;
    let rouge = false;
    let blanc = false;
    let rosé = false;
    let orange = false;

    if (text.startsWith("~")) {
      console.log("Multi-result query!");
      multiResult = true;
      text = text.substring(1);
    }
    if (text.includes("+nature")) {
      console.log("Nature!");
      natureOnly = true;
      text = text.replace("+nature", "").trim();
    }
    if (text.includes("+web")) {
      console.log("Web!");
      webOnly = true;
      text = text.replace("+web", "").trim();
    }
    if (text.includes("+soon")) {
      console.log("Soon!");
      soon = true;
      multiResult = true;
      text = text.replace("+soon", "").trim();
    }
    if (text.includes("+loterie")) {
      console.log("Loterie!");
      loterie = true;
      multiResult = true;
      text = text.replace("+loterie", "").trim();
    }
    var maxPriceRegex = /<(\d+)\$/;
    var maxPriceMatches = text.match(maxPriceRegex);
    if (maxPriceMatches) {
      console.log("Max Price!");
      maxPrice = maxPriceMatches[1].trim();
      text = text.replace(maxPriceRegex, "");
    }
    var minPriceRegex = />(\d+)\$/;
    var minPriceMatches = text.match(minPriceRegex);
    if (minPriceMatches) {
      console.log("Min Price!");
      minPrice = minPriceMatches[1].trim();
      text = text.replace(minPriceRegex, "");
    }
    var cépageRegex = /\+cépage ([^\+]+)(?=\+|$)/;
    var cépageMatches = text.match(cépageRegex);
    if (cépageMatches) {
      console.log("Cépage!");
      cépages = [cépageMatches[1].trim()];
      text = text.replace(cépageRegex, "");
    }
    var cépagesRegex = /\+cépages \(([^\)]+)\)/;
    var cépagesMatches = text.match(cépagesRegex);
    if (cépagesMatches) {
      console.log("Cépages!");
      cépages = cépagesMatches[1].split(",").map(e => e.trim());
      text = text.replace(cépagesRegex, "");
    }
    var aocRegex = /\+aoc \(([^\)]+)\)/;
    var aocMatches = text.match(aocRegex);
    if (aocMatches) {
      console.log("AOCs!");
      aoc = aocMatches[1].split(",").map(e => e.trim());
      text = text.replace(aocRegex, "");
    }
    aocRegex = /\+aoc ([^\+]+)(?=\+|$)/;
    aocMatches = text.match(aocRegex);
    if (aocMatches) {
      console.log("AOC!");
      aoc = [aocMatches[1].trim()];
      text = text.replace(aocRegex, "");
    }
    if (text.includes("+vin")) {
      console.log("Vin!");
      vin = true;
      text = text.replace("+vin", "").trim();
    }
    if (text.includes("+rouge")) {
      console.log("Rouge!");
      rouge = true;
      text = text.replace("+rouge", "").trim();
    } else if (text.includes("+blanc")) {
      console.log("Blanc!");
      blanc = true;
      text = text.replace("+blanc", "").trim();
    } else if (text.includes("+rosé")) {
      console.log("Rosé!");
      rosé = true;
      text = text.replace("+rosé", "").trim();
    } else if (text.includes("+orange")) {
      console.log("Arrange!");
      orange = true;
      text = text.replace("+orange", "").trim();
    }
    if (text.includes("+new")) {
      console.log("New!");
      nouveautés = true;
      multiResult = true;
      text = "";
    }

    let wineQueries = [""];
    if (text.trim().length > 0) wineQueries = util.getQueries(text);

    const wineInfoPromises = wineQueries.map(x =>
      scrapeWineInfo(
        x.trim(),
        multiResult,
        natureOnly,
        webOnly,
        nouveautés,
        minPrice,
        maxPrice,
        loterie,
        soon,
        cépages,
        aoc,
        vin,
        rouge,
        blanc,
        rosé,
        orange
      )
    );

    const wineInfos = await Promise.all(
      wineInfoPromises.map(p =>
        p.catch(err => {
          // ignore errors
          return { inError: true, query: err.exactQuery, message: err.message };
        })
      )
    );

    const wineDetails = await Promise.all(wineInfos.flat().map(x => (x.inError ? x : scrapeWineDetails(x)))).catch(util.onErrorRethrow);
    const wineWithScore = await Promise.all(wineDetails.map(x => (x.inError ? x : scrapeWineScore(x)))).catch(util.onErrorRethrow);

    const message = formatWineInfoSlackMessage(
      payload.user_id,
      text,
      wineWithScore,
      multiResult,
      natureOnly,
      webOnly,
      nouveautés,
      minPrice,
      maxPrice,
      loterie,
      soon,
      cépages,
      aoc,
      vin,
      rouge,
      blanc,
      rosé,
      orange
    );

    util.sendDelayedResponse(message, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "saq" };
