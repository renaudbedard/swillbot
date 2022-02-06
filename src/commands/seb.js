/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

const modelId = "curie:ft-personal-2022-02-06-05-07-59";
const { Configuration, OpenAIApi } = require("openai");
const nodeUtil = require("util");

async function getFakeReviewAttachment(beerInfo) {
  let attachment = {
    color: "#ffcc00",
    thumb_url: "https://ca.slack-edge.com/TBLMUG0RE-UBM63GB2Q-c63d2136d247-512",
    text: ""
  };

  if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
  else attachment.title = `${beerInfo.beer_name}`;

  var shortStyle = beerInfo.beer_style.split(" -")[0];

  const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
  });
  const openai = new OpenAIApi(configuration);
  const response = await openai.createCompletionFromModel({
    model: modelId,
    prompt: `${shortStyle} ->`,
    max_tokens: 96,
    stop: [" END"],
    temperature: 0.9
  });

  if (response.status != 200) {
    throw {
      source: `Generating SEB review`,
      message: `Error ${response.status}!\n${nodeUtil.inspect(response.data)}`
    };
  }

  const responseData = response.data;

  let generatedText = responseData.choices[0].text;

  let textParts = generatedText.split(" ### ");

  let rating = parseFloat(textParts[0]);
  const ratingString = util.getRatingString(rating);

  attachment.text += `${ratingString}`;
  attachment.text += `\n${textParts[1]}`;

  attachment.text += `\n\t- _Sebbot_`;

  return attachment;
}

module.exports = { name: "seb", getFakeReviewAttachment: getFakeReviewAttachment };
