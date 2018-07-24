/* global require */
/* global console */
/* global exports */
/* global Promise */
'use strict';

const config = require('./config.json');

const projectId = 'swill-untappd-slack-bot';

let Client = require('node-rest-client').Client;
let client = new Client();

const Datastore = require('@google-cloud/datastore');
const datastore = new Datastore({
	projectId: projectId,
});

/**
 * @param {object[]} beerInfos Untappd's beer info
 * @return {string} The rich slack message
 */
function formatBeerInfoSlackMessage(beerInfos) {
	// See https://api.slack.com/docs/message-formatting
	let slackMessage = {
		response_type: 'in_channel',
		attachments: []
	};

	for (let beerInfo of beerInfos) {
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
	}

	return slackMessage;
}

/**
 * @param {string} userName The user
 * @param {object} reviewInfo Untappd review info
 * @return {string} The rich slack message
 */
function formatReviewSlackMessage(userName, reviewInfo) {
	// See https://api.slack.com/docs/message-formatting
	let slackMessage = {
		response_type: 'in_channel',
		attachments: []
	};

	const beerInfo = reviewInfo.beerInfo;

	let ratingString = '';
	for (let i = 0; i < Math.floor(reviewInfo.rating); i++)
		ratingString = ratingString + ':beer:';
	ratingString += ` *${reviewInfo.rating}*`;

	let attachment = {
		color: '#ffcc00',
		title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
		thumb_url: beerInfo.beer_label,
		text: `${ratingString}`
	};
	if (beerInfo.brewery)
		attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
	else
		attachment.title = `${beerInfo.beer_name}`;

	// TODO: add review
	attachment.text += `\nThis is a placeholder review blah blah blah.`;
	attachment.text += `\n\t- ${userName}, 01/01/2018 10:10`;

	slackMessage.attachments.push(attachment);

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
	//console.log(`query : ${query}`);
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
				client_id: config.UNTAPPD_CLIENT_ID,
				client_secret: config.UNTAPPD_CLIENT_SECRET
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

/**
 * @param {string} userName The user to get checkins from
 * @param {int} beerId The beer ID to look for
 * @return {object[]} The Untappd checkins
 */
function findReview(userName, beerId) {
	console.log(`userName = ${userName}, beerId = ${beerId}`);
	return new Promise(resolve => {
		// look in cache first
		const query = datastore.createQuery('BeerId')
			.filter('__key__', '=', datastore.key(['User', userName, 'BeerId', beerId]));

		datastore.runQuery(query).then(results => {
			const entities = results[0];

			// TODO: what does the info thing contain? is it usable for error-handling?
			//const info = results[1];
			//console.log(info);

			resolve(entities);
		});
	}).then(entities => {
		if (entities.length > 0) {
			//entities.forEach(e => console.log(e));
			return entities[0];
		}

		// if there are no results, fill cache
		return findAndCacheUserBeers(userName);
	});
}

/**
 * @param {string} userName The user to get unique beers from
 * @param {int} beerId The beer ID to stop at
 * @return {object} The review entity
 */
async function findAndCacheUserBeers(userName, beerId) {
	const limit = 50;
	let batchCount = 0;
	let totalCount = 50;
	let beerData = null;

	// TODO: don't get all of them, start at last fetched check-in?
	// TODO: get the review text using https://untappd.com/api/docs#useractivityfeed

	for (let cursor = 0; cursor < totalCount; cursor += batchCount) {
		await new Promise(resolve => {
			const args = {
				path: {
					userName: userName
				},
				parameters: {
					limit: limit,
					offset: cursor,
					client_id: config.UNTAPPD_CLIENT_ID,
					client_secret: config.UNTAPPD_CLIENT_SECRET
				},
			};
			let req = client.get('https://api.untappd.com/v4/user/beers/${userName}', args, function(data, _) {
				totalCount = data.response.total_count;
				batchCount = data.response.beers.items.length;
				for (let item of data.response.beers.items) {
					const entity = {
						key: datastore.key(['User', userName, 'BeerId', item.beer.bid]),
						data: {
							firstCheckinId: item.first_checkin_id,
							recentCheckinId: item.recent_checkin_id,
							rating: item.rating_score
						}
					};
					datastore.upsert(entity).then(() => {
						console.log(`inserted entity for beerId = ${item.beer.bid}`);
					});

					if (item.beer.bid == beerId) {
						console.log(`found!`);
						beerData = entity.data;
						break;
					}
				}
				resolve();
			});
			req.on('error', function(err) {
				throw err; // TODO: or reject...?
			});
		});

		if (beerData !== null)
			return beerData;
	}
	return beerData;
}

/**
 * Usage : [query], [query], ...
 * @param {object} req Cloud Function request object.
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

			return Promise.all(req.body.text.split(',').map(x => searchForBeerId(x.trim())));
		})
		.then(beerIds => Promise.all(beerIds.map(x => getBeerInfo(x))))
		.then(beerInfos => formatBeerInfoSlackMessage(beerInfos))
		.then(response => {
			// Send the formatted message back to Slack
			res.json(response);
		})
		.catch(err => {
			console.error(err);
			res.status(err.code || 500).send(err);
			return Promise.reject(err);
		});
};

/**
 * Usage : [user], [query]
 * @param {object} req Cloud Function request object.
 * @param {object} res Cloud Function response object.
 * @return {Promise} a Promise for the current request
 */
exports.review = (req, res) => {
	let userName;
	let query;
	return Promise.resolve()
		.then(() => {
			if (req.method !== 'POST') {
				const error = new Error('Only POST requests are accepted');
				error.code = 405;
				throw error;
			}

			// Verify that this request came from Slack
			verifyWebhook(req.body);

			const portions = req.body.text.split(',');
			userName = portions[0];
			query = portions[1];

			return searchForBeerId(query);
		})
		.then(async function(beerId) {
			const reviewInfo = await findReview(userName, beerId);
			reviewInfo.beerId = beerId;
			return reviewInfo;
		})
		.then(async function(reviewInfo) {
			reviewInfo.beerInfo = await getBeerInfo(reviewInfo.beerId);
			return reviewInfo;
		})
		.then(reviewInfo => formatReviewSlackMessage(userName, reviewInfo))
		.then(response => {
			// Send the formatted message back to Slack
			res.json(response);
		})
		.catch(err => {
			console.error(err);
			res.status(err.code || 500).send(err);
			return Promise.reject(err);
		});
};
