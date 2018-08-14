/* global module */
/* global require */
'use strict';

const config = require('./config');

const { Client } = require('pg');

const client = new Client({
  connectionString: config.DATABASE_URL,
  ssl: true
});

client.connect();

module.exports = client;
