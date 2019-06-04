"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Get environment variables
const dotenv = require("dotenv");
dotenv.config({ path: `${__dirname}/../.env` });
// Dependencies
require("reflect-metadata");
const Koa = require("koa");
const koa_bodyparser_ts_1 = require("koa-bodyparser-ts");
const koa_router_ts_1 = require("koa-router-ts");
const cors = require("@koa/cors");
const app = new Koa();
const router = koa_router_ts_1.loadControllers(`${__dirname}/controllers`, { recurse: true });
// Run app
app.use(cors({ origin: '*' }));
app.use(koa_bodyparser_ts_1.default());
app.use(router.routes());
app.use(router.allowedMethods());
app.listen(1339);
console.log('Koa application is up and running on port 1339');
//# sourceMappingURL=app.js.map