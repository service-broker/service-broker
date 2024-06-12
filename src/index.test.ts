
import { Readable } from 'stream';
import WebSocket from 'ws';
import config from './config';
import { providerRegistry, shutdown } from "./index";
import { getStream, messageFromBuffer, messageFromString, pTimeout, pickRandom } from "./util";

afterAll(shutdown);


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

    test("getStream", async () => {
        const readable = new Readable()
        readable._read = () => {}
        const promise = getStream(readable).then(x => x.toString())
        readable.push("Hello, ")
        await new Promise<void>(f => setTimeout(f, 100))
        readable.push("world")
        readable.push(null)
        await expect(promise).resolves.toBe("Hello, world")
    })

    test("pTimeout success", async () => {
        const promise = pTimeout(new Promise<string>(f => setTimeout(() => f("Success"), 100)), 200)
        await expect(promise).resolves.toBe("Success")
    })

    test("pTimeout timeout", async () => {
        const promise = pTimeout(new Promise<void>(f => setTimeout(f, 200)), 100)
        await expect(promise).rejects.toEqual(new Error("Timeout"))
    })
})



describe("test service provider", () => {
    let p1: WebSocket;
    let p2: WebSocket;
    let c1: WebSocket;

    beforeEach(async () => {
        p1 = new WebSocket(`ws://localhost:${config.listeningPort}`);
        p2 = new WebSocket(`ws://localhost:${config.listeningPort}`);
        c1 = new WebSocket(`ws://localhost:${config.listeningPort}`);
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
            ws.once("message", (data: Buffer, isBinary) => {
                if (isBinary) fulfill(messageFromBuffer(data));
                else fulfill(messageFromString(data.toString()));
            })
        })
    }

    async function providersAdvertise() {
        //provider1 advertise
        p1.send(JSON.stringify({
            id:2,
            type:"SbAdvertiseRequest",
            services:[
                {name:"tts", capabilities:["v1","v2"], priority:3},
                {name:"transcode", capabilities:["mp3","mp4"], priority:10},
                {name:"#log", capabilities:["err","warn","info"]}
            ]
        }));
        expect(await receive(p1)).toEqual({
            header:{id:2, type:"SbAdvertiseResponse"}
        });

        //provider2 advertise
        p2.send(JSON.stringify({
            id:3,
            type:"SbAdvertiseRequest",
            services:[
                {name:"tts", capabilities:["v1","v3"], priority:6},
                {name:"transcode"},
                {name:"#log", capabilities:["err"]}
            ]
        }));
        expect(await receive(p2)).toEqual({
            header:{id:3, type:"SbAdvertiseResponse"}
        });

        //verify providers registry is correct
        expect(providerRegistry.registry["tts"]).toHaveLength(2);
        expect(providerRegistry.registry["tts"].map((x: any) => x.priority)).toEqual([6,3]);
        expect(providerRegistry.registry["transcode"]).toHaveLength(2);
        expect(providerRegistry.registry["transcode"].map((x: any) => x.priority)).toEqual([10, undefined]);
        expect(providerRegistry.registry["#log"]).toHaveLength(2);
        expect(providerRegistry.registry["#log"].map((x: any) => x.priority)).toEqual([undefined, undefined]);
    }

    test("bad request", async () => {
        p1.send(JSON.stringify({id:1, type:"UnknownRequest"}));
        expect(await receive(p1)).toEqual({header:{id:1, error:"Don't know what to do with message"}});
    })

    test("request success", async () => {
        await providersAdvertise();
        let header;

        //request tts-v1 should pick p2 (higher priority)
        header = {
            id:40,
            service:{name:"tts", capabilities:["v1"]}
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expect(await receive(p2)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: "This is the text payload"
        });

        //request transcode-mp3 should pick p1 (higher priory)
        header = {
            id:50,
            service:{name:"transcode", capabilities:["mp3"]}
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expect(await receive(p1)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: Buffer.from("This is the binary payload")
        })

        //request transcode-[no capabilities] should pick p1 (higher priory)
        header = {
            id:60,
            service:{name:"transcode"}
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expect(await receive(p1)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: Buffer.from("This is the binary payload")
        })

        //request tts-v2 should pick p1 (only match)
        header = {
            id:50,
            service:{name:"tts", capabilities:["v2"]}
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expect(await receive(p1)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: "This is the text payload"
        });

        //request tts-v1,v2 should pick p1 (only match)
        header = {
            id:60,
            service:{name:"tts", capabilities:["v1", "v2"]}
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expect(await receive(p1)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: "This is the text payload"
        });

        //request transcode-mp3,hifi should pick p2 (only match)
        header = {
            id:70,
            service:{name:"transcode", capabilities:["mp3", "hifi"]}
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expect(await receive(p2)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: Buffer.from("This is the binary payload")
        });

        //request log-err should pick p1,p2 (multiple match)
        header = {
            id:10,
            service:{name:"#log", capabilities:["err"]}
        }
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expect(await receive(p1)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: "This is the text payload"
        })
        expect(await receive(p2)).toEqual({
            header: Object.assign({from:expect.any(String), ip:"::1"}, header),
            payload: "This is the text payload"
        })

        //request v2,v3 should error out (no match)
        c1.send(JSON.stringify({
            id:70,
            service:{name:"tts", capabilities:["v2", "v3"]}
        }));
        expect(await receive(c1)).toEqual({
            header:{id:70, error:"No provider tts"}
        });

        //request v1000 should error out (no match)
        c1.send(JSON.stringify({
            id:80,
            service:{name:"tts", capabilities:["v1000"]}
        }));
        expect(await receive(c1)).toEqual({
            header:{id:80, error:"No provider tts"}
        });

        //check no more messages pending
        p1.send(JSON.stringify({id:1, type:"UnknownRequest"}));
        expect(await receive(p1)).toEqual({header:{id:1, error:"Don't know what to do with message"}});
        p2.send(JSON.stringify({id:1, type:"UnknownRequest"}));
        expect(await receive(p2)).toEqual({header:{id:1, error:"Don't know what to do with message"}});
    })
})
