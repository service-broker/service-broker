"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const dotenv = require("dotenv");
dotenv.config();
assert(process.env.LISTENING_PORT, "Missing env LISTENING_PORT");
let rateLimit;
if (process.env.RATE_LIMIT) {
    assert(process.env.TRUST_PROXY, "Missing env TRUST_PROXY");
    assert(/^\d+,\d+$/.test(process.env.RATE_LIMIT), "Bad env RATE_LIMIT");
    rateLimit = process.env.RATE_LIMIT.split(",").map(x => Number(x));
}
exports.default = {
    listeningPort: Number(process.env.LISTENING_PORT),
    providerKeepAlive: Number(process.env.PROVIDER_KEEP_ALIVE || 15 * 1000),
    nonProviderKeepAlive: Number(process.env.NON_PROVIDER_KEEP_ALIVE || 15 * 60 * 1000),
    corsOptions: {
        origin: new RegExp(process.env.ALLOWED_ORIGINS || "."),
        methods: "GET,POST",
        allowedHeaders: "x-service-request-header, content-type",
        exposedHeaders: "x-service-response-header",
        maxAge: 86400
    },
    textMimes: [
        "text/*",
        "application/json",
        "application/x-www-form-urlencoded",
    ],
    trustProxy: Number(process.env.TRUST_PROXY || 0),
    rateLimit: rateLimit && {
        max: rateLimit[0],
        windowMs: rateLimit[1],
        onLimitReached: (req) => console.info("Rate limit exceeded", req.ip),
    },
    basicStats: {
        file: "stats.txt",
        interval: 5 * 60 * 1000
    },
};
