/* global require */
/* global module */
/* global console */
'use strict';

const util = require('../util');
const pg = require('../pg-client');

const handler = async function(payload, res) {
    const slackUser = payload.user_id;
	const untappdUser = payload.text.trim();

    try {
        // ensure table exists
        await pg.query(
            `create table if not exists user_mapping (
                slack_user_id integer primary key, 
                untappd_username varchar not null);`);
    } catch (err) {
        console.log(err.stack);
        res.set('content-type', 'application/json');
        res.status(200).json(util.formatError({source: 'create table', message: JSON.stringify(err)}));
        return;
    }

    try {
        // upsert user
        const upsertResult = await pg.query(
            `insert into user_mapping(slack_user_id, untappd_username) values ($1, $2)            
             on conflict (slack_user_id) do update set untappd_username = $2;`,
            [slackUser, untappdUser]);

        console.log(`upserted rows : ${upsertResult.rowCount}`);
    } catch (err) {
        console.log(err.stack);
        res.set('content-type', 'application/json');
        res.status(200).json(util.formatError({source: 'upsert', message: JSON.stringify(err)}));
        return;
    }

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

    res.set('content-type', 'application/json');
    res.status(200).json(slackMessage);
};

module.exports = { handler: handler, name: 'username' };
