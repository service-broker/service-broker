import * as dotenv from "dotenv"

dotenv.config();

export default {
  listeningPort: Number(process.env.LISTENING_PORT || 2033),
  providerKeepAlive: Number(process.env.PROVIDER_KEEP_ALIVE || 15*1000),
  nonProviderKeepAlive: Number(process.env.NON_PROVIDER_KEEP_ALIVE || 15*60*1000),
}
