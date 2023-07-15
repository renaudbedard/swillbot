/* global require */
/* global console */
"use strict";

const express = require("express");
const proxy = require("express-http-proxy");
const bodyParser = require("body-parser");
const config = require("./config");
const commands = require("./commands");
const path = require('path');

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

app.get("/media/joo_sacre", (req, res) => res.sendFile(path.resolve("media/joo_sacre.png")));
app.get("/media/joo_sacre2", (req, res) => res.sendFile(path.resolve("media/joo_sacre2.gif")));
app.get("/media/seb_sacre", (req, res) => res.sendFile(path.resolve("media/seb_sacre.gif")));
app.get("/media/seb_sacre2", (req, res) => res.sendFile(path.resolve("media/seb_sacre2.gif")));
app.get("/media/ren_sacre", (req, res) => res.sendFile(path.resolve("media/ren_sacre.png")));
app.get("/media/ren_sacre2", (req, res) => res.sendFile(path.resolve("media/ren_sacre2.gif")));
app.get("/media/mat_sacre", (req, res) => res.sendFile(path.resolve("media/mat_sacre.png")));
app.get("/media/mat_sacre2", (req, res) => res.sendFile(path.resolve("media/mat_sacre2.gif")));
app.get("/media/vip_sacre", (req, res) => res.sendFile(path.resolve("media/vip_sacre.png")));
app.get("/media/vip_sacre2", (req, res) => res.sendFile(path.resolve("media/vip_sacre2.gif")));

for (let command of commands) {
  app.post(`/commands/${command.name}`, (req, res) => {
    let payload = req.body;

    if (!payload || payload.token !== config.SLACK_TOKEN) {
      let err = "✋  An invalid slash token was provided\n" + "   Is your Slack slash token correctly configured?";
      console.log(err);
      res.status(401).end(err);
      return;
    }

    command.handler(payload, res, req);
  });
}

app.listen(config.PORT, err => {
  if (err) throw err;

  console.log(`\n🚀  Swillbot LIVES on PORT ${config.PORT} 🚀`);
});
