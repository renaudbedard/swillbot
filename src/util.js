/* global module */
/* global console */
/* global require */
/* global Promise */
'use strict';

const config = require('./config');
const client = require('./rest-client');
const pg = require('./pg-client');
const _ = require('lodash');

const untappdParams = {
	client_id: config.UNTAPPD_CLIENT_ID,
	client_secret: config.UNTAPPD_CLIENT_SECRET
};

/**
 * @param {string} query The SQL query
 * @param {object[]} values Query values (optional)
 * @param {string} context What this query performs
 * @param {object} res The HTTP response object
 * @return {QueryResult} The query result
 */
async function pgSafeQuery(query, values, context, res) {
    try {
        // ensure table exists
        return await pg.query(query, values);
    } catch (err) {
        console.log(err.stack);
		res.set('content-type', 'application/json');
		err = {source: context, message: err.stack};
		res.status(200).json(formatError(err));
		throw err;
    }
}

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
 * @param {object} err The error details
 * @return {object} The Slack message
 */
function formatError(err) {
	let slackMessage = {
		response_type: 'ephemeral',
		text: `Oops! Something went wrong with your query '${err.source}'.`,
		attachments: [{
			color: '#ff0000',
			text: err.message
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
			parameters: _.defaults({
				q: query,
				limit: 1,
			}, untappdParams),
		};

		let req = client.get('https://api.untappd.com/v4/search/beer', args, function(data, _) {
			let firstResult = data.response.beers.count > 0 ? data.response.beers.items[0] :
							data.response.homebrew.count > 0 ? data.response.homebrew.items[0] :
							null;
			if (firstResult) {
				//console.log(`beer id : ${firstResult.beer.bid}`);
				resolve(firstResult.beer.bid);
			} else
				reject({ source: query, message: 'Couldn\'t find matching beer!' });
		});

		req.on('error', function(err) {
			reject({ source: query, message: err.toString() });
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
			parameters: _.defaults({
				compact: 'true'
			}, untappdParams)
		};

		let req = client.get('https://api.untappd.com/v4/beer/info/${id}', args, function(data, _) {
			//console.log(`beer info : ${data.response.beer}`);
			resolve(data.response.beer);
		});

		req.on('error', function(err) {
			reject({ source: beerId, message: err.toString() });
		});
	});
}

module.exports = {
    getRatingString: getRatingString,
    formatError: formatError,
    searchForBeerId: searchForBeerId,
	getBeerInfo: getBeerInfo,
	pgSafeQuery: pgSafeQuery
};
