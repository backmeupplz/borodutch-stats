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

## Published reach snapshot

The API reads a validated snapshot from `STATS_PUBLISHED_RESULT_PATH` (default:
`usercount/latest.json`) before serving `/stats`, `/summary`, `/count`, or
`/reachability`. Updates are detected without restarting the server. A snapshot
is accepted only when it is explicitly marked as published, contains every
required project and bot result, and its total exactly matches its components.
Invalid or partial files leave the last known good values in memory.

`yarn collect-stats-daily` (also available as `yarn collect-stats`) starts from
the validated last-published snapshot, carries forward the expensive historical
bot scans, and refreshes Shieldy, Golden Borodutch, Todorant, Temply, and Jev in
one lightweight run. Jev's PostgreSQL totals and every current Telegram
community are refreshed before the complete snapshot is validated and
atomically replaced. Any source, database, or Telegram failure leaves the
published snapshot untouched. The command is also available for manual or
deployment-platform one-shot runs.

`yarn collect-stats-shadow` remains the explicit full historical scan. It can
take hours and writes only `STATS_SHADOW_RESULT_PATH`; it is not the daily
publication path.

With `STATS_DAILY_COLLECTION_ENABLED=true`, the API server starts the same
collector when 24 hours have elapsed since the persisted successful publication
timestamp (UTC instants, not a wall-clock cron). Boot retains a one-minute minimum
warmup but does not force a new count. Manual `collect-stats` commands share this
daily gate. The next check is logged as an ISO timestamp. Failed collections keep the last known good snapshot and retry
after one hour. Running it in the API process lets publication use the same
`STATS_PUBLISHED_RESULT_PATH` volume the API already reads; keep a single API
replica while this scheduler is enabled. A kernel-held lock on the shared-volume
`.collection.lock` excludes concurrent API/CLI publishers and same-version
rolling overlap. It is released on process death; the lock file itself must not
be removed, because deleting a held file would permit overlapping publishers.
The production container supplies `/bin/flock`. **First rollout from the former
exclusive-create lock requires draining the old process and confirming it is
not collecting before starting the new scheduler:** the former lock and `flock`
do not coordinate if an old collection is already in progress. Future-dated
published snapshots do not trigger early scans; long timer delays are split
into safe checks.

For a first deployment, `STATS_PUBLISHED_SEED_PATH` may point to a read-only
managed file. A valid newer seed is copied atomically into the persistent result
path. `STATS_MINIMUM_PUBLISH_TOTAL` is an optional safety floor and defaults to
100,000,000.

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
| `JEV_DATABASE_URL`  | Private read access to Jev Antispam's PostgreSQL database                   |
| `JEV_TELEGRAM_BOT_TOKEN` | Jev Antispam Telegram token for current community member counts       |
| `PORT`              | Optional HTTP port supplied by the deployment platform; defaults to `1339`  |
| `STATS_DAILY_COLLECTION_ENABLED` | Set to `true` on one API replica to run the daily publisher   |
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
