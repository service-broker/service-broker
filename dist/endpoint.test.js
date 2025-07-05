import { makeEndpoint } from "./endpoint.js";
import { describe, expect } from "./test-utils.js";
import * as rxjs from "rxjs";
import { connect, makeServer } from "./websocket.js";
import config from "./config.js";
describe('endpoint', ({ beforeEach, afterEach, test }) => {
    let e1, e2;
    beforeEach(async () => {
        [e1, e2] = await rxjs.firstValueFrom(rxjs.forkJoin([
            makeServer({ port: config.listeningPort }).pipe(rxjs.exhaustMap(server => server.connection$.pipe(rxjs.take(1), rxjs.finalize(() => server.close())))),
            connect('ws://localhost:' + config.listeningPort)
        ]).pipe(rxjs.map(cons => cons.map(makeEndpoint))));
    });
    afterEach(() => {
        e1.debug.connection.close();
        e2.debug.connection.close();
    });
    async function sendRecv(msg, expected = msg) {
        e1.send(msg);
        expect(await rxjs.firstValueFrom(e2.message$)).toEqual(expected);
        e2.send(msg);
        expect(await rxjs.firstValueFrom(e1.message$)).toEqual(expected);
    }
    test("send-receive", async () => {
        await sendRecv({ header: { a: 1 }, payload: 'text' });
        await sendRecv({ header: { b: 2 }, payload: Buffer.from('bin') });
        await sendRecv({ header: { c: 3 }, payload: '' });
        await sendRecv({ header: { d: 4 }, payload: Buffer.from([]) });
        await sendRecv({ header: { e: 5 }, payload: undefined });
    });
    test("close", async () => {
        e1.debug.connection.close();
        await rxjs.firstValueFrom(e2.close$);
    });
    test("keep-alive", () => {
        //TODO
    });
});
//# sourceMappingURL=endpoint.test.js.map