/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

async function getFakeReviewAttachment(beerInfo, userId) {
  return await util.tryOpenAiRequest(
    "ft:davinci-002:personal::8vnhQdPz",
    "https://ca.slack-edge.com/TBLMUG0RE-UBNESFXUP-9901982aefe7-512",
    beerInfo,
    "Matbot",
    112,
    1.0,
    userId
  );
}

module.exports = { name: "mat", getFakeReviewAttachment: getFakeReviewAttachment };
