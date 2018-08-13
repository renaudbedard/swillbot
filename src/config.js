/* global require */
/* global module */
/* global process */
'use strict';

const dotenv = require('dotenv');
const ENV = process.env.NODE_ENV || 'development';

if (ENV === 'development') dotenv.load();

const config = {
  ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  PROXY_URI: process.env.PROXY_URI,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  SLACK_TOKEN: process.env.SLACK_TOKEN,
  UNTAPPD_CLIENT_ID: process.env.UNTAPPD_CLIENT_ID,
  UNTAPPD_CLIENT_SECRET: process.env.UNTAPPD_CLIENT_SECRET,
  ICON_EMOJI: ':stars:'
};

module.exports = (key) => {
  if (!key) return config;

  return config[key];
};
