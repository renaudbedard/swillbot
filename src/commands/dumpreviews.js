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

function getCheckinComment(row) {
  return new Promise((resolve, reject) => {
    let args = {
      path: { checkinId: row.recent_checkin_id },
      parameters: util.untappdParams
    };
    let req = restClient.get("https://api.untappd.com/v4/checkin/view/${checkinId}", args, function(data, _) {
      if (!data.response.checkin) {
        resolve("");
      } else {
        let checkin = data.response.checkin;
        resolve({ id: row.row_number, review: checkin.checkin_comment });
      }
    });
    req.on("error", function(err) {
      resolve("");
    });
  });
}

function formatSlackMessage(checkinComments) {
  // See https://api.slack.com/docs/message-formatting
  let slackMessage = {
    response_type: "in_channel",
    attachments: []
  };

  var filteredReviews = checkinComments.filter(x => x != null && x.review != null && x.review.trim().length > 0);
  let attachment = {};

  if (filteredReviews.length == 0) {
    attachment = {
      color: "#ff0000",
      text: "Untappd API Limit Hit!"
    };
  } else {
    attachment = {
      color: "#ffcc00",
      text: filteredReviews.map(x => `${x.id} : ${x.review}`).join(`\n`)
    };
  }

  slackMessage.attachments.push(attachment);

  return slackMessage;
}

const handler = async function(payload, res) {
  let slackUser = payload.user_id;
  let untappdUser = null;
  let startFrom = 0;
  let limit = 100;
  let query = payload.text;

  if (payload.text.indexOf("@") > -1) {
    slackUser = payload.text.slice(payload.text.indexOf("@") + 1, payload.text.indexOf("|"));
    query = payload.text.slice(payload.text.indexOf(" ")).trim();
  }

  var queryParts = query.split(" ");

  startFrom = parseInt(queryParts[0]);
  if (queryParts.length == 2) {
    limit = Math.min(parseInt(queryParts[1]), 100);
  }

  try {
    res.status(200).json(util.formatReceipt());

    untappdUser = await getUntappdUser(slackUser);

    const result = await util.tryPgQuery(
      null,
      `select row_number() over (order by recent_checkin_id), recent_checkin_id
      from user_reviews 
      where username = $1
      order by recent_checkin_id
      limit $2
      offset $3`,
      [untappdUser.name, limit, startFrom],
      `Fetching checkin IDs for user`
    );

    let checkinComments = await Promise.all(result.rows.map(row => getCheckinComment(row)));

    const slackMessage = formatSlackMessage(checkinComments);

    util.sendDelayedResponse(slackMessage, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "dumpreviews" };
