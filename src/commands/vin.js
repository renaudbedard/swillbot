/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

async function getFakeReviewAttachment(beerInfo, userId) {
  return await util.tryOpenAiRequest(
    "ft:davinci-002:personal::8vnuRi92",
    "https://ca.slack-edge.com/TBLMUG0RE-UFJ0ZEK43-067d4aa674e4-512",
    beerInfo,
    "Vinbot",
    96,
    0.9,
    userId
  );
}

module.exports = { name: "vin", getFakeReviewAttachment: getFakeReviewAttachment };
