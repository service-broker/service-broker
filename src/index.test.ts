import * as rxjs from "rxjs";
import config from './config.js';
import { debug as providerDebug } from "./provider.js";
import { debug as subscriberDebug } from "./subscriber.js";
import { describe, expect, oneOf, valueOfType } from "./test-utils.js";
import { messageFromBuffer, messageFromString } from "./util.js";
import { Connection, connect } from './websocket.js';


describe("test service provider", ({beforeEach, afterEach, test}) => {
    let p1: Connection, p2: Connection, c1: Connection

    beforeEach(async () => {
        [p1, p2, c1] = await rxjs.firstValueFrom(
            rxjs.forkJoin([
                connect(`ws://localhost:${config.listeningPort}`),
                connect(`ws://localhost:${config.listeningPort}`),
                connect(`ws://localhost:${config.listeningPort}`)
            ])
        )
    })

    afterEach(async () => {
        p1.close();
        p2.close();
        c1.close();
    })

    async function receive(ws: Connection) {
        const event = await rxjs.firstValueFrom(ws.message$)
        if (typeof event.data == 'string') return messageFromString(event.data)
        if (Buffer.isBuffer(event.data)) return messageFromBuffer(event.data)
        throw new Error("Unexpected payload type")
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
            header:{id:2, type:"SbAdvertiseResponse"},
            payload:undefined
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
            header:{id:3, type:"SbAdvertiseResponse"},
            payload:undefined
        });

        //verify providers registry is correct
        expect(providerDebug.registry.get("tts")).toHaveLength(2)
        expect(providerDebug.registry.get("tts")?.map(x => x.priority)).toEqual([6,3])
        expect(providerDebug.registry.get("transcode")).toHaveLength(2)
        expect(providerDebug.registry.get("transcode")?.map(x => x.priority)).toEqual([10,0])
        expect(subscriberDebug.registry.get("#log")?.size).toEqual(2)
    }

    function wrapHeader(header: object) {
        return {
            from: valueOfType('string'),
            ip: oneOf('::1', '127.0.0.1'),
            ...header
        }
    }

    test("bad request", async () => {
        p1.send(JSON.stringify({id:1, type:"UnknownRequest"}));
        expect(await receive(p1)).toEqual({
            header: {id:1, error:"Don't know what to do with message"},
            payload: undefined
        })
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
            header: wrapHeader(header),
            payload: "This is the text payload"
        });

        //request transcode-mp3 should pick p1 (higher priory)
        header = {
            id:50,
            service:{name:"transcode", capabilities:["mp3"]}
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expect(await receive(p1)).toEqual({
            header: wrapHeader(header),
            payload: Buffer.from("This is the binary payload")
        })

        //request transcode-[no capabilities] should pick p1 (higher priory)
        header = {
            id:60,
            service:{name:"transcode"}
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expect(await receive(p1)).toEqual({
            header: wrapHeader(header),
            payload: Buffer.from("This is the binary payload")
        })

        //request tts-v2 should pick p1 (only match)
        header = {
            id:50,
            service:{name:"tts", capabilities:["v2"]}
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expect(await receive(p1)).toEqual({
            header: wrapHeader(header),
            payload: "This is the text payload"
        });

        //request tts-v1,v2 should pick p1 (only match)
        header = {
            id:60,
            service:{name:"tts", capabilities:["v1", "v2"]}
        };
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expect(await receive(p1)).toEqual({
            header: wrapHeader(header),
            payload: "This is the text payload"
        });

        //request transcode-mp3,hifi should pick p2 (only match)
        header = {
            id:70,
            service:{name:"transcode", capabilities:["mp3", "hifi"]}
        };
        c1.send(Buffer.from(JSON.stringify(header) + "\nThis is the binary payload"));
        expect(await receive(p2)).toEqual({
            header: wrapHeader(header),
            payload: Buffer.from("This is the binary payload")
        });

        //request log-err should pick p1,p2 (multiple match)
        header = {
            id:10,
            service:{name:"#log", capabilities:["err"]}
        }
        c1.send(JSON.stringify(header) + "\nThis is the text payload");
        expect(await receive(p1)).toEqual({
            header: wrapHeader(header),
            payload: "This is the text payload"
        })
        expect(await receive(p2)).toEqual({
            header: wrapHeader(header),
            payload: "This is the text payload"
        })

        //request v2,v3 should error out (no match)
        c1.send(JSON.stringify({
            id:70,
            service:{name:"tts", capabilities:["v2", "v3"]}
        }));
        expect(await receive(c1)).toEqual({
            header:{id:70, error:"NO_PROVIDER tts"},
            payload:undefined
        });

        //request v1000 should error out (no match)
        c1.send(JSON.stringify({
            id:80,
            service:{name:"tts", capabilities:["v1000"]}
        }));
        expect(await receive(c1)).toEqual({
            header:{id:80, error:"NO_PROVIDER tts"},
            payload:undefined
        });

        //check no more messages pending
        p1.send(JSON.stringify({id:1, type:"UnknownRequest"}));
        expect(await receive(p1)).toEqual({
            header: {id:1, error:"Don't know what to do with message"},
            payload: undefined
        })
        p2.send(JSON.stringify({id:1, type:"UnknownRequest"}));
        expect(await receive(p2)).toEqual({
            header: {id:1, error:"Don't know what to do with message"},
            payload: undefined
        })
    })
})
