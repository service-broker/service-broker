import * as rxjs from "rxjs";
export const shutdown$ = new rxjs.Subject();
export function immediate(func) {
    return func();
}
export function lazy(func) {
    let out;
    return () => (out ?? (out = { val: func() })).val;
}
export function assertRecord(value) {
}
export function pickRandom(list) {
    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
}
export function getStream(stream) {
    return new Promise((fulfill, reject) => {
        const chunks = [];
        let totalLength = 0;
        stream.on("data", chunk => {
            chunks.push(chunk);
            totalLength += chunk.length;
        });
        stream.once("end", () => fulfill(Buffer.concat(chunks, totalLength)));
        stream.once("error", reject);
    });
}
export function pTimeout(promise, millis) {
    let timer;
    return Promise.race([
        promise
            .finally(() => clearTimeout(timer)),
        new Promise(f => timer = setTimeout(f, millis))
            .then(() => Promise.reject(new Error("Timeout")))
    ]);
}
export function generateId() {
    return Math.random().toString(36).slice(2);
}
export function getClientIp(req, trustProxy) {
    if (!req.socket.remoteAddress)
        throw "remoteAddress is null";
    const xForwardedFor = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(/\s*,\s*/) : [];
    return xForwardedFor.concat(req.socket.remoteAddress.replace(/^::ffff:/, '')).slice(-1 - trustProxy)[0];
}
export class StatsCounter {
    constructor() {
        this.map = {};
    }
    inc(name) {
        this.map[name] = (this.map[name] || 0) + 1;
    }
    clear() {
        this.map = {};
    }
    toJson() {
        return JSON.stringify(this.map);
    }
}
//# sourceMappingURL=util.js.map