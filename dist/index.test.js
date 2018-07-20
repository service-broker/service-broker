"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const rewire = require("rewire");
const WebSocket = require("ws");
const dotenv = require("dotenv");
dotenv.config();
const app = rewire("./index.js");
const pickRandom = app.__get__("pickRandom");
const messageFromString = app.__get__("messageFromString");
const messageFromBuffer = app.__get__("messageFromBuffer");
const providerRegistry = app.__get__("providerRegistry");
afterAll(() => {
    app.__get__("wss").close();
});
describe("test helper functions", () => {
    test("pickRandom", () => {
        const list = [1, 2, 3, 4, 5, 6, 7];
        for (let i = 0; i < 100; i++)
            expect(list.indexOf(pickRandom(list))).not.toBe(-1);
    });
    test("messageFromString", () => {
        expect(() => messageFromString('bad')).toThrow("Message doesn't have JSON header");
        expect(() => messageFromString('{bad}\nCrap')).toThrow("Failed to parse message header");
        expect(messageFromString('{"a":1}')).toEqual({ header: { a: 1 } });
        expect(messageFromString('{"a":1}\n')).toEqual({ header: { a: 1 }, payload: "" });
        expect(messageFromString('{"a":1}\nCrap')).toEqual({ header: { a: 1 }, payload: "Crap" });
    });
    test("messageFromBuffer", () => {
        expect(() => messageFromBuffer(Buffer.from('bad'))).toThrow("Message doesn't have JSON header");
        expect(() => messageFromBuffer(Buffer.from('{bad}\nCrap'))).toThrow("Failed to parse message header");
        expect(messageFromBuffer(Buffer.from('{"a":1}'))).toEqual({ header: { a: 1 } });
        expect(messageFromBuffer(Buffer.from('{"a":1}\n'))).toEqual({ header: { a: 1 }, payload: Buffer.from("") });
        expect(messageFromBuffer(Buffer.from('{"a":1}\nCrap'))).toEqual({ header: { a: 1 }, payload: Buffer.from("Crap") });
    });
});
describe("test service provider", () => {
    let p1;
    let p2;
    let c1;
    beforeEach(() => __awaiter(this, void 0, void 0, function* () {
        p1 = new WebSocket(`ws://localhost:${process.env.PORT}`);
        p2 = new WebSocket(`ws://localhost:${process.env.PORT}`);
        c1 = new WebSocket(`ws://localhost:${process.env.PORT}`);
        yield Promise.all([
            new Promise(fulfill => p1.once("open", fulfill)),
            new Promise(fulfill => p2.once("open", fulfill)),
            new Promise(fulfill => c1.once("open", fulfill))
        ]);
    }));
    afterEach(() => __awaiter(this, void 0, void 0, function* () {
        p1.close();
        p2.close();
        c1.close();
        yield Promise.all([
            new Promise(fulfill => p1.once("close", fulfill)),
            new Promise(fulfill => p2.once("close", fulfill)),
            new Promise(fulfill => c1.once("close", fulfill))
        ]);
    }));
    function receive(ws) {
        return new Promise(fulfill => {
            ws.once("message", data => {
                if (typeof data == "string")
                    fulfill(messageFromString(data));
                else if (Buffer.isBuffer(data))
                    fulfill(messageFromBuffer(data));
                else
                    fulfill(null);
            });
        });
    }
    function providersAdvertise() {
        return __awaiter(this, void 0, void 0, function* () {
            //provider1 advertise
            p1.send(JSON.stringify({
                id: 2,
                type: "AdvertiseRequest",
                services: [{ name: "tts", capabilities: ["v1", "v2"], priority: 3 }]
            }));
            expect(yield receive(p1)).toEqual({
                header: { id: 2 }
            });
            //provider2 advertise
            p2.send(JSON.stringify({
                id: 3,
                type: "AdvertiseRequest",
                services: [{ name: "tts", capabilities: ["v1", "v3"], priority: 6 }]
            }));
            expect(yield receive(p2)).toEqual({
                header: { id: 3 }
            });
            expect(providerRegistry.registry).toEqual({
                tts: [
                    expect.objectContaining({ capabilities: new Set(["v1", "v3"]), priority: 6 }),
                    expect.objectContaining({ capabilities: new Set(["v1", "v2"]), priority: 3 })
                ]
            });
        });
    }
    test("bad request", () => __awaiter(this, void 0, void 0, function* () {
        p1.send(JSON.stringify({ id: 1, type: "UnknownRequest" }));
        expect(yield receive(p1)).toEqual({ header: { id: 1, error: "Don't know what to do with message" } });
    }));
    test("request higher priority", () => __awaiter(this, void 0, void 0, function* () {
        yield providersAdvertise();
        //request v1 should pick p2 (higher priority)
        c1.send(JSON.stringify({
            id: 40,
            service: { name: "tts", capabilities: ["v1"] }
        }));
        expect(yield receive(p2)).toEqual({
            header: { from: expect.any(String), id: 40, service: expect.anything() }
        });
    }));
    test("request only match", () => __awaiter(this, void 0, void 0, function* () {
        yield providersAdvertise();
        //request v2 should pick p1 (only match)
        c1.send(JSON.stringify({
            id: 50,
            service: { name: "tts", capabilities: ["v2"] }
        }));
        expect(yield receive(p1)).toEqual({
            header: { from: expect.any(String), id: 50, service: expect.anything() }
        });
        //request v1,v2 should pick p1 (only match)
        c1.send(JSON.stringify({
            id: 60,
            service: { name: "tts", capabilities: ["v1", "v2"] }
        }));
        expect(yield receive(p1)).toEqual({
            header: { from: expect.any(String), id: 60, service: expect.anything() }
        });
    }));
    test("request no match", () => __awaiter(this, void 0, void 0, function* () {
        yield providersAdvertise();
        //request v2,v3 should error out (no match)
        c1.send(JSON.stringify({
            id: 70,
            service: { name: "tts", capabilities: ["v2", "v3"] }
        }));
        expect(yield receive(c1)).toEqual({
            header: { id: 70, error: "No provider" }
        });
        //request v1000 should error out (no match)
        c1.send(JSON.stringify({
            id: 80,
            service: { name: "tts", capabilities: ["v1000"] }
        }));
        expect(yield receive(c1)).toEqual({
            header: { id: 80, error: "No provider" }
        });
    }));
});
