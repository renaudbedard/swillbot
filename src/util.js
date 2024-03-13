/* global module */
/* global console */
/* global require */
/* global Promise */
"use strict";

const config = require("./config");
const restClient = require("./rest-client");
const pgPool = require("./pg-pool");
const _ = require("lodash");
const OpenAI = require("openai");

const untappdParams = {
  client_id: config.UNTAPPD_CLIENT_ID,
  client_secret: config.UNTAPPD_CLIENT_SECRET
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // This is also the default, can be omitted
});

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

    let req = restClient.rateLimitGet("https://api.untappd.com/v4/search/beer", args, function(data, _) {
      if (!data.response.beers) {
        reject({
          source: context,
          message: "API limit busted! Sorry, wait an hour before trying again.",
          additionalInfo: data,
          exactQuery: query
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

    let req = restClient.rateLimitGet("https://api.untappd.com/v4/beer/info/${id}", args, function(data, _) {
      if (Buffer.isBuffer(data)) {
        data = data.toString("utf8");
      }
      //console.log(`data : ${JSON.stringify(data)}`);
      if (!data.response || !data.response.beer) {
        reject({
          source: context,
          message: "API limit busted! Sorry, wait an hour before trying again.",
          additionalInfo: JSON.stringify(data),
          exactQuery: query
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

  let completion = null;
  let attempts = 0;
  while (completion === null && attempts < 3) {
    try {
      completion = await openai.completions.create({
        model: modelId,
        prompt: `${shortStyle} ->`,
        max_tokens: maxTokens,
        stop: [" END"],
        temperature: temperature,
        user: userId
      });      
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        console.error(error.status);  // e.g. 401
        console.error(error.message); // e.g. The authentication token you passed was invalid...
        console.error(error.code);  // e.g. 'invalid_api_key'
        console.error(error.type);  // e.g. 'invalid_request_error'

        completion = null;
        attempts++;
        if (attempts == 3) {
          throw error;
        }
      } else {
        // Non-API error
        console.log(error);
      }      
    }

    if (!completion || !completion.choices || completion.choices.length == 0 || !completion.choices[0]) {
      completion = null;
      attempts++;
    }
  }

  let generatedText = completion.choices[0].text;

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

/**
 * @param {string} userInfo The user to get unique beers from
 * @param {number} beerId The beer ID to stop at
 * @param {number=} fetchRank The ordinal rank of the beer in this user's unique beers
 * @return {Promise<object>} The review entity
 */
async function findAndCacheUserBeers(userInfo, beerId, fetchRank) {
  const pgClient = await pgPool.connect();

  let beerData = null;

  const args = {
    path: { userName: userInfo.name },
    parameters: _.cloneDeep(untappdParams)
  };

  try {
    // get the total count with a simple limit=1 request
    args.parameters.limit = 1;
    let res = await restClient.getPromise("https://api.untappd.com/v4/user/beers/${userName}", args);
    //console.log(`[${userInfo.name}] response : ${JSON.stringify(res.data.response)}`);

    const totalCount = res.data.response.total_count;

    //console.log(`total count: ${totalCount}`);

    const limit = fetchRank == undefined ? 50 : 10;
    args.parameters.limit = limit;

    let batchCount = 0;
    let upsertedCount = 0;
    let initialOffset = 0;
    let stopAtOffset = totalCount;

    // set initial & stopping offset if we're looking for a specific rank
    if (fetchRank != undefined) {
      initialOffset = Math.max(0, totalCount - (fetchRank - 1) - limit / 2); // ranks are 1-based
      stopAtOffset = Math.min(initialOffset + limit, totalCount);
      console.log(`[${userInfo.name}] totalCount: ${totalCount} | initial offset: ${initialOffset} | stop at: ${stopAtOffset}`);
    }

    // early-out if there are no beers at all
    if (res.data.response.beers.items.count == 0 || !res.data.response.beers.items[0]) {
      console.log(`[${userInfo.name}] no beer found, earlying out!`);
      return null;
    }

    // early-out if there are no new beers! (as per timestamp)
    let recentCheckinTimestamp = new Date(res.data.response.beers.items[0].recent_created_at);
    if (fetchRank == undefined && recentCheckinTimestamp < userInfo.lastReviewFetchTimestamp) {
      console.log(`[${userInfo.name}] already up to date, earlying out!`);
      return null;
    }

    pgClient.query("BEGIN;");

    let aborted = false;
    for (let cursor = initialOffset; cursor < stopAtOffset; cursor += batchCount) {
      args.parameters.offset = cursor;

      res = await restClient.getPromise("https://api.untappd.com/v4/user/beers/${userName}", args);

      if (!res.data.response.beers) {
        const err = {
          source: `Find beer reviews for user ${userInfo.name} and beer ID ${beerId}`,
          message: "API limit busted! Sorry, wait an hour before trying again.",
          additionalInfo: res.data
        };
        throw err;
      }

      batchCount = res.data.response.beers.items.length;
      for (let i = 0; i < batchCount; i++) {
        const item = res.data.response.beers.items[i];
        recentCheckinTimestamp = new Date(item.recent_created_at);

        // stop if check-in timestamp is earlier than user_mapping's last_review_fetch_timestamp
        // (unless we're force-recaching)
        if (fetchRank == undefined && recentCheckinTimestamp < userInfo.lastReviewFetchTimestamp) {
          console.log(
            `[${userInfo.name}] stopped fetching; current item was checked in at ${recentCheckinTimestamp} but we last fetched at ${
              userInfo.lastReviewFetchTimestamp
            }`
          );
          aborted = true;
          break;
        }

        const currentRank = totalCount - cursor - i;
        await tryPgQuery(
          pgClient,
          `insert into user_reviews 
          (username, beer_id, beer_name, recent_checkin_id, recent_checkin_timestamp, count, rating, rank) 
					values ($1, $2, $3, $4, $5, $6, $7, $8)
					on conflict (username, beer_id) do update set 
					recent_checkin_id = $4, recent_checkin_timestamp = $5, count = $6, rating = $7, rank = $8;`,
          [
            userInfo.name,
            item.beer.bid,
            `${item.brewery.brewery_name} - ${item.beer.beer_name}`,
            item.recent_checkin_id,
            recentCheckinTimestamp,
            item.count,
            item.rating_score,
            currentRank
          ],
          `Add user review for user ${userInfo.name} and beer ID ${item.beer.bid}`
        );

        // DEBUG logging
        if (fetchRank != undefined) {
          console.log(`upserted rank=${currentRank} (${item.brewery.brewery_name} - ${item.beer.beer_name})`);
        }

        console.log(`upserted beer id ${item.beer.bid} - recent checkin timestamp = ${recentCheckinTimestamp}, count = ${item.count}`);
        upsertedCount++;

        if (item.beer.bid == beerId) {
          console.log(
            `[${userInfo.name}] found '${item.brewery.brewery_name} - ${item.beer.beer_name}' at rank ${currentRank} (expected ${fetchRank})`
          );
          console.log(
            `'${item.brewery.brewery_name} - ${item.beer.beer_name}' : had ${item.count} times, first ${item.first_had}, latest : ${
              item.recent_created_at
            }`
          );
          console.log(`full query : https://api.untappd.com/v4/user/beers/\$\{username\}, args = ${JSON.stringify(args)}`);
          // mock a database result (faster than selecting it back)
          beerData = {
            username: userInfo.name,
            beer_id: item.beer.bid,
            beer_name: `${item.brewery.brewery_name} - ${item.beer.beer_name}`,
            recent_checkin_id: item.recent_checkin_id,
            recent_checkin_timestamp: recentCheckinTimestamp,
            count: item.count,
            rating: item.rating_score,
            rank: currentRank
          };
        }
      }
      if (aborted) break;
    }

    pgClient.query("COMMIT;");
    if (upsertedCount > 0) {
      console.log(`[${userInfo.name}] upserted ${upsertedCount} rows`);
    }
  } catch (err) {
    pgClient.query("ROLLBACK;");
    throw err;
  } finally {
    pgClient.release();
  }

  // if we're not force-recaching, insert last fetch date into user_mapping
  if (fetchRank == undefined) {
    await tryPgQuery(
      null,
      `update user_mapping 
      set last_review_fetch_timestamp = $1
      where untappd_username = $2`,
      [new Date(), userInfo.name],
      `Update last review fetch timestamp for ${userInfo.name} to ${new Date()}`
    );
    //console.log(`[${userInfo.name}] updated last fetch time to ${new Date()}`);
  }

  return beerData;
}

/**
 * @return {Promise<any[]>} All registered Untappd users' info
 */
async function getUntappdUsers() {
  const result = await tryPgQuery(
    null,
    `select untappd_username, last_review_fetch_timestamp 
    from user_mapping`,
    null,
    `Fetch all Untappd usernames`
  );
  return result.rows.map(x => {
    return { name: x.untappd_username, lastReviewFetchTimestamp: x.last_review_fetch_timestamp };
  });
}

/**
 * @param {string} slackUserId The Slack user's ID
 * @return {Promise<any>} The Untappd user info
 */
async function getUntappdUser(slackUserId) {
  const result = await tryPgQuery(
    null,
    `select untappd_username, last_review_fetch_timestamp 
    from user_mapping 
    where slack_user_id = $1`,
    [slackUserId],
    `Find Untappd username from Slack ID '${slackUserId}'`
  );

  if (result.rows.length == 0) {
    const err = {
      source: `Finding Untappd username for Slack user ID ${slackUserId}`,
      message: "No user found in database! Did you forget to register using `/username`?"
    };
    throw err;
  }

  return {
    name: result.rows[0].untappd_username,
    lastReviewFetchTimestamp: result.rows[0].last_review_fetch_timestamp
  };
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
  tryOpenAiRequest: tryOpenAiRequest,
  findAndCacheUserBeers: findAndCacheUserBeers,
  getUntappdUsers: getUntappdUsers,
  getUntappdUser: getUntappdUser
};
