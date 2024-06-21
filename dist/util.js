"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageFromString = messageFromString;
exports.messageFromBuffer = messageFromBuffer;
exports.pickRandom = pickRandom;
exports.getStream = getStream;
exports.pTimeout = pTimeout;
exports.generateId = generateId;
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
        stream.on("data", chunk => chunks.push(chunk));
        stream.once("end", () => fulfill(concatChunks(chunks)));
        stream.once("error", reject);
    });
}
function concatChunks(chunks) {
    let size = 0;
    for (const chunk of chunks) {
        size += chunk.length;
    }
    const buffer = Buffer.allocUnsafe(size);
    let index = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, index);
        index += chunk.length;
    }
    return buffer;
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
