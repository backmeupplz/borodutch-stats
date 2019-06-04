# Borodutch stats code

## Installation and local launch

1. Clone this repo: `git clone https://github.com/backmeupplz/borodutch-stats`
2. Launch the [mongo database](https://www.mongodb.com/) locally
3. Create `.env` with the environment variables listed below
4. Run `yarn install` in the root folder
5. Run `yarn develop`

## Environment variables

| Name    | Description               |
| ------- | ------------------------- |
| `MONGO` | URL of the mongo database |

Also, please, consider looking at `.env.sample`.

## Continuous integration

Any commit pushed to master gets deployed to stats.borodutch.com via [CI Ninja](https://github.com/backmeupplz/ci-ninja).

## License

MIT — use for any purpose. Would be great if you could leave a note about the original developers. Thanks!
