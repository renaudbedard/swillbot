/* global require */
/* global console */
"use strict";

const express = require("express");
const proxy = require("express-http-proxy");
const bodyParser = require("body-parser");
const config = require("./config");
const commands = require("./commands");

let app = express();

if (config.PROXY_URI) {
  app.use(
    proxy(config.PROXY_URI, {
      forwardPath: (req, res) => require("url").parse(req.url).path
    })
  );
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("\n 👋 🌍 \n"));

for (let command of commands) {
  app.post(`/commands/${command.name}`, (req, res) => {
    let payload = req.body;

    if (!payload || payload.token !== config.SLACK_TOKEN) {
      let err = "✋  An invalid slash token was provided\n" + "   Is your Slack slash token correctly configured?";
      console.log(err);
      res.status(401).end(err);
      return;
    }

    command.handler(payload, res);
  });
}

app.listen(config.PORT, err => {
  if (err) throw err;

  console.log(`\n🚀  Swillbot LIVES on PORT ${config.PORT} 🚀`);
});
