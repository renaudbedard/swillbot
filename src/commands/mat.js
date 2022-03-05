/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");

const modelId = "curie:ft-personal-2022-03-05-04-53-34";
const { Configuration, OpenAIApi } = require("openai");
const nodeUtil = require("util");

async function getFakeReviewAttachment(beerInfo, userId) {
  let attachment = {
    color: "#ffcc00",
    thumb_url: "https://ca.slack-edge.com/TBLMUG0RE-UBNESFXUP-9901982aefe7-512",
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
    max_tokens: 112,
    stop: [" END"],
    temperature: 1.0,
    user: userId
  });

  if (response.status != 200) {
    throw {
      source: `Generating MAT review`,
      message: `Error ${response.status}!\n${nodeUtil.inspect(response.data)}`
    };
  }

  const responseData = response.data;

  let generatedText = responseData.choices[0].text;

  let textParts = generatedText.split(" ### ");

  let rating = 4.0;
  if (parseFloat(textParts[0]) != NaN) {
    rating = parseFloat(textParts[0]);
  }
  const ratingString = util.getRatingString(rating);

  attachment.text += `${ratingString}`;
  attachment.text += `\n${textParts[1]}`;

  attachment.text += `\n\t- _Matbot_`;

  return attachment;
}

module.exports = { name: "mat", getFakeReviewAttachment: getFakeReviewAttachment };
