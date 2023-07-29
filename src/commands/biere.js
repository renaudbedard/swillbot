/* global require */
/* global Promise */
/* global module */
/* global console */
"use strict";

const util = require("../util");
const { Configuration, OpenAIApi } = require("openai");

async function tryOpenAiRequest(modelId, userId, breweryName, maxTokens, temperature) {
    let response = null;
    let attempts = 0;
    while (response === null && attempts < 3) {
      try {
        const configuration = new Configuration({
          apiKey: process.env.OPENAI_API_KEY
        });
        const openai = new OpenAIApi(configuration);
        response = await openai.createCompletionFromModel({
          model: modelId,
          prompt: `${breweryName} ->`,
          max_tokens: maxTokens,
          stop: ["\n"],
          temperature: temperature,
          user: userId
        });
      } catch (err) {
        response = null;
        attempts++;
        if (attempts == 3) {
          throw err;
        }
        console.log(`Failed with err : ${err}, retrying (attempt ${attempts})`);
      }
    }
  
    if (response.status != 200) {
      throw {
        source: `Generating ${userId} review`,
        message: `Error ${response.status}!\n${nodeUtil.inspect(response.data)}`
      };
    }
  
    const responseData = response.data;
  
    let generatedText = responseData.choices[0].text.trim();

    if (generatedText.indexOf("->") != -1) {
        generatedText = generatedText.split("->")[0];
    }

    return generatedText;
  }

async function formatSlackMessage(source, query, req) {

  let block = {
    "type": "section",
    "text": {
      "text": `<@${source}>: `,
      "type": "mrkdwn"
    }
  };

  const generatedBeer = await tryOpenAiRequest(
    "curie:ft-personal-2023-07-21-05-21-01",
    source,
    query,
    32,
    1.0);

  block.text.text += `:beer: ${query} - ${generatedBeer}`;

  return {
    response_type: "in_channel",
    blocks: [block]
  };
}

const handler = async function(payload, res, req) {
  let query = payload.text ? payload.text : "";

  try {
    res.status(200).json(util.formatReceipt());

    const slackMessage = await formatSlackMessage(payload.user_id, query, req);

    util.sendDelayedResponse(slackMessage, payload.response_url);
  } catch (err) {
    util.sendDelayedResponse(util.formatError(err), payload.response_url);
  }
};

module.exports = { handler: handler, name: "biere" };
