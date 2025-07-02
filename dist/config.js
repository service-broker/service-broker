"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const dotenv_1 = __importDefault(require("dotenv"));
const util_1 = require("./util");
dotenv_1.default.config();
(0, assert_1.default)(process.env.LISTENING_PORT || process.env.SSL_PORT, "Missing env LISTENING_PORT or SSL_PORT");
exports.default = {
    listeningPort: (x => x ? Number(x) : undefined)(process.env.LISTENING_PORT),
    listeningHost: process.env.LISTENING_HOST,
    ssl: (function () {
        if (process.env.SSL_PORT) {
            (0, assert_1.default)(process.env.SSL_CERT, "Missing env SSL_CERT");
            (0, assert_1.default)(process.env.SSL_KEY, "Missing env SSL_KEY");
            return {
                port: Number(process.env.SSL_PORT),
                host: process.env.SSL_HOST,
                certFile: process.env.SSL_CERT,
                keyFile: process.env.SSL_KEY
            };
        }
    })(),
    providerAuthToken: process.env.PROVIDER_AUTH_TOKEN,
    providerKeepAlive: Number(process.env.PROVIDER_KEEP_ALIVE || 15 * 1000),
    nonProviderKeepAlive: Number(process.env.NON_PROVIDER_KEEP_ALIVE || 15 * 60 * 1000),
    corsOptions: {
        origin: process.env.ALLOWED_ORIGINS ? new RegExp(process.env.ALLOWED_ORIGINS) : "*",
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
    nonProviderRateLimit: (0, util_1.immediate)(() => {
        if (process.env.RATE_LIMIT) {
            (0, assert_1.default)(/^\d+[,/]\d+$/.test(process.env.RATE_LIMIT), "Bad env RATE_LIMIT");
            const [limit, windowMs] = process.env.RATE_LIMIT.split(/[,/]/).map(Number);
            return { limit, windowMs };
        }
    }),
    basicStats: {
        file: "stats.txt",
        interval: 5 * 60 * 1000
    },
};
