/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");
//const modelId = "ada:ft-personal-2022-02-05-20-24-59";
const modelId = "curie:ft-personal-2022-02-06-00-56-29";
const { Configuration, OpenAIApi } = require("openai");
const nodeUtil = require("util");

async function getFakeReviewAttachment(beerInfo) {
  let attachment = {
    color: "#ffcc00",
    thumb_url: "https://ca.slack-edge.com/TBLMUG0RE-UBLMUG24Q-944d4643c7ed-512",
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
    max_tokens: 128,
    stop: [" END"]
  });

  if (response.status != 200) {
    throw {
      source: `Generating REN review`,
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

  attachment.text += `\n\t- _Renobot_`;

  return attachment;
}

module.exports = { name: "ren", getFakeReviewAttachment: getFakeReviewAttachment };
