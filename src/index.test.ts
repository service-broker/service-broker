import rewire = require('rewire');
import * as WebSocket from 'ws';
import * as dotenv from 'dotenv';

dotenv.config();

const app = rewire("./index.js");
const pickRandom = app.__get__("pickRandom");
const messageFromString = app.__get__("messageFromString");
const messageFromBuffer = app.__get__("messageFromBuffer");
const providerRegistry = app.__get__("providerRegistry");


afterAll(() => {
    app.__get__("wss").close();
})

describe("test helper functions", () => {
    test("pickRandom", () => {
        const list = [1,2,3,4,5,6,7];
        for (let i=0; i<100; i++) expect(list.indexOf(pickRandom(list))).not.toBe(-1);
    })

    test("messageFromString", () => {
        expect(() => messageFromString('bad')).toThrow("Message doesn't have JSON header");
        expect(() => messageFromString('{bad}\nCrap')).toThrow("Failed to parse message header");
        expect(messageFromString('{"a":1}')).toEqual({header:{a:1}});
        expect(messageFromString('{"a":1}\n')).toEqual({header:{a:1}, payload:""});
        expect(messageFromString('{"a":1}\nCrap')).toEqual({header:{a:1}, payload:"Crap"});
    })

    test("messageFromBuffer", () => {
        expect(() => messageFromBuffer(Buffer.from('bad'))).toThrow("Message doesn't have JSON header");
        expect(() => messageFromBuffer(Buffer.from('{bad}\nCrap'))).toThrow("Failed to parse message header");
        expect(messageFromBuffer(Buffer.from('{"a":1}'))).toEqual({header:{a:1}});
        expect(messageFromBuffer(Buffer.from('{"a":1}\n'))).toEqual({header:{a:1}, payload:Buffer.from("")});
        expect(messageFromBuffer(Buffer.from('{"a":1}\nCrap'))).toEqual({header:{a:1}, payload:Buffer.from("Crap")});
    })
})

describe("test service provider", () => {
    let p1: WebSocket;
    let p2: WebSocket;
    let c1: WebSocket;

    beforeEach(async () => {
        p1 = new WebSocket(`ws://localhost:${process.env.PORT}`);
        p2 = new WebSocket(`ws://localhost:${process.env.PORT}`);
        c1 = new WebSocket(`ws://localhost:${process.env.PORT}`);
        await Promise.all([
            new Promise(fulfill => p1.once("open", fulfill)),
            new Promise(fulfill => p2.once("open", fulfill)),
            new Promise(fulfill => c1.once("open", fulfill))
        ])
    })
    afterEach(async () => {
        p1.close();
        p2.close();
        c1.close();
        await Promise.all([
            new Promise(fulfill => p1.once("close", fulfill)),
            new Promise(fulfill => p2.once("close", fulfill)),
            new Promise(fulfill => c1.once("close", fulfill))
        ])
    })
    
    function receive(ws: WebSocket) {
        return new Promise(fulfill => {
            ws.once("message", data => {
                if (typeof data == "string") fulfill(messageFromString(data));
                else if (Buffer.isBuffer(data)) fulfill(messageFromBuffer(data));
                else fulfill(null);
            })
        })
    }

    async function providersAdvertise() {
        //provider1 advertise
        p1.send(JSON.stringify({
            id:2,
            type:"AdvertiseRequest",
            services:[{name:"tts", capabilities:["v1","v2"], priority:3}]
        }));
        expect(await receive(p1)).toEqual({
            header:{id:2}
        });

        //provider2 advertise
        p2.send(JSON.stringify({
            id:3,
            type:"AdvertiseRequest",
            services:[{name:"tts", capabilities:["v1","v3"], priority:6}]
        }));
        expect(await receive(p2)).toEqual({
            header:{id:3}
        });
        expect(providerRegistry.registry).toEqual({
            tts: [
                expect.objectContaining({capabilities:new Set(["v1","v3"]), priority:6}),
                expect.objectContaining({capabilities:new Set(["v1","v2"]), priority:3})
            ]
        });
    }

    test("bad request", async () => {
        p1.send(JSON.stringify({id:1, type:"UnknownRequest"}));
        expect(await receive(p1)).toEqual({header:{id:1, error:"Don't know what to do with message"}});
    })

    test("request higher priority", async () => {
        await providersAdvertise();

        //request v1 should pick p2 (higher priority)
        c1.send(JSON.stringify({
            id:40,
            service:{name:"tts", capabilities:["v1"]}
        }));
        expect(await receive(p2)).toEqual({
            header:{from:expect.any(String), id:40, service:expect.anything()}
        });
    })

    test("request only match", async () => {
        await providersAdvertise();

        //request v2 should pick p1 (only match)
        c1.send(JSON.stringify({
            id:50,
            service:{name:"tts", capabilities:["v2"]}
        }));
        expect(await receive(p1)).toEqual({
            header:{from:expect.any(String), id:50, service:expect.anything()}
        });

        //request v1,v2 should pick p1 (only match)
        c1.send(JSON.stringify({
            id:60,
            service:{name:"tts", capabilities:["v1", "v2"]}
        }));
        expect(await receive(p1)).toEqual({
            header:{from:expect.any(String), id:60, service:expect.anything()}
        });
    })

    test("request no match", async () => {
        await providersAdvertise();

        //request v2,v3 should error out (no match)
        c1.send(JSON.stringify({
            id:70,
            service:{name:"tts", capabilities:["v2", "v3"]}
        }));
        expect(await receive(c1)).toEqual({
            header:{id:70, error:"No provider"}
        });

        //request v1000 should error out (no match)
        c1.send(JSON.stringify({
            id:80,
            service:{name:"tts", capabilities:["v1000"]}
        }));
        expect(await receive(c1)).toEqual({
            header:{id:80, error:"No provider"}
        });
    })
})

