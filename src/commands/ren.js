/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

async function getFakeReviewAttachment(beerInfo, userId) {
  return await util.tryOpenAiRequest(
    "curie:ft-personal-2022-02-06-00-56-29",
    "https://ca.slack-edge.com/TBLMUG0RE-UBLMUG24Q-944d4643c7ed-512",
    beerInfo,
    "Renbot",
    96,
    1.0,
    userId
  );
}

module.exports = { name: "ren", getFakeReviewAttachment: getFakeReviewAttachment };
