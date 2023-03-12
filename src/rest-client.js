/* global module */
/* global require */
"use strict";

const Client = require("node-rest-client-promise").Client;
const client = new Client();

client.rateLimitGet = (url, args, callback) => 
{
    return client.get(url, args, function(data, _) {
        if (data.toString("utf8").includes("error code: 1015")) {
            console.log("Got rate limited, will retry in 1 second...");
            setTimeout(() => {
                client.rateLimitGet(url, args, callback);
            }, 1000);
        } else {
            callback(data, _);
        }
    });
};

module.exports = client;
