7/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

function formatSlackMessage(source, query, req) {

  let locomotive = ":triggered:"; 

  if (req.route.path.includes("gebot")) {
    locomotive = ":triggsgebot:";
  }

  let wagonCount = Math.floor(Math.random() * Math.random() * 10 + 5);

  let trainEmoji = [
    ":mountain_railway:",
    ":suspension_railway:",
    ":train:",
    ":railway_car:",
    ":mountain_railway:",
  ];

  let block = {
    "type": "section",
    "text": {
      "text": `${locomotive}`,
      "type": "plain_text"
    }
  };

  let wagonEmoji = trainEmoji[Math.floor(Math.random() * trainEmoji.length)];
  let hasWind = Math.random() < 0.5;

  for (let i = 0; i < wagonCount; i++) {
    block.text.text += wagonEmoji;
  }

  if (hasWind) {
    block.text.text += ":dash:";
  }

  // See https://api.slack.com/docs/message-formatting
  return {
    response_type: "in_channel",
    blocks: [block]
  };
}

const handler = async function(payload, res, req) {

  let query = payload.text ? payload.text : "";

  try {
    res.status(200).json(util.formatReceipt());

    const slackMessage = formatSlackMessage(payload.user_id, query, req);

    util.sendDelayedResponse(slackMessage, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "train", altname: "trainsgebot"};
