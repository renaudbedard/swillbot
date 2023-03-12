/* global module */
/* global require */
"use strict";

const Client = require("node-rest-client-promise").Client;
const client = new Client();

client.lastGetTimestamp = Date.now();

client.rateLimitGet = async (url, args, callback) => 
{
    while (Date.now() - client.lastGetTimestamp < 250)
    {
        console.log(`Rate limiting for ${url}...`);
        await new Promise(r => setTimeout(r, 250));
    }
    client.lastGetTimestamp = Date.now();
    client.get(url, args, callback);
};

module.exports = client;
