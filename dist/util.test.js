import { Readable } from "stream";
import { describe, expect } from "./test-utils.js";
import { getStream, messageFromBuffer, messageFromString, pTimeout, pickRandom } from "./util.js";
describe("test helper functions", ({ test }) => {
    test("pickRandom", () => {
        const list = [1, 2, 3, 4, 5, 6, 7];
        for (let i = 0; i < 100; i++)
            expect(list.indexOf(pickRandom(list))).toEqual(-1, 'negate');
    });
    test("messageFromString", () => {
        expect(() => messageFromString('bad')).toThrow("Message doesn't have JSON header");
        expect(() => messageFromString('{bad}\nCrap')).toThrow("Failed to parse message header");
        expect(messageFromString('{"a":1}')).toEqual({ header: { a: 1 }, payload: undefined });
        expect(messageFromString('{"a":1}\n')).toEqual({ header: { a: 1 }, payload: "" });
        expect(messageFromString('{"a":1}\nCrap')).toEqual({ header: { a: 1 }, payload: "Crap" });
    });
    test("messageFromBuffer", () => {
        expect(() => messageFromBuffer(Buffer.from('bad'))).toThrow("Message doesn't have JSON header");
        expect(() => messageFromBuffer(Buffer.from('{bad}\nCrap'))).toThrow("Failed to parse message header");
        expect(messageFromBuffer(Buffer.from('{"a":1}'))).toEqual({ header: { a: 1 }, payload: undefined });
        expect(messageFromBuffer(Buffer.from('{"a":1}\n'))).toEqual({ header: { a: 1 }, payload: Buffer.from("") });
        expect(messageFromBuffer(Buffer.from('{"a":1}\nCrap'))).toEqual({ header: { a: 1 }, payload: Buffer.from("Crap") });
    });
    test("getStream", async () => {
        const readable = new Readable();
        readable._read = () => { };
        const promise = getStream(readable).then(x => x.toString());
        readable.push("Hello, ");
        await new Promise(f => setTimeout(f, 100));
        readable.push("world");
        readable.push(null);
        expect(await promise).toEqual("Hello, world");
    });
    test("pTimeout success", async () => {
        const promise = pTimeout(new Promise(f => setTimeout(() => f("Success"), 100)), 200);
        expect(await promise).toEqual("Success");
    });
    test("pTimeout timeout", async () => {
        const promise = pTimeout(new Promise(f => setTimeout(f, 200)), 100);
        expect(promise).rejects("Timeout");
    });
});
