import assert from "assert";
import * as rxjs from "rxjs";
import config from './config.js';
import { makeEndpoint } from "./endpoint.js";
import './index.js';
import { describe, expect, validateValue } from "./test-utils.js";
import { connect } from './websocket.js';
const localIp = validateValue(x => {
    assert(typeof x == 'string' && ['::1', '127.0.0.1'].includes(x));
});
async function makeClient() {
    const con = await rxjs.firstValueFrom(connect('ws://localhost:' + config.listeningPort));
    return makeEndpoint(con);
}
async function makeProvider(services) {
    const endpoint = await makeClient();
    endpoint.send({
        header: { id: 1, type: "SbAdvertiseRequest", services }
    });
    expect(await rxjs.firstValueFrom(endpoint.message$)).toEqual({
        header: { id: 1, type: "SbAdvertiseResponse" },
        payload: undefined
    });
    return endpoint;
}
describe("request-response", ({ beforeEach, afterEach, test }) => {
    let c1, p1;
    beforeEach(async () => {
        [c1, p1] = await Promise.all([
            makeClient(),
            makeProvider([{ name: "s1", capabilities: ["c1", 'c2'] }])
        ]);
    });
    afterEach(() => {
        c1.debug.connection.close();
        p1.debug.connection.close();
    });
    test("http-request-response", async () => {
        const promise = fetch(`http://localhost:${config.listeningPort}/s1?capabilities=c1,c2`, {
            method: 'post',
            headers: {
                'x-service-request-header': JSON.stringify({ a: 1 }),
                'content-type': 'application/json'
            },
            body: 'request'
        });
        const req = await rxjs.firstValueFrom(p1.message$);
        expect(req).toEqual({
            header: {
                from: validateValue(x => assert(typeof x == 'string')),
                ip: localIp,
                id: validateValue(x => assert(typeof x == 'string')),
                service: { name: 's1', capabilities: ['c1', 'c2'] },
                contentType: 'application/json',
                a: 1
            },
            payload: 'request'
        });
        p1.send({
            header: {
                to: req.header.from,
                id: req.header.id,
                contentType: "application/octet-stream"
            },
            payload: Buffer.from([1, 2, 3])
        });
        const res = await promise;
        assert(res.ok);
        expect(JSON.parse(res.headers.get('x-service-response-header'))).toEqual({
            from: validateValue(x => assert(typeof x == 'string')),
            to: req.header.from,
            id: req.header.id
        });
        expect(res.headers.get('content-type')).toEqual('application/octet-stream');
        expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
    });
    test("ws-request-response", async () => {
        c1.send({
            header: {
                id: 1,
                service: { name: 's1' }
            },
            payload: 'request'
        });
        const req = await rxjs.firstValueFrom(p1.message$);
        expect(req).toEqual({
            header: {
                from: validateValue(x => assert(typeof x == 'string')),
                ip: localIp,
                id: 1,
                service: { name: 's1' }
            },
            payload: 'request'
        });
        p1.send({
            header: {
                to: req.header.from,
                id: 11
            },
            payload: Buffer.from('response')
        });
        expect(await rxjs.firstValueFrom(c1.message$)).toEqual({
            header: {
                to: req.header.from,
                from: validateValue(x => assert(typeof x == 'string')),
                id: 11
            },
            payload: Buffer.from('response')
        });
        c1.send({
            header: {
                id: 2,
                service: { name: 's1', capabilities: ['c5'] }
            },
            payload: Buffer.from('request')
        });
        expect(await rxjs.firstValueFrom(c1.message$)).toEqual({
            header: {
                id: 2,
                error: 'NO_PROVIDER s1'
            },
            payload: undefined
        });
    });
    test("load-balancing", async () => {
        //TODO
    });
    test("rate-limiting", () => {
        //TODO
    });
});
describe("pub-sub", ({ beforeEach, afterEach, test }) => {
    let s1, s2, p1;
    beforeEach(async () => {
        [s1, s2, p1] = await Promise.all([
            makeProvider([{ name: '#t1', capabilities: ['c1'] }]),
            makeProvider([{ name: '#t1', capabilities: ['c1', 'c2'] }]),
            makeClient()
        ]);
    });
    afterEach(() => {
        s1.debug.connection.close();
        s2.debug.connection.close();
        p1.debug.connection.close();
    });
    test("publish-subscribe", async () => {
        p1.send({
            header: {
                id: 2,
                service: { name: '#t1', capabilities: ['c1', 'c2'] }
            },
            payload: Buffer.from('notification')
        });
        expect(await rxjs.firstValueFrom(s2.message$)).toEqual({
            header: {
                from: validateValue(x => assert(typeof x == 'string')),
                ip: localIp,
                id: 2,
                service: { name: '#t1', capabilities: ['c1', 'c2'] }
            },
            payload: Buffer.from('notification')
        });
        p1.send({
            header: {
                id: 1,
                service: { name: '#t1' }
            },
            payload: 'notification'
        });
        expect(await Promise.all([
            rxjs.firstValueFrom(s1.message$),
            rxjs.firstValueFrom(s2.message$)
        ])).toEqual([{
                header: {
                    from: validateValue(x => assert(typeof x == 'string')),
                    ip: localIp,
                    id: 1,
                    service: { name: '#t1' }
                },
                payload: 'notification'
            }, {
                header: {
                    from: validateValue(x => assert(typeof x == 'string')),
                    ip: localIp,
                    id: 1,
                    service: { name: '#t1' }
                },
                payload: 'notification'
            }]);
    });
});
describe("endpoint-healthcheck", ({ beforeEach, afterEach, test }) => {
    let c1, p1;
    beforeEach(async () => {
        [c1, p1] = await Promise.all([
            makeClient(),
            makeProvider([{ name: 's1' }])
        ]);
        c1.send({
            header: {
                id: 1,
                service: { name: 's1' }
            }
        });
        const req = await rxjs.firstValueFrom(p1.message$);
        expect(req).toEqual({
            header: {
                from: validateValue(x => assert(typeof x == 'string')),
                ip: localIp,
                id: 1,
                service: { name: 's1' }
            },
            payload: undefined
        });
        c1.id = req.header.from;
    });
    afterEach(() => {
        c1.debug.connection.close();
        p1.debug.connection.close();
    });
    test("endpoint-status-request", async () => {
        p1.send({
            header: {
                id: 2,
                type: "SbEndpointStatusRequest",
                endpointIds: [c1.id, 'crap']
            }
        });
        expect(await rxjs.firstValueFrom(p1.message$)).toEqual({
            header: {
                id: 2,
                type: "SbEndpointStatusResponse",
                endpointStatuses: [true, false]
            },
            payload: undefined
        });
    });
    test("wait-endpoint", async () => {
        p1.send({
            header: {
                id: 3,
                type: "SbEndpointWaitRequest",
                endpointId: c1.id
            }
        });
        await new Promise(f => setTimeout(f, 100));
        c1.send({
            header: {
                id: 4,
                service: { name: 's1' }
            }
        });
        expect(await rxjs.firstValueFrom(p1.message$)).toEqual({
            header: {
                from: c1.id,
                ip: localIp,
                id: 4,
                service: { name: 's1' }
            },
            payload: undefined
        });
        await new Promise(f => setTimeout(f, 100));
        c1.debug.connection.close();
        expect(await rxjs.firstValueFrom(p1.message$)).toEqual({
            header: {
                id: 3,
                type: "SbEndpointWaitResponse",
                endpointId: c1.id
            },
            payload: undefined
        });
    });
});
//# sourceMappingURL=index.test.js.map