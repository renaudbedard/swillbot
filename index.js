'use strict';

const config = require('./config.json');

var Client = require('node-rest-client').Client;
var client = new Client();

/**
 * Format the Knowledge Graph API response into a richly formatted Slack message.
 *
 * @param {string} query The user's search query.
 * @param {object} response The response from the Untappd API.
 * @returns {object} The formatted message.
 */
function formatSlackMessage (query, response) {
	// Prepare a rich Slack message
	// See https://api.slack.com/docs/message-formatting
	const slackMessage = {
		response_type: 'in_channel',
		text: `Query: ${query}`,
		attachments: []
	};

	let beer = response.beer;

	if (beer) {
		const attachment = {
			color: '#ffcc00'
		};
		attachment.title = beer.beer_name;
		attachment.title_link = `https://untappd.com/b/${beer.beer_slug}/${beer.bid}`;
		attachment.text = beer.beer_description;
		attachment.image_url = beer.beer_label;
		slackMessage.attachments.push(attachment);
	} else {
		slackMessage.attachments.push({
			text: 'No results match your query...'
		});
	}

	return slackMessage;
}

/**
 * Verify that the webhook request came from Slack.
 *
 * @param {object} body The body of the request.
 * @param {string} body.token The Slack token to be verified.
 */
function verifyWebhook (body) {
	if (!body || body.token !== config.SLACK_TOKEN) {
		const error = new Error('Invalid credentials');
		error.code = 401;
		throw error;
	}
}

/**
 * Send the user's search query to the Untappd API.
 *
 * @param {string} query The user's search query.
 */
function makeSearchRequest (query) {
	return new Promise((resolve, reject) => {
		let args = {
			parameters: { name: query },
			//headers: { "test-header": "client-api" }
		};

		let req = client.get("https://api.untappd.com/v4/search/beer/{name}", args, function (data, _) {
			let firstResult = response.beers.items[0];
			let beerInfo = null;
			if (firstResult) {
				beerInfo = makeBeerInfoRequest(firstResult.beer.bid));
			}
			resolve(formatSlackMessage(query, beerInfo));
		});

		req.on('error', function (err) {
			reject(err);
		});
	});
}

function makeBeerInfoRequest (beerId) {
	return new Promise((resolve, reject) => {
		let args = {
			parameters: { id: beerId },
			//headers: { "test-header": "client-api" }
		};
	
		let req = client.get("https://api.untappd.com/v4/beer/info/{id}", args, function (data, _) {
			resolve(formatSlackMessage(query, data));
		});
	
		req.on('error', function (err) {
			reject(err);
		});
	  });
}

/**
 * Receive a Slash Command request from Slack.
 *
 * Trigger this function by making a POST request with a payload to:
 * https://[YOUR_REGION].[YOUR_PROJECT_ID].cloudfunctions.net/untappd
 *
 * @example
 * curl -X POST "https://us-central1.your-project-id.cloudfunctions.net/untappd" --data '{"token":"[YOUR_SLACK_TOKEN]","text":"Cantillon Fou'Foune 2017"}'
 *
 * @param {object} req Cloud Function request object.
 * @param {object} req.body The request payload.
 * @param {string} req.body.token Slack's verification token.
 * @param {string} req.body.text The user's search query.
 * @param {object} res Cloud Function response object.
 */
exports.untappd = (req, res) => {
  return Promise.resolve()
	.then(() => {
		if (req.method !== 'POST') {
			const error = new Error('Only POST requests are accepted');
			error.code = 405;
			throw error;
		}

		// Verify that this request came from Slack
		verifyWebhook(req.body);

		// Make the request to the Knowledge Graph Search API
		return makeSearchRequest(req.body.text);
	})
	.then((response) => {
		// Send the formatted message back to Slack
		res.json(response);
	})
	.catch((err) => {
		console.error(err);
		res.status(err.code || 500).send(err);
		return Promise.reject(err);
	});
};
