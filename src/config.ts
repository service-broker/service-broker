import * as assert from "assert";
import { CorsOptions } from "cors";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

assert(process.env.LISTENING_PORT, "Missing env LISTENING_PORT");

export default {
  listeningPort: Number(process.env.LISTENING_PORT),
  ssl: (function() {
    if (process.env.SSL_PORT) {
      assert(process.env.SSL_CERT, "Missing env SSL_CERT")
      assert(process.env.SSL_KEY, "Missing env SSL_KEY")
      return {
        port: Number(process.env.SSL_PORT),
        cert: fs.readFileSync(process.env.SSL_CERT),
        key: fs.readFileSync(process.env.SSL_KEY)
      }
    }
  })(),

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

  rateLimit: (function() {
    if (process.env.RATE_LIMIT) {
      assert(process.env.TRUST_PROXY, "Missing env TRUST_PROXY")
      assert(/^\d+,\d+$/.test(process.env.RATE_LIMIT), "Bad env RATE_LIMIT")
      const rateLimit = process.env.RATE_LIMIT.split(",").map(Number)
      return {
        max: rateLimit[0],
        windowMs: rateLimit[1],
      }
    }
  })(),

  basicStats: {
    file: "stats.txt",
    interval: 5*60*1000
  },
}
