/* global require */
/* global Promise */
/* global module */
/* global console */
'use strict';

const util = require('../util');
const restClient = require('../rest-client');
const _ = require('lodash');
const pgPool = require('../pg-pool');

/**
 * @param {string} slackUserId The Slack user's ID
 * @return {Promise<string>} The Untappd user name
 */
async function getUntappdUser(slackUserId) {
    return await util.tryPgQuery(
        `select untappd_username from user_mapping
        where slack_user_id = $1`,
        [slackUserId], `Find Untappd username from Slack ID '${slackUserId}'`).rows[0].untappd_username;
}

/**
 * @param {string} userName The user to get checkins from
 * @param {int} beerId The beer ID to look for
 * @return {object[]} The Untappd checkins
 */
async function findReview(userName, beerId) {
    //console.log(`userName = ${userName}, beerId = ${beerId}`);

	// look in cache first
    const result = await util.tryPgQuery(
        `select * from user_reviews
        where username = $1 and beer_id = $2`,
        [userName, beerId], `Find beer reviews for user ${userName} and beer ID ${beerId}`);

    let reviewInfo;
	if (result.rows.length == 1)
		reviewInfo = reviewInfo.rows[0];
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
	const pgClient = await pgPool.connect();

	let beerData = null;

	// make sure the table exists
	try {
		await util.tryPgQuery(pgClient,
			`create table if not exists user_reviews (
			username integer not null,
			beer_id integer not null,
			recent_checkin_id integer,
			recent_checkin_timestamp date,
			count integer,
			rating real,
			primary key (username, beer_id));`,
			null, 'Create user reviews table');

		const limit = 50;
		let batchCount = 0;
		let totalCount = 50;

		const args = {
			path: { userName: userName },
			parameters: _.defaults({ limit: limit }, util.untappdParams)
		};
		for (let cursor = 0; cursor < totalCount; cursor += batchCount) {
			args.offset = cursor;

			pgClient.query('BEGIN;');

			// TODO: error handling?
			const res = await restClient.getPromise('https://api.untappd.com/v4/user/beers/${userName}', args);

			totalCount = res.data.response.total_count;
			batchCount = res.data.response.beers.items.length;
			for (let item of res.data.response.beers.items) {
				await util.tryPgQuery(pgClient,
					`insert into user_reviews (
					username, beer_id, recent_checkin_id, recent_checkin_timestamp, count, rating) 
					values ($1, $2, $3, $4, $5, $6)
					on conflict (slack_user_id) do update set 
					recent_checkin_id = $3, recent_checkin_timestamp = $4, count = $5, rating = $6;`,
					[
						userName, item.beer.bid, item.recent_checkin_id,
						new Date(item.recent_created_at), item.count, item.rating_score
					],
					`Add user review for user ${userName} and beer ID ${item.beer.bid}`);

				if (item.beer.bid == beerId) {
					console.log(`found!`);
					// mock a database result (faster than selecting it back)
					beerData = {
						username: userName,
						beer_id: item.beer.bid,
						recent_checkin_id: item.recent_checkin_id,
						recent_checkin_timestamp: new Date(item.recent_created_at),
						count: item.count,
						rating: item.rating_score
					};
					break;
				}
			}
			if (beerData != null)
				break;
		}

		pgClient.query('COMMIT;');
	} catch (err) {
		pgClient.query('ROLLBACK;');
		throw err;
	} finally {
		pgClient.release();
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
			path: { checkinId: checkinId },
			parameters: util.untappdParams
		};
		let req = restClient.get('https://api.untappd.com/v4/checkin/view/${checkinId}', args, function(data, _) {
			resolve(data.response.checkin.checkin_comment);
		});
		req.on('error', function(err) {
			reject({ source: `Get check-in comment for #${checkinId}`, message: err.toString() });
		});
	});
}

/**
 * @param {string} slackUserId The Slack user ID
 * @param {string} untappdUser The Untappd user name
 * @param {object} reviewInfo Untappd review info
 * @param {object} beerInfo Untappd beer info
 * @return {object} The rich slack message
 */
function formatReviewSlackMessage(slackUserId, untappdUser, reviewInfo, beerInfo) {
	// See https://api.slack.com/docs/message-formatting
	let slackMessage = {
		response_type: 'in_channel',
		attachments: []
	};

	const ratingString = util.getRatingString(reviewInfo.rating);

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
	attachment.text += `\n\t- <@${slackUserId}>, <https://untappd.com/user/${untappdUser}/checkin/${reviewInfo.recentCheckinId}|${dateString}>`;

	slackMessage.attachments.push(attachment);

	return slackMessage;
}

const handler = async function(payload, res) {
    const slackUser = payload.user_id;
    let query = payload.text;

    if (payload.text.indexOf('@') > 0) {
        slackUser = payload.text.slice(payload.text.indexOf('@') + 1, payload.text.indexOf('|'));
        query = payload.text.slice(payload.text.indexOf(' '));
    }

    try {
		const onErrorRethrow = err => {
			throw err;
		};

        const beerId = await util.searchForBeerId(query);

        const [beerInfo, [untappdUser, reviewInfo]] = Promise.all([
            util.getBeerInfo(beerId),
            async function() {
                const u = await getUntappdUser(slackUser);
                const ri = await findReview(u, beerId);
                return [u, ri];
            }]
        ).catch(onErrorRethrow);

        const slackMessage = formatReviewSlackMessage(slackUser, untappdUser, reviewInfo, beerInfo);

        res.set('content-type', 'application/json');
        res.status(200).json(slackMessage);
    } catch (err) {
		res.set('content-type', 'application/json');
        res.status(200).json(util.formatError(err));
    }
};

module.exports = { handler: handler, name: 'review' };