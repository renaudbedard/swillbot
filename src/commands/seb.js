/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

async function getFakeReviewAttachment(beerInfo, userId) {
  return await util.tryOpenAiRequest(
    "curie:ft-personal-2022-02-06-05-07-59",
    "https://ca.slack-edge.com/TBLMUG0RE-UBM63GB2Q-c63d2136d247-512",
    beerInfo,
    "Sebbot",
    96,
    0.9,
    userId
  );
}

module.exports = { name: "seb", getFakeReviewAttachment: getFakeReviewAttachment };
