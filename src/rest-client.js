/* global module */
/* global require */
"use strict";

const Client = require("node-rest-client-promise").Client;
const client = new Client();

client.lastGetTimestamp = Date.now();

client.rateLimitGet = async (url, args, callback) => 
{
    while (Date.now() - client.lastGetTimestamp < 1000)
    {
        //console.log(`Rate limiting for ${url}...`);
        await new Promise(r => setTimeout(r, 1000));
    }
    client.lastGetTimestamp = Date.now();
    return client.get(url, args, callback);
};

module.exports = client;
