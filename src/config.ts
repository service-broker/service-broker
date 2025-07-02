import assert from "assert";
import { CorsOptions } from "cors";
import dotenv from "dotenv";
import { immediate } from "./util";

dotenv.config();

assert(process.env.LISTENING_PORT || process.env.SSL_PORT, "Missing env LISTENING_PORT or SSL_PORT");

export default {
  listeningPort: (x => x ? Number(x) : undefined)(process.env.LISTENING_PORT),
  listeningHost: process.env.LISTENING_HOST,

  ssl: (function() {
    if (process.env.SSL_PORT) {
      assert(process.env.SSL_CERT, "Missing env SSL_CERT")
      assert(process.env.SSL_KEY, "Missing env SSL_KEY")
      return {
        port: Number(process.env.SSL_PORT),
        host: process.env.SSL_HOST,
        certFile: process.env.SSL_CERT,
        keyFile: process.env.SSL_KEY
      }
    }
  })(),

  providerAuthToken: process.env.PROVIDER_AUTH_TOKEN,
  providerKeepAlive: Number(process.env.PROVIDER_KEEP_ALIVE || 15*1000),
  nonProviderKeepAlive: Number(process.env.NON_PROVIDER_KEEP_ALIVE || 15*60*1000),

  corsOptions: <CorsOptions>{
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

  nonProviderRateLimit: immediate(() => {
    if (process.env.RATE_LIMIT) {
      assert(/^\d+[,/]\d+$/.test(process.env.RATE_LIMIT), "Bad env RATE_LIMIT")
      const [limit, windowMs] = process.env.RATE_LIMIT.split(/[,/]/).map(Number)
      return {limit, windowMs}
    }
  }),

  basicStats: {
    file: "stats.txt",
    interval: 5*60*1000
  },
}
