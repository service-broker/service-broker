import { describe, expect } from "@service-broker/test-utils";
import { connect, makeServer } from "@service-broker/websocket";
import * as rxjs from "rxjs";
import config from "./config.js";
import { makeEndpoint } from "./endpoint.js";
describe('endpoint', ({ beforeEach, afterEach, test }) => {
    let e1, e2;
    beforeEach(async () => {
        [e1, e2] = await rxjs.firstValueFrom(rxjs.forkJoin([
            makeServer({ port: config.listeningPort }).pipe(rxjs.exhaustMap(server => server.connection$.pipe(rxjs.take(1), rxjs.finalize(() => server.close())))),
            connect('ws://localhost:' + config.listeningPort, { autoPong: false })
        ]).pipe(rxjs.map(cons => cons.map(con => makeEndpoint(con, {
            ...config,
            nonProviderKeepAlive: 250,
            pingTimeout: 50
        })))));
    });
    afterEach(() => {
        e1.debug.connection.close();
        e2.debug.connection.close();
    });
    async function sendRecv(msg, expected = msg) {
        if (Math.random() >= .5) {
            e1.send(msg);
            expect(await rxjs.firstValueFrom(e2.message$), expected);
        }
        else {
            e2.send(msg);
            expect(await rxjs.firstValueFrom(e1.message$), expected);
        }
    }
    test("send-receive", async () => {
        await sendRecv({ header: { a: 1 }, payload: 'text' });
        await sendRecv({ header: { b: 2 }, payload: Buffer.from('bin') });
        await sendRecv({ header: { c: 3 }, payload: '' });
        await sendRecv({ header: { d: 4 }, payload: Buffer.from([]) });
        await sendRecv({ header: { e: 5 } });
    });
    test("close", async () => {
        e1.debug.connection.close();
        await Promise.all([
            rxjs.firstValueFrom(e1.close$),
            rxjs.firstValueFrom(e2.close$)
        ]);
    });
    test("keep-alive-success", async () => {
        expect(await rxjs.firstValueFrom(e2.keepAlive$.pipe(rxjs.take(3), rxjs.buffer(rxjs.NEVER))), [0, 1, 2]);
    });
    test("keep-alive-timeout", async () => {
        e1.keepAlive$.subscribe();
        await Promise.all([
            rxjs.firstValueFrom(e1.close$),
            rxjs.firstValueFrom(e2.close$)
        ]);
    });
    test("max-header-size", async () => {
        const bigStr = '-'.repeat(config.maxHeaderSize + 1);
        e1.send({ header: { a: bigStr } });
        e1.send({ header: { a: bigStr, payload: 'text' } });
        e1.send({ header: { b: 1 }, payload: bigStr });
        expect(await rxjs.firstValueFrom(e2.message$), { header: { b: 1 }, payload: bigStr });
    });
});
//# sourceMappingURL=endpoint.test.js.map