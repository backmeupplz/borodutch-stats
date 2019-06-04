"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
const koa_router_ts_1 = require("koa-router-ts");
const stats_1 = require("../helpers/stats");
let default_1 = class default_1 {
    stats(ctx) {
        ctx.body = stats_1.stats;
    }
};
__decorate([
    koa_router_ts_1.Get('stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], default_1.prototype, "stats", null);
default_1 = __decorate([
    koa_router_ts_1.Controller('/')
], default_1);
exports.default = default_1;
//# sourceMappingURL=public.js.map