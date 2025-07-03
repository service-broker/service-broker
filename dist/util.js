import assert from "assert";
export function immediate(func) {
    return func();
}
export function lazy(func) {
    let out;
    return () => (out ?? (out = { val: func() })).val;
}
export function assertRecord(value) {
}
export function messageFromString(str) {
    if (str[0] != '{')
        throw new Error("Message doesn't have JSON header");
    const index = str.indexOf('\n');
    const headerStr = (index != -1) ? str.slice(0, index) : str;
    const payload = (index != -1) ? str.slice(index + 1) : undefined;
    try {
        const header = JSON.parse(headerStr);
        assert(typeof header == 'object' && header != null);
        assertRecord(header);
        return { header, payload };
    }
    catch (err) {
        throw new Error("Failed to parse message header");
    }
}
export function messageFromBuffer(buf) {
    if (buf[0] != 123)
        throw new Error("Message doesn't have JSON header");
    const index = buf.indexOf('\n');
    const headerStr = (index != -1) ? buf.subarray(0, index).toString() : buf.toString();
    const payload = (index != -1) ? buf.subarray(index + 1) : undefined;
    try {
        const header = JSON.parse(headerStr);
        assert(typeof header == 'object' && header != null);
        assertRecord(header);
        return { header, payload };
    }
    catch (err) {
        throw new Error("Failed to parse message header");
    }
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
