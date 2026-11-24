FROM node:22.23.5-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile
COPY . .
RUN yarn build-ts

# Runtime: production dependencies only (no jest/nodemon/concurrently and their CVE-laden trees)
FROM node:22.23.5-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile --production \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# npm/npx removed above: the bundled npm 10.9.9 carries unfixable CVEs and nothing runs it (yarn lives in /opt)
COPY . .
COPY --from=build /app/dist dist
ENV NODE_ENV=production
CMD ["node", "dist/app.js"]
