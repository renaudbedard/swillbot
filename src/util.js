/* global module */
/* global require */
/* global Promise */
'use strict';

const config = require('./config');
const client = require('./rest-client');

/**
 * @param {float} rating The Untappd rating
 * @return {string} The emoji string
 */
function getRatingString(rating) {
	let ratingString = '';
	for (let i = 0; i < Math.floor(rating); i++)
		ratingString += ':fullbeer:';
	let fraction = rating - Math.floor(rating);
	if (fraction >= 0.75)
		ratingString += ':threequarterbeer:';
	else if (fraction >= 0.5)
		ratingString += ':halfbeer:';
	else if (fraction >= 0.25)
		ratingString += ':quarterbeer:';
	ratingString += ` *${rating}*`;
	return ratingString;
}

/**
 * Formats an error as a Slack message.
 * @param {string} query The query
 * @param {object} err The error details
 * @return {object} The Slack message
 */
function formatError(query, err) {
	let slackMessage = {
		response_type: 'ephemeral',
		text: `Oops! Something went wrong with your query '${query}'.`,
		attachments: [{
			color: '#ff0000',
			text: err.toString()
		}]
	};
	return slackMessage;
}

/**
 * @param {string} query The beer search query string
 * @return {int} The first found beer ID
 */
function searchForBeerId(query) {
	//console.log(`query : ${query}`);
	return new Promise((resolve, reject) => {
		let args = {
			parameters: {
				q: query,
				limit: 1,
				client_id: config('UNTAPPD_CLIENT_ID'),
				client_secret: config('UNTAPPD_CLIENT_SECRET')
			},
		};

		let req = client.get('https://api.untappd.com/v4/search/beer', args, function(data, _) {
			let firstResult = data.response.beers.count > 0 ? data.response.beers.items[0] :
							data.response.homebrew.count > 0 ? data.response.homebrew.items[0] :
							null;
			if (firstResult) {
				//console.log(`beer id : ${firstResult.beer.bid}`);
				resolve(firstResult.beer.bid);
			} else
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
				client_id: config('UNTAPPD_CLIENT_ID'),
				client_secret: config('UNTAPPD_CLIENT_SECRET')
			},
		};

		let req = client.get('https://api.untappd.com/v4/beer/info/${id}', args, function(data, _) {
			//console.log(`beer info : ${data.response.beer}`);
			resolve(data.response.beer);
		});

		req.on('error', function(err) {
			reject(err);
		});
	});
}

module.exports = {
    getRatingString: getRatingString,
    formatError: formatError,
    searchForBeerId: searchForBeerId,
    getBeerInfo: getBeerInfo
};
