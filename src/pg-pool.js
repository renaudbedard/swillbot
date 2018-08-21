/* global module */
/* global require */
/* global console */
/* global process */
"use strict";

const config = require("./config");

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: true
});

pool.on("error", (err, client) => {
  console.error("Unexpected error on idle client", err);
  process.exit(-1);
});

module.exports = pool;
