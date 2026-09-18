# Borodutch stats code

## Shadow reach counter

`yarn collect-stats-shadow` calculates the headline reach without changing
`usercount/usercount.txt` or the running API. It counts unique private chat IDs
locally and checks only groups/channels through Telegram. Voicy transcription
history and Randy raffle/edit/admin history are merged with their current `chats`
collections so recoverable IDs lost by earlier database wipes are included.

Set `STATS_CHECKPOINT_DIR` and `STATS_SHADOW_RESULT_PATH` to persistent paths.
The result is written atomically. Any required source or transient Telegram
failure makes the command fail instead of publishing a partial total.

## Installation and local launch

1. Clone this repo: `git clone https://github.com/backmeupplz/borodutch-stats`
2. Launch the [mongo database](https://www.mongodb.com/) locally
3. Create `.env` with the environment variables listed below
4. Run `yarn install` in the root folder
5. Run `yarn develop`

## Environment variables

| Name                | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `CLOUDFLARE`        | Cloudflare API key                                                          |
| `PORT`              | Optional HTTP port supplied by the deployment platform; defaults to `1339`  |
| `STRIPE_SECRET_KEY` | Optional Stripe secret key for `/arr`; omit locally to return empty ARR data |

## Public endpoints

- `/stats` keeps returning the full historical payload for backwards compatibility.
- `/summary` returns the same object with array histories removed for fast initial page loads.
- `/stats/:project` returns detailed stats for one project code, with `randy` mapped to `randym` and `speller` mapped to `checkMyTextBot`.
- `/count` keeps returning the homepage user count and history.
- `/arr` returns 12 monthly points with `monthlyRecurringRevenue` and `annualRecurringRevenue`. It includes paid Stripe invoices with subscription-backed recurring line items and excludes one-time invoice items, usage without recurring price metadata, unpaid invoices, taxes, refunds, disputes, and non-Stripe revenue. Without Stripe config it returns zeroed chart data with `configured: false`.

Also, please, consider looking at `.env.sample`.

## Continuous integration

Any commit pushed to master gets deployed to stats.borodutch.com via [CI Ninja](https://github.com/backmeupplz/ci-ninja).

## License

MIT — use for any purpose. Would be great if you could leave a note about the original developers. Thanks!
