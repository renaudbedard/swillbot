/* global require */
/* global Promise */
/* global module */
"use strict";

const util = require("../util");

/**
 * @param {string} userInfo The user to get checkins from
 * @param {number} beerId The beer ID to look for
 * @param {string} beerName The beer name
 * @param {number=} parentId The beer ID of the parent, if this is a vintage beer
 * @param {integer[]} vintageIds The beer IDs of the child vintages, if any
 * @return {object} The Untappd checkin
 */
async function findTick(userInfo, beerId, beerName, parentId, vintageIds) {
    console.log(`userInfo.name = ${userInfo.name}, beerId = ${beerId}`);

    // create table if needed
    await util.tryPgQuery(
        null,
        `create table if not exists user_reviews (
            username text not null,
        beer_id integer not null,
        beer_name text,
            recent_checkin_id integer,
            recent_checkin_timestamp date,
            count integer,
        rating real,
        rank integer,
            primary key (username, beer_id));`,
        null,
        "Create user reviews table"
    );

    // look in cache first
    const result = await util.tryPgQuery(
        null,
        `select rank
      from user_reviews 
      where username = $1 and beer_id = $2`,
        [userInfo.name, beerId],
        `Find beer reviews for user ${userInfo.name} and beer ID ${beerId}`
    );

    let reviewInfo;

    if (result.rows.length == 1) {
        // force-recache the batch around that review's rank
        console.log(`[${userInfo.name}] found the beer check-in at ${result.rows[0].rank}; will force-recache`);
        reviewInfo = await util.findAndCacheUserBeers(userInfo, beerId, result.rows[0].rank);
    } else {
        console.log(`[${userInfo.name}] could not find the beer check-in; will fetch`);
        reviewInfo = await util.findAndCacheUserBeers(userInfo, beerId);
    }

    // vintages/variants
    if (reviewInfo == null && (parentId != null || vintageIds.length > 0)) {
        console.log(`[${userInfo.name}] trying to match parentId ${parentId} or vintage IDs [${vintageIds}]...`);
        const parentResult = await util.tryPgQuery(
            null,
            `select beer_id, beer_name, rank
        from user_reviews 
        where username = $1 and (beer_id = $2 or beer_id = any ($3))`,
            [userInfo.name, parentId || -1, vintageIds],
            `Looking for vintages`
        );

        if (parentResult.rows.length > 0) {
            console.log(`[${userInfo.name}] matched '${beerName}' as '${parentResult.rows[0].beer_name}' (rank ${parentResult.rows[0].rank})`);
            reviewInfo = await util.findAndCacheUserBeers(userInfo, parentResult.rows[0].beer_id, parentResult.rows[0].rank);
        }
    }

    // last resort : string matching
    if (reviewInfo == null) {
        console.log(`[${userInfo.name}] trying to string match beer '${beerName}'...`);
        const fuzzyResult = await util.tryPgQuery(
            null,
            `select username, beer_id, beer_name, recent_checkin_id, recent_checkin_timestamp, count, rating, rank
        from user_reviews 
        where username = $1 and beer_name ilike $2`,
            [userInfo.name, `%${beerName}%`],
            `Looking for beer by name`
        );

        if (fuzzyResult.rows.length > 0) {
            console.log(`[${userInfo.name}] matched '${beerName}' as '${fuzzyResult.rows[0].beer_name}'`);
            reviewInfo = await util.findAndCacheUserBeers(userInfo, fuzzyResult.rows[0].beer_id, fuzzyResult.rows[0].rank);
        }
        if (reviewInfo == null) {
            console.log(`[${userInfo.name}] not found! we tried...`);
        }
    }

    return reviewInfo;
}

/**
 * @param {string} source The user ID that made the request
 * @param {string} query The original request
 * @param {object[]} tickInfos Tick infos (beer and review)
 * @return {string} The rich slack message
 */
function formatTickInfosSlackMessage(source, query, tickInfos) {
    // See https://api.slack.com/docs/message-formatting
    let slackMessage = {
        response_type: "in_channel",
        attachments: []
    };

    // add in-error attachments first
    for (let tickInfo of tickInfos) {
        if (tickInfo.inError) {
            let attachment = {
                color: "#ff0000",
                text: `*Couldn't find matching beer for :* \`${tickInfo.query}\` (_${tickInfo.message}_)`
            };
            slackMessage.attachments.push(attachment);
        }
    }

    // filter 'em out
    tickInfos = tickInfos.filter(x => !x.inError);

    // order by score, descending
    tickInfos.sort((a, b) => b.beerInfo.rating_score - a.beerInfo.rating_score);

    for (let tickInfo of tickInfos) {
        const beerInfo = tickInfo.beerInfo;

        let ratingString = `${util.getRatingString(beerInfo.rating_score)} (*${beerInfo.weighted_rating_score.toFixed(2)}* weighted) (${beerInfo.rating_count} ratings)`;
        let ibuFragment = beerInfo.beer_ibu ? ` — ${beerInfo.beer_ibu} IBU` : "";
        let attachment = {
            color: "#ffcc00",
            title_link: `https://untappd.com/b/${beerInfo.beer_slug}/${beerInfo.bid}`,
            thumb_url: beerInfo.beer_label,
            text: `${ratingString}`
        };
        if (tickInfos.length > 1) {
            attachment.text = `:mag: \`${beerInfo.query}\`\n${attachment.text}`;
        }
        if (beerInfo.brewery) attachment.title = `${beerInfo.brewery.brewery_name} – ${beerInfo.beer_name}`;
        else attachment.title = `${beerInfo.beer_name}`;

        if (tickInfo.reviewInfo) {
            attachment.title = `:ballot_box_with_check: ${attachment.title}`;
            attachment.text += '\n';
            attachment.color = "#00ff00";

            const reviewInfo = tickInfo.reviewInfo;
            ratingString = util.getRatingString(reviewInfo.rating);

            if (reviewInfo.beer_id != beerInfo.bid) {
                attachment.text += `_Vintage or variant : *${reviewInfo.beer_name}*_\n`;
            }

            const date = reviewInfo.recent_checkin_timestamp;
            const dateString = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;

            attachment.text += `:pencil: ${ratingString} (${reviewInfo.count} check-in${reviewInfo.count > 1 ? "s" : ""} - latest on ${dateString})`;
        } else {
            attachment.title = `:x: ${attachment.title}`;
            attachment.color = "#fc7f03";
        }

        attachment.text += `\n_${beerInfo.beer_style} — ${beerInfo.beer_abv}% ABV${ibuFragment}_`;
        if (beerInfo.beer_description) attachment.text += `\n${beerInfo.beer_description}`;        

        slackMessage.attachments.push(attachment);
    }

    if (slackMessage.attachments.length > 0) slackMessage.attachments[0].pretext = `<@${source}>: \`\`\`/tick ${query}\`\`\``;

    return slackMessage;
}

const handler = async function (payload, res) {
    try {
        res.status(200).json(util.formatReceipt());

        let slackUser = payload.user_id;

        // strip newlines and replace with spaces
        let query = payload.text.replace(/[\n\r]/g, " ");
        if (query.indexOf("@") > -1) {
            slackUser = query.slice(query.indexOf("@") + 1, query.indexOf("|"));
            query = query.slice(query.indexOf(" ")).trim();
        }

        const beerQueries = util.getQueries(query);

        const untappdUser = await util.getUntappdUser(slackUser);

        const tickInfos = await Promise.all(beerQueries.map(async beerQuery => {
            try {
                const beerId = await util.searchForBeerId(beerQuery);
                const beerInfo = await util.getBeerInfo(beerId.id, beerQuery);
                let vintageIds = [];
                let parentId = null;

                const parent = beerInfo.variant_parent || beerInfo.vintage_parent;
                if (parent && parent.beer) parentId = parent.beer.bid;

                if (beerInfo.vintages) vintageIds = beerInfo.vintages.items.map(x => x.beer.bid);

                const beerName = `${beerInfo.brewery.brewery_name} - ${beerInfo.beer_name}`;

                return { beerInfo: beerInfo, reviewInfo: await findTick(untappdUser, beerId.id, beerName, parentId, vintageIds) };
            } catch (error) {
                return { inError: true, query: error.exactQuery, message: error.message };
            }
        })).catch(util.onErrorRethrow);

        const message = formatTickInfosSlackMessage(payload.user_id, query, tickInfos);
        util.sendDelayedResponse(message, payload.response_url);
    } catch (err) {
        util.sendDelayedResponse(util.formatError(err), payload.response_url);
    }
};

module.exports = { handler: handler, name: "tick" };
