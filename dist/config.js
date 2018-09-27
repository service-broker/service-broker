"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
dotenv.config();
exports.default = {
    listeningPort: Number(process.env.LISTENING_PORT || 2033),
    providerKeepAlive: Number(process.env.PROVIDER_KEEP_ALIVE || 15 * 1000),
    nonProviderKeepAlive: Number(process.env.NON_PROVIDER_KEEP_ALIVE || 15 * 60 * 1000),
    corsOptions: {
        origin: process.env.ALLOWED_ORIGINS ? new RegExp(process.env.ALLOWED_ORIGINS) : "*",
        methods: "GET,POST",
        allowedHeaders: "x-service-request-header",
        exposedHeaders: "x-service-response-header",
        maxAge: 86400
    }
};
