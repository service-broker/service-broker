export function makeEndpoint(id, ws) {
    return {
        id,
        isAlive: true,
        waiters: [],
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
        },
        keepAlive() {
            if (!this.isAlive)
                return ws.terminate();
            this.isAlive = false;
            ws.ping();
        }
    };
}
