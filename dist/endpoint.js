import http from "http";
import * as rxjs from "rxjs";
import config from "./config.js";
import { generateId, getClientIp, messageFromBuffer, messageFromString } from "./util.js";
export function makeEndpoint(ws) {
    return {
        id: generateId(),
        clientIp: ws.request instanceof http.IncomingMessage ? getClientIp(ws.request, config.trustProxy) : ws.request.connectUrl,
        isProvider$: new rxjs.BehaviorSubject(false),
        waiters: new Map(),
        message$: ws.message$.pipe(rxjs.concatMap(event => rxjs.defer(() => {
            if (typeof event.data == 'string')
                return rxjs.of(messageFromString(event.data));
            if (Buffer.isBuffer(event.data))
                return rxjs.of(messageFromBuffer(event.data));
            return rxjs.throwError(() => "Unexpected payload type");
        }).pipe(rxjs.catchError(err => {
            console.error(String(err));
            return rxjs.EMPTY;
        })))),
        send(msg) {
            const headerStr = JSON.stringify(msg.header);
            if (msg.payload) {
                if (typeof msg.payload == "string") {
                    ws.send(headerStr + '\n' + msg.payload);
                }
                else if (Buffer.isBuffer(msg.payload)) {
                    const headerLen = Buffer.byteLength(headerStr);
                    const tmp = Buffer.allocUnsafe(headerLen + 1 + msg.payload.length);
                    tmp.write(headerStr);
                    tmp[headerLen] = 10;
                    msg.payload.copy(tmp, headerLen + 1);
                    ws.send(tmp);
                }
                else {
                    throw new Error("Unexpected");
                }
            }
            else {
                ws.send(headerStr);
            }
        }
    };
}
