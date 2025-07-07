import * as rxjs from "rxjs";
import { WebSocket, WebSocketServer } from "ws";
export function makeServer(opts) {
    return rxjs.defer(() => {
        const server = new WebSocketServer(opts);
        return rxjs.fromEvent(server, 'listening').pipe(rxjs.take(1), rxjs.map(() => ({
            connection$: rxjs.fromEvent(server, 'connection', (ws, req) => makeConnection(ws, req)),
            error$: rxjs.fromEvent(server, 'error', (event) => event),
            close$: rxjs.fromEvent(server, 'close', (event) => event),
            close: server.close.bind(server)
        })));
    });
}
export function connect(address, options) {
    return rxjs.defer(() => {
        const ws = new WebSocket(address, options);
        return rxjs.race(rxjs.fromEvent(ws, 'error', (event) => event).pipe(rxjs.map(event => { throw event.error; })), rxjs.fromEvent(ws, 'open').pipe(rxjs.take(1), rxjs.map(() => makeConnection(ws))));
    });
}
function makeConnection(ws, request) {
    const close$ = rxjs.fromEvent(ws, 'close', (event) => event);
    return {
        request: request ?? { connectUrl: ws.url },
        message$: rxjs.fromEvent(ws, 'message', (event) => event).pipe(rxjs.takeUntil(close$)),
        error$: rxjs.fromEvent(ws, 'error', (event) => event).pipe(rxjs.takeUntil(close$)),
        close$,
        send: ws.send.bind(ws),
        close: ws.close.bind(ws),
        terminate: ws.terminate.bind(ws),
        keepAlive: (interval, timeout) => rxjs.interval(interval).pipe(rxjs.exhaustMap(() => {
            ws.ping();
            return rxjs.fromEventPattern(h => ws.on('pong', h), h => ws.off('pong', h)).pipe(rxjs.timeout(timeout), rxjs.take(1), rxjs.ignoreElements());
        }), rxjs.takeUntil(close$))
    };
}
//# sourceMappingURL=websocket.js.map