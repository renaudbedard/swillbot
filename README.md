# SwillBot
A slack bot for light Untappd integration, written using [Node.js](https://nodejs.org/en/), [Express](https://expressjs.com/) and deployed on [Heroku](https://dashboard.heroku.com/).

## Features
Note: Most queries use a delayed response callback, so the immediate response will be a `Working...` message that is only shown to the calling user. This avoids the [3 second timeout](https://api.slack.com/slash-commands#responding_basic_receipt) on Slack slash command response.

### /untappd
Note: The bot uses [the following custom emojis](https://imgur.com/a/5acJQHv) for more detail and visual uniformity : `:fullbeer:`, `:threequarterbeer:`, `:halfbeer:` and `:quarterbeer:`.

#### Simple query
<img alt="Simple query" src="https://i.imgur.com/y5eo2NO.png" width="640">
Performs a beer search for the given query, grabs the top result and prints out a post with link to the beer page with some inline metadata.

#### Multiple query
<img alt="Multi-query" src="https://i.imgur.com/aI8gGhp.png" width="640">
You can also search for multiple beers in one request by separating your queries with commas.

### /username
<img alt="Username" src="https://i.imgur.com/oBq0BPV.png" width="640">
Registers a Slack user's Untappd username so that `/review` can be used.

### /review
#### Own review
<img alt="Own review" src="https://i.imgur.com/l5fkgQU.png" width="640">
Fetches the latest Untappd check-in for the calling user for the requested beer, as well as its aggregate score over all check-ins.

#### Other user's review
<img alt="Other review" src="https://i.imgur.com/AdlgCUs.png" width="640">
Fetches the latest Untappd check-in for _another_ registered user for the requested beer, as well as its aggregate score over all check-ins.

#### Everyone's review
<img alt="All reviews" src="https://i.imgur.com/Hy7GfX2.png" width="640">
Fetches the latest Untappd check-in for _all_ registered users for the requested beer, beer as well as its aggregate score over all check-ins.

#### Variants or vintages
<img alt="Variants and vintages" src="https://i.imgur.com/Z3InjAi.png" width="640">
If the queried beer wasn't checked in by a user, its variants and vintages will be tested for check-ins.

## Installation procedure
Not meant for public consumption just yet! I'll write a guide once it is.