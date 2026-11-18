FROM node:22.23.5-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile
COPY . .
RUN yarn build-ts

# Runtime: production dependencies only (no jest/nodemon/concurrently and their CVE-laden trees)
FROM node:22.23.5-bookworm-slim
WORKDIR /app
COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked yarn install --frozen-lockfile --production
COPY . .
COPY --from=build /app/dist dist
ENV NODE_ENV=production
CMD ["node", "dist/app.js"]
