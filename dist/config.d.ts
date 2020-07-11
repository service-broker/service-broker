import { CorsOptions } from "cors";
import * as RateLimit from "express-rate-limit";
declare const _default: {
    listeningPort: number;
    providerKeepAlive: number;
    nonProviderKeepAlive: number;
    corsOptions: CorsOptions;
    textMimes: string[];
    trustProxy: number;
    rateLimit: RateLimit.Options | undefined;
    basicStats: {
        file: string;
        interval: number;
    };
};
export default _default;
