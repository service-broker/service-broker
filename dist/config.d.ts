import { CorsOptions } from "cors";
declare const _default: {
    listeningPort: number;
    providerKeepAlive: number;
    nonProviderKeepAlive: number;
    corsOptions: CorsOptions;
    textMimes: string[];
    trustProxy: number;
    rateLimit: {
        max: number;
        windowMs: number;
    };
    basicStats: {
        file: string;
        interval: number;
    };
};
export default _default;
