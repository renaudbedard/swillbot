/* global require */
/* global console */
"use strict";

const _ = require("lodash");
const config = require("../config");
const Botkit = require("botkit");

const controller = Botkit.slackbot({});
const bot = controller.spawn();

bot.configureIncomingWebhook({ url: config("WEBHOOK_URL") });

const msgDefaults = {
  response_type: "in_channel",
  username: "Swillbot",
  icon_emoji: config("ICON_EMOJI")
};

// TODO
