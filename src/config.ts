import * as dotenv from "dotenv"
import { CorsOptions } from "cors"

dotenv.config();

export default {
  listeningPort: Number(process.env.LISTENING_PORT || 2033),
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
}
