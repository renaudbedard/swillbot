/* global module */
/* global console */
/* global require */
/* global Promise */
"use strict";

const config = require("./config");
const restClient = require("./rest-client");
const pgPool = require("./pg-pool");
const _ = require("lodash");

const untappdParams = {
  client_id: config.UNTAPPD_CLIENT_ID,
  client_secret: config.UNTAPPD_CLIENT_SECRET
};

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
    // ensure table exists
    return await (client || pgPool).query(query, values);
  } catch (err) {
    console.log(err.stack);
    err = { source: context, message: err.stack };
    throw err;
  }
}

/**
 * @param {float} rating The Untappd rating
 * @return {string} The emoji string
 */
function getRatingString(rating) {
  let ratingString = "";
  for (let i = 0; i < Math.floor(rating); i++) ratingString += ":fullbeer:";
  let fraction = rating - Math.floor(rating);
  if (fraction >= 0.75) ratingString += ":threequarterbeer:";
  else if (fraction >= 0.5) ratingString += ":halfbeer:";
  else if (fraction >= 0.25) ratingString += ":quarterbeer:";
  ratingString += ` *${rating}*`;
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
        text: err.message
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
      if (firstResult) {
        //console.log(`beer id : ${firstResult.beer.bid}`);
        resolve(firstResult.beer.bid);
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
function getBeerInfo(beerId) {
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
      resolve(data.response.beer);
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

module.exports = {
  getRatingString: getRatingString,
  formatError: formatError,
  searchForBeerId: searchForBeerId,
  getBeerInfo: getBeerInfo,
  tryPgQuery: tryPgQuery,
  untappdParams: untappdParams,
  formatReceipt: formatReceipt,
  sendDelayedResponse: sendDelayedResponse,
  onErrorRethrow: onErrorRethrow
};
