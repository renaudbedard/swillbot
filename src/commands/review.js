/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");
const restClient = require("../rest-client");
const _ = require("lodash");
const pgPool = require("../pg-pool");

/**
 * @return {Promise<string[]>} The Untappd users
 */
async function getUntappdUsers() {
  const result = await util.tryPgQuery(null, `select untappd_username from user_mapping`, null, `Fetch all Untappd usernames`);
  //console.log(`found ${result.rows.length} users`);
  return result.rows.map(x => x.untappd_username);
}

/**
 * @param {string} slackUserId The Slack user's ID
 * @return {Promise<string>} The Untappd user name
 */
async function getUntappdUser(slackUserId) {
  const result = await util.tryPgQuery(
    null,
    `select untappd_username from user_mapping
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
  return result.rows[0].untappd_username;
}

/**
 * @param {string} userName The user to get checkins from
 * @param {int} beerId The beer ID to look for
 * @param {string} beerName The beer name
 * @return {object[]} The Untappd checkins
 */
async function findReview(userName, beerId, beerName) {
  //console.log(`userName = ${userName}, beerId = ${beerId}`);

  // DEBUG -- drop table
  //await util.tryPgQuery(null, 'drop table user_reviews', null, 'Debug drop');

  // create table if needed
  await util.tryPgQuery(
    null,
    `create table if not exists user_reviews (
		username varchar not null,
		beer_id integer not null,
		recent_checkin_id integer,
		recent_checkin_timestamp date,
		count integer,
		rating real,
		primary key (username, beer_id));`,
    null,
    "Create user reviews table"
  );

  // look in cache first
  const result = await util.tryPgQuery(
    null,
    `select * from user_reviews
        where username = $1 and beer_id = $2`,
    [userName, beerId],
    `Find beer reviews for user ${userName} and beer ID ${beerId}`
  );

  let reviewInfo;
  if (result.rows.length == 1) reviewInfo = result.rows[0];
  else {
    // if there are no results, fill cache
    console.log(`couldn't find beer id ${beerId} for username ${userName}, will cache user beers`);
    reviewInfo = await findAndCacheUserBeers(userName, beerId);
  }

  if (reviewInfo == null) {
    const error = {
      source: `Looking for beer ID in checkins`,
      message: `\`${userName}\` has not tried \`${beerName}\` yet!`
    };
    throw error;
  }

  // separate request for the check-in comment
  reviewInfo.checkin_comment = await getCheckinComment(reviewInfo.recent_checkin_id);

  return reviewInfo;
}

/**
 * @param {string} userName The user to get unique beers from
 * @param {int} beerId The beer ID to stop at
 * @return {Promise<object>} The review entity
 */
async function findAndCacheUserBeers(userName, beerId) {
  const pgClient = await pgPool.connect();

  let beerData = null;

  // make sure the table exists
  try {
    const limit = 50;
    let batchCount = 0;
    let totalCount = 50;
    let upsertedCount = 0;

    const args = {
      path: { userName: userName },
      parameters: _.defaults({ limit: limit }, util.untappdParams)
    };

    pgClient.query("BEGIN;");

    for (let cursor = 0; cursor < totalCount; cursor += batchCount) {
      args.parameters.offset = cursor;

      // TODO: error handling?
      const res = await restClient.getPromise("https://api.untappd.com/v4/user/beers/${userName}", args);

      totalCount = res.data.response.total_count;
      batchCount = res.data.response.beers.items.length;
      for (let item of res.data.response.beers.items) {
        await util.tryPgQuery(
          pgClient,
          `insert into user_reviews (
					username, beer_id, recent_checkin_id, recent_checkin_timestamp, count, rating) 
					values ($1, $2, $3, $4, $5, $6)
					on conflict (username, beer_id) do update set 
					recent_checkin_id = $3, recent_checkin_timestamp = $4, count = $5, rating = $6;`,
          [userName, item.beer.bid, item.recent_checkin_id, new Date(item.recent_created_at), item.count, item.rating_score],
          `Add user review for user ${userName} and beer ID ${item.beer.bid}`
        );

        //console.log(`upserted beer id ${item.beer.bid}`);
        upsertedCount++;

        if (item.beer.bid == beerId) {
          console.log(`found!`);
          // mock a database result (faster than selecting it back)
          beerData = {
            username: userName,
            beer_id: item.beer.bid,
            recent_checkin_id: item.recent_checkin_id,
            recent_checkin_timestamp: new Date(item.recent_created_at),
            count: item.count,
            rating: item.rating_score
          };
          break;
        }
      }
      if (beerData != null) break;
    }

    pgClient.query("COMMIT;");
    console.log(`upserted ${upsertedCount} rows`);
  } catch (err) {
    pgClient.query("ROLLBACK;");
    throw err;
  } finally {
    pgClient.release();
  }

  return beerData;
}

/**
 * @param {int} checkinId The ID of the check-in
 * @return {string} The check-in comment for that ID
 */
function getCheckinComment(checkinId) {
  return new Promise((resolve, reject) => {
    let args = {
      path: { checkinId: checkinId },
      parameters: util.untappdParams
    };
    let req = restClient.get("https://api.untappd.com/v4/checkin/view/${checkinId}", args, function(data, _) {
      if (!data.response.checkin) {
        console.log(data.response);
        reject({
          source: `Get check-in comment for #${checkinId}`,
          message: "Couldn't find matching check-in!"
        });
      } else resolve(data.response.checkin.checkin_comment);
    });
    req.on("error", function(err) {
      reject({
        source: `Get check-in comment for #${checkinId}`,
        message: err.toString()
      });
    });
  });
}

/**
 * @param {string} source The user ID that made the request
 * @param {string} query The original request
 * @param {string} users The Untappd users
 * @param {object} reviews Untappd reviews
 * @param {object} beerInfo Untappd beer info
 * @return {object} The rich slack message
 */
function formatReviewSlackMessage(source, query, users, reviews, beerInfo) {
  // See https://api.slack.com/docs/message-formatting
  let slackMessage = {
    response_type: "in_channel",
    attachments: []
  };

  for (let i = 0; i < users.length; i++) {
    const untappdUser = users[i];
    const reviewInfo = reviews[i];

    const ratingString = util.getRatingString(reviewInfo.rating);

    let attachment = {
      color: "#ffcc00",
      title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
      thumb_url: beerInfo.beer_label,
      text: `${ratingString} (${reviewInfo.count} check-in${reviewInfo.count > 1 ? "s" : ""})`
    };
    if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
    else attachment.title = `${beerInfo.beer_name}`;

    attachment.text += `\n${reviewInfo.checkin_comment}`;

    const date = reviewInfo.recent_checkin_timestamp;
    const dateString = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    attachment.text += `\n\t- _${untappdUser}_, <https://untappd.com/user/${untappdUser}/checkin/${reviewInfo.recent_checkin_id}|${dateString}>`;

    slackMessage.attachments.push(attachment);
  }

  if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>: \`/review ${query}\``;

  return slackMessage;
}

const handler = async function(payload, res) {
  let slackUser = payload.user_id;
  let untappdUsers = [];
  let query = payload.text;

  // look for special tags
  if (payload.text.indexOf("<!channel>") > -1 || payload.text.indexOf("<!everyone>") > -1 || payload.text.indexOf("<!here>") > -1) {
    //console.log("found multi-user tag");
    slackUser = null;
    query = payload.text.slice(payload.text.indexOf(" ")).trim();
  } else if (payload.text.indexOf("@") > -1) {
    slackUser = payload.text.slice(payload.text.indexOf("@") + 1, payload.text.indexOf("|"));
    query = payload.text.slice(payload.text.indexOf(" ")).trim();
  }

  try {
    res.status(200).json(util.formatReceipt());

    if (slackUser == null) untappdUsers = await getUntappdUsers();
    else untappdUsers = [await getUntappdUser(slackUser)];

    const beerId = await util.searchForBeerId(query);
    const beerInfo = await util.getBeerInfo(beerId);

    const reviews = await Promise.all(untappdUsers.map(user => findReview(user, beerId, query))).catch(util.onErrorRethrow);

    //console.log(untappdUsers);
    //console.log(reviews);

    const slackMessage = formatReviewSlackMessage(payload.user_id, payload.text, untappdUsers, reviews, beerInfo);

    util.sendDelayedResponse(slackMessage, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "review" };
