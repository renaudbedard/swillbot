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
 * @return {Promise<any[]>} All registered Untappd users' info
 */
async function getUntappdUsers() {
  const result = await util.tryPgQuery(
    null,
    `select untappd_username, last_review_fetch_timestamp 
    from user_mapping`,
    null,
    `Fetch all Untappd usernames`
  );
  //console.log(`found ${result.rows.length} users`);
  return result.rows.map(x => {
    return { name: x.untappd_username, lastReviewFetchTimestamp: x.last_review_fetch_timestamp };
  });
}

/**
 * @param {string} slackUserId The Slack user's ID
 * @return {Promise<any>} The Untappd user info
 */
async function getUntappdUser(slackUserId) {
  const result = await util.tryPgQuery(
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

/**
 * @param {string} userInfo The user to get checkins from
 * @param {number} beerId The beer ID to look for
 * @param {string} beerName The beer name
 * @param {number=} parentId The beer ID of the parent, if this is a vintage beer
 * @param {integer[]} vintageIds The beer IDs of the child vintages, if any
 * @return {object[]} The Untappd checkins
 */
async function findReview(userInfo, beerId, beerName, parentId, vintageIds) {
  //console.log(`userName = ${userName}, beerId = ${beerId}`);

  // DEBUG DROP
  //await util.tryPgQuery(null, "drop table user_reviews", null, "Debug drop");

  // create table if needed
  await util.tryPgQuery(
    null,
    `create table if not exists user_reviews (
		username text not null,
    beer_id integer not null,
    beer_name text,
		recent_checkin_id integer,
		recent_checkin_timestamp date,
		count integer,
    rating real,
    rank integer,
		primary key (username, beer_id));`,
    null,
    "Create user reviews table"
  );

  // look in cache first
  const result = await util.tryPgQuery(
    null,
    `select rank
    from user_reviews 
    where username = $1 and beer_id = $2`,
    [userInfo.name, beerId],
    `Find beer reviews for user ${userInfo.name} and beer ID ${beerId}`
  );

  let reviewInfo;
  if (result.rows.length == 1) {
    // force-recache the batch around that review's rank
    console.log(`[${userInfo.name}] found the beer check-in; will force-recache`);
    reviewInfo = await findAndCacheUserBeers(userInfo, beerId, result.rows[0].rank);
  } else {
    console.log(`[${userInfo.name}] could not find the beer check-in; will fetch`);
    reviewInfo = await findAndCacheUserBeers(userInfo, beerId);
  }

  // vintages/variants
  if (reviewInfo == null && (parentId != null || vintageIds.length > 0)) {
    console.log(`[${userInfo.name}] trying to match parentId ${parentId} or vintage IDs [${vintageIds}]...`);
    const parentResult = await util.tryPgQuery(
      null,
      `select beer_id, beer_name, rank
      from user_reviews 
      where username = $1 and (beer_id = $2 or beer_id = any ($3))`,
      [userInfo.name, parentId || -1, vintageIds],
      `Looking for vintages`
    );

    if (parentResult.rows.length > 0) {
      console.log(`[${userInfo.name}] matched '${beerName}' as '${parentResult.rows[0].beer_name}' (rank ${parentResult.rows[0].rank})`);
      reviewInfo = await findAndCacheUserBeers(userInfo, parentResult.rows[0].beer_id, parentResult.rows[0].rank);
    }
  }

  // last resort : string matching
  if (reviewInfo == null) {
    console.log(`[${userInfo.name}] trying to string match beer '${beerName}'...`);
    const fuzzyResult = await util.tryPgQuery(
      null,
      `select beer_id, beer_name, rank
      from user_reviews 
      where username = $1 and beer_name ilike $2`,
      [userInfo.name, `%${beerName}%`],
      `Looking for beer by name`
    );

    if (fuzzyResult.rows.length > 0) {
      console.log(`[${userInfo.name}] matched '${beerName}' as '${fuzzyResult.rows[0].beer_name}'`);
      reviewInfo = await findAndCacheUserBeers(userInfo, fuzzyResult.rows[0].beer_id, fuzzyResult.rows[0].rank);
    }
    if (reviewInfo == null) {
      console.log(`[${userInfo.name}] not found! we tried...`);
      return null;
    }
  }

  // separate request for the check-in comment
  [reviewInfo.checkin_comment, reviewInfo.checkin_photo] = await getCheckinComment(reviewInfo.recent_checkin_id);

  return reviewInfo;
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
    parameters: _.cloneDeep(util.untappdParams)
  };

  try {
    // get the total count with a simple limit=1 request
    args.parameters.limit = 1;
    let res = await restClient.getPromise("https://api.untappd.com/v4/user/beers/${userName}", args);
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
      //console.log(`initial offset: ${initialOffset} | stop at: ${stopAtOffset}`);
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
        await util.tryPgQuery(
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
        //if (fetchRank != undefined) {
        //  console.log(`upserted rank=${currentRank} (${item.brewery.brewery_name} - ${item.beer.beer_name})`);
        //}

        //console.log(`upserted beer id ${item.beer.bid}`);
        upsertedCount++;

        if (item.beer.bid == beerId) {
          console.log(
            `[${userInfo.name}] found '${item.brewery.brewery_name} - ${item.beer.beer_name}' at rank ${currentRank} (expected ${fetchRank})`
          );
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
    await util.tryPgQuery(
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
      } else {
        let checkin = data.response.checkin;
        if (checkin.media.count > 0) resolve([checkin.checkin_comment, checkin.media.items[0].photo.photo_img_sm]);
        else resolve([checkin.checkin_comment, null]);
      }
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

  let attachment = {
    color: "#ffcc00",
    title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
    thumb_url: beerInfo.beer_label,
    pretext: `<@${source}>: \`/review ${query}\``,
    text: ""
  };

  if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
  else attachment.title = `${beerInfo.beer_name}`;

  let skipAttachment = false;
  for (let i = 0; i < users.length; i++) {
    if (i > 0 && !skipAttachment) {
      slackMessage.attachments.push(attachment);
      attachment = { color: "#ffcc00", text: "" };
    }
    skipAttachment = false;

    if (reviews[i] == null) {
      skipAttachment = true;
      continue;
    }

    const untappdUser = users[i].name;
    const reviewInfo = reviews[i];
    const ratingString = util.getRatingString(reviewInfo.rating);

    // is this a fuzzy match?
    if (reviewInfo.beer_id != beerInfo.bid) {
      attachment.text += `_Vintage or variant : *${reviewInfo.beer_name}*_\n`;
    }

    attachment.text += `${ratingString} (${reviewInfo.count} check-in${reviewInfo.count > 1 ? "s" : ""})`;
    attachment.text += `\n${reviewInfo.checkin_comment}`;

    if (reviewInfo.checkin_photo !== null) attachment.thumb_url = reviewInfo.checkin_photo;

    const date = reviewInfo.recent_checkin_timestamp;
    const dateString = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;

    attachment.text += `\n\t- _${untappdUser}_, <https://untappd.com/user/${untappdUser}/checkin/${reviewInfo.recent_checkin_id}|${dateString}>`;
  }

  if (!skipAttachment) {
    slackMessage.attachments.push(attachment);
  }

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
    const beerInfo = await util.getBeerInfo(beerId.id, query);

    let parentId = null;
    const parent = beerInfo.variant_parent || beerInfo.vintage_parent;
    if (parent && parent.beer) parentId = parent.beer.bid;

    let vintageIds = [];
    if (beerInfo.vintages) vintageIds = beerInfo.vintages.items.map(x => x.beer.bid);

    const beerName = `${beerInfo.brewery.brewery_name} - ${beerInfo.beer_name}`;

    const reviews = await Promise.all(untappdUsers.map(user => findReview(user, beerId.id, beerName, parentId, vintageIds))).catch(
      util.onErrorRethrow
    );

    if (reviews.every(x => x == null)) {
      const error = {
        source: `Looking for beer ID in checkins`,
        message: `Requested users have not tried \`${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}\` yet!`
      };
      throw error;
    }

    //console.log(untappdUsers);
    //console.log(reviews);

    const slackMessage = formatReviewSlackMessage(payload.user_id, payload.text, untappdUsers, reviews, beerInfo);

    util.sendDelayedResponse(slackMessage, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "review" };
