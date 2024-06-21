"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const stream_1 = require("stream");
const ws_1 = __importDefault(require("ws"));
const config_1 = __importDefault(require("./config"));
const index_1 = require("./index");
const test_utils_1 = require("./test-utils");
const util_1 = require("./util");
function expectMessage(a, b) {
    (0, assert_1.default)(typeof a == "object" && a);
    (0, assert_1.default)(typeof a.header == "object" && a.header);
    (0, assert_1.default)(typeof a.header.from == "string");
    (0, assert_1.default)(a.header.ip == "::1" || a.header.ip == "127.0.0.1");
    for (const p in b.header)
        (0, test_utils_1.expect)(a.header[p]).toEqual(b.header[p]);
    (0, test_utils_1.expect)(a.payload).toEqual(b.payload);
}
(0, test_utils_1.describe)("test helper functions", ({ test }) => {
    test("pickRandom", () => {
        const list = [1, 2, 3, 4, 5, 6, 7];
        for (let i = 0; i < 100; i++)
            (0, test_utils_1.expect)(list.indexOf((0, util_1.pickRandom)(list))).not.toBe(-1);
    });
    test("messageFromString", () => {
        (0, test_utils_1.expect)(() => (0, util_1.messageFromString)('bad')).toThrow("Message doesn't have JSON header");
        (0, test_utils_1.expect)(() => (0, util_1.messageFromString)('{bad}\nCrap')).toThrow("Failed to parse message header");
        (0, test_utils_1.expect)((0, util_1.messageFromString)('{"a":1}')).toEqual({ header: { a: 1 }, payload: undefined });
        (0, test_utils_1.expect)((0, util_1.messageFromString)('{"a":1}\n')).toEqual({ header: { a: 1 }, payload: "" });
        (0, test_utils_1.expect)((0, util_1.messageFromString)('{"a":1}\nCrap')).toEqual({ header: { a: 1 }, payload: "Crap" });
    });
    test("messageFromBuffer", () => {
        (0, test_utils_1.expect)(() => (0, util_1.messageFromBuffer)(Buffer.from('bad'))).toThrow("Message doesn't have JSON header");
        (0, test_utils_1.expect)(() => (0, util_1.messageFromBuffer)(Buffer.from('{bad}\nCrap'))).toThrow("Failed to parse message header");
        (0, test_utils_1.expect)((0, util_1.messageFromBuffer)(Buffer.from('{"a":1}'))).toEqual({ header: { a: 1 }, payload: undefined });
        (0, test_utils_1.expect)((0, util_1.messageFromBuffer)(Buffer.from('{"a":1}\n'))).toEqual({ header: { a: 1 }, payload: Buffer.from("") });
        (0, test_utils_1.expect)((0, util_1.messageFromBuffer)(Buffer.from('{"a":1}\nCrap'))).toEqual({ header: { a: 1 }, payload: Buffer.from("Crap") });
    });
    test("getStream", async () => {
        const readable = new stream_1.Readable();
        readable._read = () => { };
        const promise = (0, util_1.getStream)(readable).then(x => x.toString());
        readable.push("Hello, ");
        await new Promise(f => setTimeout(f, 100));
        readable.push("world");
        readable.push(null);
        (0, test_utils_1.expect)(await promise).toBe("Hello, world");
    });
    test("pTimeout success", async () => {
        const promise = (0, util_1.pTimeout)(new Promise(f => setTimeout(() => f("Success"), 100)), 200);
        (0, test_utils_1.expect)(await promise).toBe("Success");
    });
    test("pTimeout timeout", async () => {
        const promise = (0, util_1.pTimeout)(new Promise(f => setTimeout(f, 200)), 100);
        (0, test_utils_1.expect)(promise).rejects("Timeout");
    });
});
(0, test_utils_1.describe)("test service provider", ({ beforeEach, afterEach, test }) => {
    let p1;
    let p2;
    let c1;
    beforeEach(async () => {
        p1 = new ws_1.default(`ws://localhost:${config_1.default.listeningPort}`);
        p2 = new ws_1.default(`ws://localhost:${config_1.default.listeningPort}`);
        c1 = new ws_1.default(`ws://localhost:${config_1.default.listeningPort}`);
        await Promise.all([
            new Promise(fulfill => p1.once("open", fulfill)),
            new Promise(fulfill => p2.once("open", fulfill)),
            new Promise(fulfill => c1.once("open", fulfill))
        ]);
    });
    afterEach(async () => {
        p1.close();
        p2.close();
        c1.close();
        await Promise.all([
            new Promise(fulfill => p1.once("close", fulfill)),
            new Promise(fulfill => p2.once("close", fulfill)),
            new Promise(fulfill => c1.once("close", fulfill))
        ]);
    });
    function receive(ws) {
        return new Promise(fulfill => {
            ws.once("message", (data, isBinary) => {
                if (isBinary)
                    fulfill((0, util_1.messageFromBuffer)(data));
                else
                    fulfill((0, util_1.messageFromString)(data.toString()));
            });
        });
    }
    async function providersAdvertise() {
        //provider1 advertise
        p1.send(JSON.stringify({
            id: 2,
            type: "SbAdvertiseRequest",
            services: [
                { name: "tts", capabilities: ["v1", "v2"], priority: 3 },
                { name: "transcode", capabilities: ["mp3", "mp4"], priority: 10 },
                { name: "#log", capabilities: ["err", "warn", "info"] }
            ]
        }));
        (0, test_utils_1.expect)(await receive(p1)).toEqual({
            header: { id: 2, type: "SbAdvertiseResponse" },
            payload: undefined
        });
        //provider2 advertise
        p2.send(JSON.stringify({
            id: 3,
            type: "SbAdvertiseRequest",
            services: [
                { name: "tts", capabilities: ["v1", "v3"], priority: 6 },
                { name: "transcode" },
                { name: "#log", capabilities: ["err"] }
            ]
        }));
        (0, test_utils_1.expect)(await receive(p2)).toEqual({
            header: { id: 3, type: "SbAdvertiseResponse" },
            payload: undefined
        });
        //verify providers registry is correct
        (0, test_utils_1.expect)(index_1.providerRegistry.registry["tts"]).toHaveLength(2);
        (0, test_utils_1.expect)(index_1.providerRegistry.registry["tts"].map((x) => x.priority)).toEqual([6, 3]);
        (0, test_utils_1.expect)(index_1.providerRegistry.registry["transcode"]).toHaveLength(2);
        (0, test_utils_1.expect)(index_1.providerRegistry.registry["transcode"].map((x) => x.priority)).toEqual([10, undefined]);
        (0, test_utils_1.expect)(index_1.providerRegistry.registry["#log"]).toHaveLength(2);
        (0, test_utils_1.expect)(index_1.providerRegistry.registry["#log"].map((x) => x.priority)).toEqual([undefined, undefined]);
    }
    test("bad request", async () => {
        p1.send(JSON.stringify({ id: 1, type: "UnknownRequest" }));
        (0, test_utils_1.expect)(await receive(p1)).toEqual({ header: { id: 1, error: "Don't know what to do with message" }, payload: undefined });
    });
    test("request success", async () => {
        await providersAdvertise();
        let header;
        //request tts-v1 should pick p2 (higher priority)
        header = {
            id: 40,
            service: { name: "tts", capabilities: ["v1"] }
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expectMessage(await receive(p2), {
            header,
            payload: "This is the text payload"
        });
        //request transcode-mp3 should pick p1 (higher priory)
        header = {
            id: 50,
            service: { name: "transcode", capabilities: ["mp3"] }
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expectMessage(await receive(p1), {
            header,
            payload: Buffer.from("This is the binary payload")
        });
        //request transcode-[no capabilities] should pick p1 (higher priory)
        header = {
            id: 60,
            service: { name: "transcode" }
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expectMessage(await receive(p1), {
            header,
            payload: Buffer.from("This is the binary payload")
        });
        //request tts-v2 should pick p1 (only match)
        header = {
            id: 50,
            service: { name: "tts", capabilities: ["v2"] }
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expectMessage(await receive(p1), {
            header,
            payload: "This is the text payload"
        });
        //request tts-v1,v2 should pick p1 (only match)
        header = {
            id: 60,
            service: { name: "tts", capabilities: ["v1", "v2"] }
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expectMessage(await receive(p1), {
            header,
            payload: "This is the text payload"
        });
        //request transcode-mp3,hifi should pick p2 (only match)
        header = {
            id: 70,
            service: { name: "transcode", capabilities: ["mp3", "hifi"] }
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expectMessage(await receive(p2), {
            header,
            payload: Buffer.from("This is the binary payload")
        });
        //request log-err should pick p1,p2 (multiple match)
        header = {
            id: 10,
            service: { name: "#log", capabilities: ["err"] }
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expectMessage(await receive(p1), {
            header,
            payload: "This is the text payload"
        });
        expectMessage(await receive(p2), {
            header,
            payload: "This is the text payload"
        });
        //request v2,v3 should error out (no match)
        c1.send(JSON.stringify({
            id: 70,
            service: { name: "tts", capabilities: ["v2", "v3"] }
        }));
        (0, test_utils_1.expect)(await receive(c1)).toEqual({
            header: { id: 70, error: "No provider tts" },
            payload: undefined
        });
        //request v1000 should error out (no match)
        c1.send(JSON.stringify({
            id: 80,
            service: { name: "tts", capabilities: ["v1000"] }
        }));
        (0, test_utils_1.expect)(await receive(c1)).toEqual({
            header: { id: 80, error: "No provider tts" },
            payload: undefined
        });
        //check no more messages pending
        p1.send(JSON.stringify({ id: 1, type: "UnknownRequest" }));
        (0, test_utils_1.expect)(await receive(p1)).toEqual({ header: { id: 1, error: "Don't know what to do with message" }, payload: undefined });
        p2.send(JSON.stringify({ id: 1, type: "UnknownRequest" }));
        (0, test_utils_1.expect)(await receive(p2)).toEqual({ header: { id: 1, error: "Don't know what to do with message" }, payload: undefined });
    });
});
(0, test_utils_1.runAll)()
    .catch(console.error)
    .finally(index_1.shutdown);
