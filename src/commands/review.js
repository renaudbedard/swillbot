/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");
const restClient = require("../rest-client");
const _ = require("lodash");
const pgPool = require("../pg-pool");
const simon = require("./simon");
const seb = require("./seb");
const mat = require("./mat");
const vin = require("./vin");
const ren = require("./ren");
const alec = require("./alec");

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
 * @param {boolean} fuzzyGather Whether to accept all fuzzy matches
 * @return {object[]} The Untappd checkins
 */
async function findReview(userInfo, beerId, beerName, parentId, vintageIds, fuzzyGather) {
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

  let gatheredReviewInfos = [];
  let reviewInfo;

  const tryPushResult = result => {
    if (result != null && !gatheredReviewInfos.some(x => x.beer_id == result.beer_id)) gatheredReviewInfos.push(result);
  };

  if (result.rows.length == 1) {
    // force-recache the batch around that review's rank
    console.log(`[${userInfo.name}] found the beer check-in at ${result.rows[0].rank}; will force-recache`);
    reviewInfo = await findAndCacheUserBeers(userInfo, beerId, result.rows[0].rank);
    tryPushResult(reviewInfo);
  } else {
    console.log(`[${userInfo.name}] could not find the beer check-in; will fetch`);
    reviewInfo = await findAndCacheUserBeers(userInfo, beerId);
    tryPushResult(reviewInfo);
  }

  // vintages/variants
  if ((reviewInfo == null || fuzzyGather) && (parentId != null || vintageIds.length > 0)) {
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
      tryPushResult(reviewInfo);
    }
  }

  // last resort : string matching
  if (reviewInfo == null || fuzzyGather) {
    console.log(`[${userInfo.name}] trying to string match beer '${beerName}'...`);
    const fuzzyResult = await util.tryPgQuery(
      null,
      `select username, beer_id, beer_name, recent_checkin_id, recent_checkin_timestamp, count, rating, rank
      from user_reviews 
      where username = $1 and beer_name ilike $2`,
      [userInfo.name, `%${beerName}%`],
      `Looking for beer by name`
    );

    if (fuzzyResult.rows.length > 0) {
      if (fuzzyGather) {
        for (let i = 0; i < Math.min(fuzzyResult.rows.length, 50); i++) {
          console.log(`[${userInfo.name}] matched '${beerName}' as '${fuzzyResult.rows[i].beer_name}'`);
          tryPushResult(fuzzyResult.rows[i]);
        }
      } else {
        console.log(`[${userInfo.name}] matched '${beerName}' as '${fuzzyResult.rows[0].beer_name}'`);
        //reviewInfo = await findAndCacheUserBeers(userInfo, fuzzyResult.rows[0].beer_id, fuzzyResult.rows[0].rank);
        tryPushResult(fuzzyResult.rows[0]);
      }
    }
    if (gatheredReviewInfos.length == 0 || (!fuzzyGather && reviewInfo == null)) {
      console.log(`[${userInfo.name}] not found! we tried...`);
      return null;
    }
  }

  // separate request for the check-in comment
  if (fuzzyGather) {
    for (let ri of gatheredReviewInfos) {
      [ri.checkin_comment, ri.checkin_photo] = await getCheckinComment(ri.recent_checkin_id);
    }
    // order by score, descending
    gatheredReviewInfos.sort((a, b) => b.rating - a.rating);
    return gatheredReviewInfos;
  } else {
    [reviewInfo.checkin_comment, reviewInfo.checkin_photo] = await getCheckinComment(reviewInfo.recent_checkin_id);
    return [reviewInfo];
  }
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
function formatReviewSlackMessage(source, query, users, reviews, beerInfo, fuzzyGather) {
  // See https://api.slack.com/docs/message-formatting
  let slackMessage = {
    response_type: "in_channel",
    attachments: []
  };

  let strippedQuery = query;
  if (query.indexOf("<!channel>") > -1 || query.indexOf("<!everyone>") > -1 || query.indexOf("<!here>") > -1)
    strippedQuery = query.replace("<!", "@").replace(">", "");

  let attachment = {
    color: "#ffcc00",
    pretext: `<@${source}>: \`/review ${strippedQuery}\``,
    text: ""
  };

  let skipAttachment = false;

  if (beerInfo == null) {
    skipAttachment = true;
  } else {
    attachment.title_link = `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`;
    attachment.thumb_url = beerInfo.beer_label;
    if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
    else attachment.title = `${beerInfo.beer_name}`;
  }

  for (let i = 0; i < users.length; i++) {
    if (i > 0 && !skipAttachment) {
      slackMessage.attachments.push(attachment);
      attachment = { color: "#ffcc00", text: "" };
    }
    skipAttachment = false;

    if (reviews[i] == null && beerInfo != null) {
      if (users[i].name == "Bresson") {
        let fakeReview = simon.getFakeReviewAttachment(beerInfo);
        attachment.text = fakeReview.text;
        attachment.thumb_url = fakeReview.thumb_url;
      } else if (users[i].name == "Sebastouflant") {
        let fakeReview = seb.getFakeReviewAttachment(beerInfo);
        attachment.text = fakeReview.text;
        attachment.thumb_url = fakeReview.thumb_url;
      } else if (users[i].name == "matatatow") {
        let fakeReview = mat.getFakeReviewAttachment(beerInfo);
        attachment.text = fakeReview.text;
        attachment.thumb_url = fakeReview.thumb_url;
      } else if (users[i].name == "vin100limite") {
        let fakeReview = vin.getFakeReviewAttachment(beerInfo);
        attachment.text = fakeReview.text;
        attachment.thumb_url = fakeReview.thumb_url;
      } else if (users[i].name == "renaudbedard") {
        let fakeReview = ren.getFakeReviewAttachment(beerInfo);
        attachment.text = fakeReview.text;
        attachment.thumb_url = fakeReview.thumb_url;
      } else if (users[i].name == "AleAleAleB") {
        let fakeReview = alec.getFakeReviewAttachment(beerInfo);
        attachment.text = fakeReview.text;
        attachment.thumb_url = fakeReview.thumb_url;
      } else {
        skipAttachment = true;
      }
      continue;
    }

    const untappdUser = users[i].name;
    const reviewInfos = reviews[i] || [];

    let firstReview = true;
    for (let reviewInfo of reviewInfos) {
      if (!firstReview) {
        if (!skipAttachment) {
          slackMessage.attachments.push(attachment);
        }
        skipAttachment = false;
        attachment = { color: "#ffcc00", text: "" };
      }
      const ratingString = util.getRatingString(reviewInfo.rating);

      // is this a fuzzy match?
      if (beerInfo == null || reviewInfo.beer_id != beerInfo.bid) {
        if (fuzzyGather) {
          attachment.title_link = `https://untappd.com/b/${reviewInfo.beer_slug}/${reviewInfo.bid}`;
          attachment.thumb_url = reviewInfo.beer_label;
          if (reviewInfo.brewery) attachment.title = `${reviewInfo.brewery.brewery_name} – ${reviewInfo.beer_name}`;
          else attachment.title = `${reviewInfo.beer_name}`;
        } else attachment.text += `_Vintage or variant : *${reviewInfo.beer_name}*_\n`;
      }

      attachment.text += `${ratingString} (${reviewInfo.count} check-in${reviewInfo.count > 1 ? "s" : ""})`;
      attachment.text += `\n${reviewInfo.checkin_comment}`;

      if (reviewInfo.checkin_photo !== null) attachment.thumb_url = reviewInfo.checkin_photo;

      const date = reviewInfo.recent_checkin_timestamp;
      const dateString = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;

      attachment.text += `\n\t- _${untappdUser}_, <https://untappd.com/user/${untappdUser}/checkin/${reviewInfo.recent_checkin_id}|${dateString}>`;
      firstReview = false;
    }
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
  let fuzzyGather = false;

  // look for special tags
  if (payload.text.indexOf("<!channel>") > -1 || payload.text.indexOf("<!everyone>") > -1 || payload.text.indexOf("<!here>") > -1) {
    //console.log("found multi-user tag");
    slackUser = null;
    query = payload.text.slice(payload.text.indexOf(" ")).trim();
  } else if (payload.text.indexOf("@") > -1) {
    slackUser = payload.text.slice(payload.text.indexOf("@") + 1, payload.text.indexOf("|"));
    query = payload.text.slice(payload.text.indexOf(" ")).trim();
  }

  if (query.indexOf("~") != -1) {
    fuzzyGather = true;
    query = query.replace("~", "");
  }

  try {
    res.status(200).json(util.formatReceipt());

    if (slackUser == null) untappdUsers = await getUntappdUsers();
    else untappdUsers = [await getUntappdUser(slackUser)];

    let beerId = { id: -1 };
    let beerInfo = null;
    let vintageIds = [];
    let parentId = null;
    let beerName = query;

    if (!fuzzyGather) {
      beerId = await util.searchForBeerId(query);
      beerInfo = await util.getBeerInfo(beerId.id, query);

      const parent = beerInfo.variant_parent || beerInfo.vintage_parent;
      if (parent && parent.beer) parentId = parent.beer.bid;

      if (beerInfo.vintages) vintageIds = beerInfo.vintages.items.map(x => x.beer.bid);

      beerName = `${beerInfo.brewery.brewery_name} - ${beerInfo.beer_name}`;
    }

    const reviews = await Promise.all(untappdUsers.map(user => findReview(user, beerId.id, beerName, parentId, vintageIds, fuzzyGather))).catch(
      util.onErrorRethrow
    );

    const botUsers = ["Bresson", "Sebastouflant", "matatatow", "vin100limite", "renaudbedard", "AleAleAleB"];

    if (reviews.every((x, i) => (x == null || x.length == 0) && !botUsers.includes(untappdUsers[i].name))) {
      const error = {
        source: `Looking for beer ID in checkins`,
        message: `Requested users have not tried \`${beerName}\` yet!`
      };
      throw error;
    }

    //console.log(untappdUsers);
    //console.log(reviews);

    const slackMessage = formatReviewSlackMessage(payload.user_id, payload.text, untappdUsers, reviews, beerInfo, fuzzyGather);

    util.sendDelayedResponse(slackMessage, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "review" };
