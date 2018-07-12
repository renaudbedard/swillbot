# SwillBot
A slack bot for light Untappd integration, written with [Google Cloud Functions](https://cloud.google.com/functions/).

## Features
### /untappd
![Single query](https://i.imgur.com/NtqHF5W.png)
Performs a beer search for the given query, grabs the top result and prints out a post with link to the beer page with some inline metadata.

You can also search for multiple beers in one request by separating your queries with commas :
![Multi-query](https://i.imgur.com/NQpS3Bd.png)

## Instructions
I built this while referring heavily to the [Google Cloud Slack integration example project](https://cloud.google.com/functions/docs/tutorials/slack), so look that up first.

This is not meant for public distribution just yet, but here's a quick guide :
- Get an [Untappd API key](https://untappd.com/api/dashboard)
- Create a Google Cloud Platform project and enable Functions on it
- Create a Slack app with a matching [slash command](https://api.slack.com/slash-commands#creating_commands) for `/untappd`
- Replace `config.default.json` with your credentials
- Install the Google Cloud SDK
- Upload using the `gcloud` tool
- Enjoy!