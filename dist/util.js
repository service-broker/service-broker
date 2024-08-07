"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.immediate = immediate;
exports.messageFromString = messageFromString;
exports.messageFromBuffer = messageFromBuffer;
exports.pickRandom = pickRandom;
exports.getStream = getStream;
exports.pTimeout = pTimeout;
exports.generateId = generateId;
exports.makeRateLimiter = makeRateLimiter;
function immediate(func) {
    return func();
}
function messageFromString(str) {
    if (str[0] != '{')
        throw new Error("Message doesn't have JSON header");
    const index = str.indexOf('\n');
    const headerStr = (index != -1) ? str.slice(0, index) : str;
    const payload = (index != -1) ? str.slice(index + 1) : undefined;
    let header;
    try {
        header = JSON.parse(headerStr);
    }
    catch (err) {
        throw new Error("Failed to parse message header");
    }
    return { header, payload };
}
function messageFromBuffer(buf) {
    if (buf[0] != 123)
        throw new Error("Message doesn't have JSON header");
    const index = buf.indexOf('\n');
    const headerStr = (index != -1) ? buf.subarray(0, index).toString() : buf.toString();
    const payload = (index != -1) ? buf.subarray(index + 1) : undefined;
    let header;
    try {
        header = JSON.parse(headerStr);
    }
    catch (err) {
        throw new Error("Failed to parse message header");
    }
    return { header, payload };
}
function pickRandom(list) {
    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
}
function getStream(stream) {
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
function pTimeout(promise, millis) {
    let timer;
    return Promise.race([
        promise
            .finally(() => clearTimeout(timer)),
        new Promise(f => timer = setTimeout(f, millis))
            .then(() => Promise.reject(new Error("Timeout")))
    ]);
}
function generateId() {
    return Math.random().toString(36).slice(2);
}
function makeRateLimiter({ tokensPerInterval, interval }) {
    let avail = 0, expire = 0;
    return {
        tryRemoveTokens(count) {
            const now = Date.now();
            if (expire <= now) {
                avail = tokensPerInterval;
                expire = now + interval;
            }
            if (count <= avail) {
                avail -= count;
                return true;
            }
            else {
                return false;
            }
        }
    };
}
