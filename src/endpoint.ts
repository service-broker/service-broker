import WebSocket from "ws";

export interface Message {
  header: any
  payload?: string|Buffer
}

export interface Endpoint {
  id: string
  isAlive: boolean
  waiters: {endpointId: string, responseId: number}[]
  send(m: Message): void
  keepAlive(): void
}

export function makeEndpoint(id: string, ws: WebSocket): Endpoint {
  return {
    id,
    isAlive: true,
    waiters: [],
    send(msg: Message) {
      const headerStr = JSON.stringify(msg.header);
      if (msg.payload) {
        if (typeof msg.payload == "string") {
          ws.send(headerStr + '\n' + msg.payload);
        }
        else if (Buffer.isBuffer(msg.payload)) {
          const headerLen = Buffer.byteLength(headerStr);
          const tmp = Buffer.allocUnsafe(headerLen +1 +msg.payload.length);
          tmp.write(headerStr);
          tmp[headerLen] = 10;
          msg.payload.copy(tmp, headerLen+1);
          ws.send(tmp);
        }
        else {
          throw new Error("Unexpected")
        }
      }
      else {
        ws.send(headerStr)
      }
    },
    keepAlive() {
      if (!this.isAlive) return ws.terminate()
      this.isAlive = false;
      ws.ping()
    }
  }
}
