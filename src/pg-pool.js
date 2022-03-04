/* global module */
/* global require */
/* global console */
/* global process */
"use strict";

const config = require("./config");

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;
