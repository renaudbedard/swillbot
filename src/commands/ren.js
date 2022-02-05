/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");
const modelId = "ada:ft-personal-2022-02-05-20-24-59";
const { Configuration, OpenAIApi } = require("openai");

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
    max_tokens: 1024,
    stop: [" END"]
  });

  console.log(JSON.stringify(response));

  let generatedText = response.choices[0].text;
  let textParts = generatedText.split(" ### ");

  let rating = parseFloat(textParts[0]);
  const ratingString = util.getRatingString(rating);

  attachment.text += `${ratingString}`;
  attachment.text += `\n${textParts[1]}`;

  attachment.text += `\n\t- _Renobot_`;

  return attachment;
}

module.exports = { name: "ren", getFakeReviewAttachment: getFakeReviewAttachment };
