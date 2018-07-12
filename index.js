'use strict';

const config = require('./config.json');

let Client = require('node-rest-client').Client;
let client = new Client();

/**
 * @param {object} beerInfo Untappd's beer info
 * @return {string} The rich slack message
 */
function formatSlackMessage(beerInfo) {
	// See https://api.slack.com/docs/message-formatting
	let slackMessage = {
		response_type: 'in_channel',
		attachments: []
	};

	if (beerInfo) {
		let ratingString = '';
		for (let i = 0; i < Math.floor(beerInfo.rating_score); i++)
			ratingString = ratingString + ':beer:';
		ratingString += ` *${beerInfo.rating_score}* (${beerInfo.rating_count} ratings)`;

		let attachment = {
			color: '#ffcc00',
			title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
			thumb_url: beerInfo.beer_label,
			text: `${ratingString}\n_${beerInfo.beer_style} — ${beerInfo.beer_abv}% ABV — ${beerInfo.beer_ibu || 0} IBU_`
		};
		if (beerInfo.brewery)
			attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
		else
			attachment.title = `${beerInfo.beer_name}`;
		if (beerInfo.beer_description)
			attachment.text += `\n${beerInfo.beer_description}`;

		slackMessage.attachments.push(attachment);
	} else {
		slackMessage.attachments.push({
			text: 'No results match your query...'
		});
	}

	return slackMessage;
}

/**
 * @param {object} body The HTTP request body
 * @throws If the request is not coming from Slack
 */
function verifyWebhook(body) {
	if (!body || body.token !== config.SLACK_TOKEN) {
		const error = new Error('Invalid credentials');
		error.code = 401;
		throw error;
	}
}

/**
 * @param {string} query The beer search query string
 * @return {int} The first found beer ID
 */
function searchForBeerId(query) {
	return new Promise((resolve, reject) => {
		let args = {
			parameters: {
				q: query,
				limit: 1,
				client_id: config.UNTAPPD_CLIENT_ID,
				client_secret: config.UNTAPPD_CLIENT_SECRET
			},
		};

		let req = client.get('https://api.untappd.com/v4/search/beer', args, function(data, _) {
			let firstResult = data.response.beers.count > 0 ? data.response.beers.items[0] :
							data.response.homebrew.count > 0 ? data.response.homebrew.items[0] :
							null;
			if (firstResult)
				resolve(firstResult.beer.bid);
			else
				reject('Couldn\'t find matching beer!');
		});

		req.on('error', function(err) {
			reject(err);
		});
	});
}

/**
 * @param {int} beerId The beer ID to look for
 * @return {object} The Untapped data for this beer
 */
function getBeerInfo(beerId) {
	return new Promise((resolve, reject) => {
		let args = {
			path: {
				id: beerId
			},
			parameters: {
				compact: 'true',
				client_id: config.UNTAPPD_CLIENT_ID,
				client_secret: config.UNTAPPD_CLIENT_SECRET
			},
		};

		let req = client.get('https://api.untappd.com/v4/beer/info/${id}', args, function(data, _) {
			//console.log(data);
			resolve(data.response.beer);
		});

		req.on('error', function(err) {
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
 * @return {Promise} a Promise for the current request
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

		return searchForBeerId(req.body.text);
	})
	.then((beerId) => getBeerInfo(beerId))
	.then((beerInfo) => formatSlackMessage(beerInfo))
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
