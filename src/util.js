/* global module */
/* global console */
/* global require */
/* global Promise */
"use strict";

const config = require("./config");
const restClient = require("./rest-client");
const pgPool = require("./pg-pool");
const _ = require("lodash");
const { Configuration, OpenAIApi } = require("openai");
const nodeUtil = require("util");

const untappdParams = {
  client_id: config.UNTAPPD_CLIENT_ID,
  client_secret: config.UNTAPPD_CLIENT_SECRET
};

function indexOfFirstOf(haystack, needles, startIndex) {
  let minIndex = Infinity;
  let foundNeedle = null;
  for (let needle of needles) {
    let index = haystack.indexOf(needle, startIndex);
    if (index != -1 && index < minIndex) {
      minIndex = index;
      foundNeedle = needle;
    }
  }
  return { symbol: foundNeedle, index: minIndex == Infinity ? -1 : minIndex };
}

/**
 * Parses a beer query.
 * @param {string} text The payload text
 * @return {string[]} The queries
 */
function getQueries(text) {
  const splitText = [];
  let queryText;
  let queryStart = 0;
  let openBraceIndex;
  let closeBraceIndex = 0;
  let commaIndex;
  do {
    commaIndex = text.indexOf(",", queryStart);
    if (commaIndex == -1) commaIndex = text.length;
    openBraceIndex = text.indexOf("(", queryStart);
    if (openBraceIndex != -1 && openBraceIndex < commaIndex) {
      // potential beer group
      const brewery = text.substring(queryStart, openBraceIndex).trim();
      // match count of opening and closing braces
      let openCount = 1;
      let lastSymbolIndex = openBraceIndex;
      while (openCount > 0) {
        const result = indexOfFirstOf(text, ["(", ")"], lastSymbolIndex + 1);
        if (result.symbol == "(") openCount++;
        if (result.symbol == ")") openCount--;
        if (result.index != -1) lastSymbolIndex = result.index;
        else {
          // unbalanced parenthesis! abort and ganbatte kudasai
          console.log("unbalanced parenthesis!");
          lastSymbolIndex = text.indexOf(")", openBraceIndex + 1);
          break;
        }
      }
      closeBraceIndex = lastSymbolIndex;
      const beers = text
        .substring(openBraceIndex + 1, closeBraceIndex)
        .split(",")
        .map(x => x.trim());
      if (beers.length > 1) {
        // actual beer group
        for (var beer of beers) splitText.push(`${brewery} ${beer}`);
        commaIndex = text.indexOf(",", closeBraceIndex);
        if (commaIndex == -1) commaIndex = text.length;
      } else {
        // this is most likely just a year tag; treat it as not-a-group
        queryText = text.substring(queryStart, commaIndex).trim();
        if (queryText.length > 0) splitText.push(queryText);
      }
      queryStart = commaIndex + 1;
    } else {
      // this query does not have a beer group
      queryText = text.substring(queryStart, commaIndex).trim();
      if (queryText.length > 0) splitText.push(queryText);
      queryStart = commaIndex + 1;
    }
  } while (commaIndex < text.length);
  // we're done!

  return splitText;
}

/**
 * Formats a receipt as a Slack message.
 * @return {object} The Slack message
 */
function formatReceipt() {
  let slackMessage = {
    response_type: "ephemeral",
    text: "Working... :hourglass_flowing_sand:"
  };
  return slackMessage;
}

/**
 * @param {object} message The delayed response
 * @param {string} responseUrl Slack's response URL
 */
function sendDelayedResponse(message, responseUrl) {
  const args = {
    data: message,
    headers: { "Content-Type": "application/json" }
  };
  restClient.post(responseUrl, args, function(data, response) {
    //console.log(`Success!`);
  });
}

/**
 * @param {object} client The PG client
 * @param {string} query The SQL query
 * @param {object[]} values Query values (optional)
 * @param {string} context What this query performs
 * @return {QueryResult} The query result
 */
async function tryPgQuery(client, query, values, context) {
  try {
    return await (client || pgPool).query(query, values);
  } catch (err) {
    console.log(err.stack);
    err = { source: context, message: err.stack };
    throw err;
  }
}

/**
 * @param {float} rating The Untappd rating
 * @param {bool?} wineMode Whether to use wine emoji
 * @return {string} The emoji string
 */
function getRatingString(rating, wineMode = false, wineType = null) {
  if (isNaN(rating) || rating == 0) return "";
  const emojiSuffix = wineMode ? "wine" : "beer";
  const emojiPrefix = wineType ? wineType : "";
  let ratingString = "";
  for (let i = 0; i < Math.floor(rating); i++) ratingString += `:${emojiPrefix}full${emojiSuffix}:`;
  let fraction = rating - Math.floor(rating);
  if (fraction >= 0.75) ratingString += `:${emojiPrefix}threequarter${emojiSuffix}:`;
  else if (fraction >= 0.5) ratingString += `:${emojiPrefix}half${emojiSuffix}:`;
  else if (fraction >= 0.25) ratingString += `:${emojiPrefix}quarter${emojiSuffix}:`;
  ratingString += ` *${rating.toFixed(2)}*`;
  return ratingString;
}

/**
 * Formats an error as a Slack message.
 * @param {object} err The error details
 * @return {object} The Slack message
 */
function formatError(err) {
  let slackMessage = {
    response_type: "ephemeral",
    text: `Oops! Something went wrong with this operation : '${err.source}'.`,
    attachments: [
      {
        color: "#ff0000",
        text: err.stack || err.message
      }
    ]
  };
  console.log(err);
  return slackMessage;
}

/**
 * @param {string} query The beer search query string
 * @return {int} The first found beer ID
 */
function searchForBeerId(query) {
  //console.log(`query : ${query}`);
  const context = `Search for beer '${query}'`;
  return new Promise((resolve, reject) => {
    let args = {
      parameters: _.defaults(
        {
          q: query,
          limit: 1
        },
        untappdParams
      )
    };

    let req = restClient.get("https://api.untappd.com/v4/search/beer", args, function(data, _) {
      if (!data.response.beers) {
        reject({
          source: context,
          message: "API limit busted! Sorry, wait an hour before trying again.",
          additionalInfo: data
        });
        return;
      }
      let firstResult =
        data.response.beers.count > 0 ? data.response.beers.items[0] : data.response.homebrew.count > 0 ? data.response.homebrew.items[0] : null;
      console.log(`found ${data.response.beers.count} results for query : ${query}`);
      if (firstResult) {
        console.log(`first result has beer ID of : ${firstResult.beer.bid}`);
        resolve({
          id: firstResult.beer.bid,
          query: query
        });
      } else
        reject({
          source: context,
          message: "Couldn't find matching beer!",
          exactQuery: query
        });
    });

    req.on("error", function(err) {
      reject({ source: context, message: err.toString() });
    });
  });
}

/**
 * @param {int} beerId The beer ID to look for
 * @return {Promise<object>} The Untapped data for this beer
 */
function getBeerInfo(beerId, query) {
  const context = `Get beer info for beer #${beerId}`;
  return new Promise((resolve, reject) => {
    let args = {
      path: {
        id: beerId
      },
      parameters: untappdParams
    };

    let req = restClient.get("https://api.untappd.com/v4/beer/info/${id}", args, function(data, _) {
      //console.log(`beer info : ${data.response.beer}`);
      if (!data.response.beer) {
        reject({
          source: context,
          message: "API limit busted! Sorry, wait an hour before trying again.",
          additionalInfo: data
        });
        return;
      }
      //console.log(data.response);
      let response = data.response.beer;
      response.query = query;
      resolve(response);
    });

    req.on("error", function(err) {
      reject({
        source: context,
        message: err.toString()
      });
    });
  });
}

/**
 * @param {object} err Error data
 */
function onErrorRethrow(err) {
  throw err;
}

async function tryOpenAiRequest(modelId, thumbUrl, beerInfo, botName, maxTokens, temperature, userId) {
  let attachment = {
    color: "#ffcc00",
    thumb_url: thumbUrl,
    text: ""
  };

  if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
  else attachment.title = `${beerInfo.beer_name}`;

  var shortStyle = beerInfo.beer_style.split(" -")[0];

  let response = null;
  let attempts = 0;
  while (response === null && attempts < 3) {
    try {
      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY
      });
      const openai = new OpenAIApi(configuration);
      response = await openai.createCompletionFromModel({
        model: modelId,
        prompt: `${shortStyle} ->`,
        max_tokens: maxTokens,
        stop: [" END"],
        temperature: temperature,
        user: userId
      });
    } catch (err) {
      response = null;
      attempts++;
      if (attempts == 3) {
        throw err;
      }
      console.log(`Failed with err : ${err}, retrying (attempt ${attempts})`);
    }
  }

  if (response.status != 200) {
    throw {
      source: `Generating ${userId} review`,
      message: `Error ${response.status}!\n${nodeUtil.inspect(response.data)}`
    };
  }

  const responseData = response.data;

  let generatedText = responseData.choices[0].text;

  let textParts = generatedText.split(" ### ");

  let rating = 4.0;
  if (parseFloat(textParts[0]) != NaN) {
    rating = parseFloat(textParts[0]);
  }
  const ratingString = getRatingString(rating);

  attachment.text += `${ratingString}`;
  attachment.text += `\n${textParts[1]}`;

  attachment.text += `\n\t- _${botName}_`;

  return attachment;
}

module.exports = {
  getRatingString: getRatingString,
  formatError: formatError,
  searchForBeerId: searchForBeerId,
  getBeerInfo: getBeerInfo,
  tryPgQuery: tryPgQuery,
  untappdParams: untappdParams,
  formatReceipt: formatReceipt,
  sendDelayedResponse: sendDelayedResponse,
  onErrorRethrow: onErrorRethrow,
  getQueries: getQueries,
  tryOpenAiRequest: tryOpenAiRequest
};
