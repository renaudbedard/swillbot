/* global require */
/* global module */
'use strict';

const util = require('../util');

const handler = async function(payload, res) {
    const slackUser = payload.user_id;
    const untappdUser = payload.text.trim();

    await util.pgSafeQuery(
        `create table if not exists user_mapping (
        slack_user_id varchar primary key, 
        untappd_username varchar not null);`,
        null, 'Create user mapping table', res);

    await util.pgSafeQuery(
        `insert into user_mapping(slack_user_id, untappd_username) values ($1, $2)            
        on conflict (slack_user_id) do update set untappd_username = $2;`,
        [slackUser, untappdUser], 'Add user mapping entry', res);

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
