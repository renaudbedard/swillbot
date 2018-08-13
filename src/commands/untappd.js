/* global require */
/* global Promise */
/* global module */
'use strict';

const util = require('../util');

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
		let ratingString = util.getRatingString(beerInfo.rating_score);

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

const handler = async function(payload, res) {
    const beerIds = await Promise.all(payload.text.split(',').map(x => util.searchForBeerId(x.trim())));
    const beerInfos = await Promise.all(beerIds.map(x => util.getBeerInfo(x)));
    const message = formatBeerInfoSlackMessage(beerInfos);

    res.set('content-type', 'application/json');
    res.status(200).json(message);
    return;
};

module.exports = { handler: handler, name: 'untappd' };
