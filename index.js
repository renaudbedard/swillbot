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
		let ratingString = getRatingString(beerInfo.rating_score);

		let attachment = {
			color: '#ffcc00',
			title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
			thumb_url: beerInfo.beer_label,
			text: `${ratingString} (${beerInfo.rating_count} ratings)\n_${beerInfo.beer_style} — ${beerInfo.beer_abv}% ABV — ${beerInfo.beer_ibu || 0} IBU_`
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
 * @param {string} userId The Slack user ID
 * @param {string} untappdUser The Untappd user name
 * @param {object} reviewInfo Untappd review info
 * @param {object} beerInfo Untappd beer info
 * @return {string} The rich slack message
 */
function formatReviewSlackMessage(userId, untappdUser, reviewInfo, beerInfo) {
	// See https://api.slack.com/docs/message-formatting
	let slackMessage = {
		response_type: 'in_channel',
		attachments: []
	};

	const ratingString = getRatingString(reviewInfo.rating);

	let attachment = {
		color: '#ffcc00',
		title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
		thumb_url: beerInfo.beer_label,
		text: `${ratingString} (${reviewInfo.count} check-in${reviewInfo.count > 1 ? 's' : ''})`
	};
	if (beerInfo.brewery)
		attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
	else
		attachment.title = `${beerInfo.beer_name}`;

	attachment.text += `\n${reviewInfo.checkinComment}`;

	const date = reviewInfo.recentCheckinTimestamp;
	const dateString = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}`;
	attachment.text += `\n\t- <@${userId}>, <https://untappd.com/user/${untappdUser}/checkin/${reviewInfo.recentCheckinId}|${dateString}>`;

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
async function findReview(userName, beerId) {
	//console.log(`userName = ${userName}, beerId = ${beerId}`);

	// look in cache first
	const query = datastore.createQuery('BeerId')
		.filter('__key__', '=', datastore.key(['User', userName, 'BeerId', beerId]));

	const results = await datastore.runQuery(query);
	const entities = results[0];

	let reviewInfo;
	if (entities.length > 0)
		reviewInfo = entities[0];
	else {
		// if there are no results, fill cache
		console.log(`couldn't find beer id ${beerId} for username ${userName}, will cache user beers`);
		reviewInfo = await findAndCacheUserBeers(userName, beerId);
	}

	// separate request for the check-in comment
	reviewInfo.checkinComment = await getCheckinComment(reviewInfo.recentCheckinId);

	return reviewInfo;
}

/**
 * @param {string} userName The user to get unique beers from
 * @param {int} beerId The beer ID to stop at
 * @return {Promise<object>} The review entity
 */
async function findAndCacheUserBeers(userName, beerId) {
	const limit = 50;
	let batchCount = 0;
	let totalCount = 50;
	let beerData = null;
	let entitiesToUpsert = [];

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
							recentCheckinId: item.recent_checkin_id,
							recentCheckinTimestamp: new Date(item.recent_created_at),
							count: item.count,
							rating: item.rating_score
						}
					};
					entitiesToUpsert.push(entity);

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

		if (entitiesToUpsert.length >= 450) {
			await datastore.upsert(entitiesToUpsert);
			console.log(`upserted ${entitiesToUpsert.length} entities`);
			entitiesToUpsert = [];
		}

		if (beerData != null)
			break;
	}

	if (entitiesToUpsert.length > 0) {
		await datastore.upsert(entitiesToUpsert);
		console.log(`upserted ${entitiesToUpsert.length} entities`);
	}

	return beerData;
}

/**
 * @param {int} checkinId The ID of the check-in
 * @return {string} The check-in comment for that ID
 */
function getCheckinComment(checkinId) {
	return new Promise((resolve, reject) => {
		let args = {
			path: {
				checkinId: checkinId
			},
			parameters: {
				client_id: config.UNTAPPD_CLIENT_ID,
				client_secret: config.UNTAPPD_CLIENT_SECRET
			},
		};

		let req = client.get('https://api.untappd.com/v4/checkin/view/${checkinId}', args, function(data, _) {
			//console.log(`beer info : ${data.response.beer}`);
			resolve(data.response.checkin.checkin_comment);
		});

		req.on('error', function(err) {
			reject(err);
		});
	});
}

/**
 * @param {string} slackUserId The Slack user's ID
 * @return {Promise<string>} The Untappd user name
 */
async function getUntappdUser(slackUserId) {
	const datastoreQuery = datastore.createQuery('SlackUser')
				.filter('__key__', '=', datastore.key(['SlackUser', slackUserId]))
				.limit(1);

	const queryResult = await datastore.runQuery(datastoreQuery);
	//console.log(queryResult);
	return queryResult[0][0].untappdUser;
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
 * Usage : [user]
 * @param {object} req Cloud Function request object.
 * @param {object} res Cloud Function response object.
 * @return {Promise} a Promise for the current request
 */
exports.username = (req, res) => {
	const slackUser = req.body.user_id;
	const untappdUser = req.body.text.trim();

	return Promise.resolve()
		.then(() => {
			if (req.method !== 'POST') {
				const error = new Error('Only POST requests are accepted');
				error.code = 405;
				throw error;
			}

			// Verify that this request came from Slack
			verifyWebhook(req.body);

			datastore.upsert({
				key: datastore.key(['SlackUser', slackUser]),
				data: {
					untappdUser: untappdUser
				}
			});

			let slackMessage = {
				response_type: 'in_channel',
				attachments: [
					{
						title: 'User registered!',
						color: '#ffcc00',
						text: `Slack user <@${slackUser}> will be known as Untappd user \`${untappdUser}\``
					}
				]
			};

			res.json(slackMessage);
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
	return Promise.resolve()
		.then(async function() {
			if (req.method !== 'POST') {
				const error = new Error('Only POST requests are accepted');
				error.code = 405;
				throw error;
			}

			verifyWebhook(req.body);

			let query;
			let userId;

			const portions = req.body.text.split(',');
			if (portions.length == 1) {
				userId = req.body.user_id;
				query = portions[0].trim();
			} else {
				userId = portions[0].trim();
				userId = userId.slice(userId.indexOf('@') + 1, userId.indexOf('|'));
				query = portions[1].trim();
			}

			//console.log(`userId = ${userId}, query = ${query}`);

			const [untappdUser, beerId] = await Promise.all([getUntappdUser(userId), searchForBeerId(query)]);
			const [reviewInfo, beerInfo] = await Promise.all([findReview(untappdUser, beerId), getBeerInfo(beerId)]);
			const response = await formatReviewSlackMessage(userId, untappdUser, reviewInfo, beerInfo);

			res.json(response);
		})
		.catch(err => {
			console.error(err);
			res.status(err.code || 500).send(err);
			return Promise.reject(err);
		});
};
