import { Connection } from "@service-broker/websocket";
import assert from "assert";
import http from "http";
import * as rxjs from "rxjs";
import { assertRecord, generateId, getClientIp } from "./util.js";

export interface Message {
  header: Record<string, unknown>
  payload?: string | Buffer
}

export interface Endpoint {
  id: string
  clientIp: string
  isProvider$: rxjs.BehaviorSubject<boolean>
  waiters: Map<string, { responseId: unknown }>
  message$: rxjs.Observable<Message>
  keepAlive$: rxjs.Observable<number>
  close$: rxjs.Observable<unknown>
  send(m: Message): void
  debug: {
    connection: Connection
  }
}

export function makeEndpoint(ws: Connection, config: {
  trustProxy: number
  providerPingInterval: number
  nonProviderPingInterval: number
  pongTimeout: number
  maxHeaderSize: number
}): Endpoint {
  const id = generateId()
  const clientIp = ws.request instanceof http.IncomingMessage ? getClientIp(ws.request, config.trustProxy) : ws.request.connectUrl
  const isProvider$ = new rxjs.BehaviorSubject(false)
  return {
    id,
    clientIp,
    isProvider$,
    waiters: new Map(),
    message$: ws.message$.pipe(
      rxjs.concatMap(event => {
        try {
          return rxjs.of(deserialize(event.data))
        } catch (err) {
          console.error(String(err))
          return rxjs.EMPTY
        }
      })
    ),
    keepAlive$: isProvider$.pipe(
      rxjs.distinctUntilChanged(),
      rxjs.switchMap(isProvider =>
        ws.keepAlive(isProvider ? config.providerPingInterval : config.nonProviderPingInterval, config.pongTimeout).pipe(
          rxjs.catchError(() => {
            console.info('Pong timeout', isProvider ? 'provider' : 'client', id, clientIp)
            ws.terminate()
            return rxjs.EMPTY
          })
        )
      )
    ),
    close$: ws.close$,
    send(msg) {
      ws.send(serialize(msg))
    },
    debug: {
      connection: ws
    }
  }



  function serialize({ header, payload }: Message) {
    const headerStr = JSON.stringify(header)
    if (payload != null) {
      if (typeof payload == "string") {
        return headerStr + '\n' + payload
      } else if (Buffer.isBuffer(payload)) {
        const headerLen = Buffer.byteLength(headerStr)
        const buffer = Buffer.allocUnsafe(headerLen + 1 + payload.length)
        buffer.write(headerStr)
        buffer[headerLen] = 10
        payload.copy(buffer, headerLen + 1)
        return buffer
      } else {
        throw new Error("Unexpected payload type")
      }
    } else {
      return headerStr
    }
  }

  function deserialize(data: unknown): Message {
    if (typeof data == 'string') return messageFromString(data)
    else if (Buffer.isBuffer(data)) return messageFromBuffer(data)
    else throw new Error("Unexpected payload type")
  }

  function messageFromString(str: string): Message {
    if (str[0] != '{') throw new Error("Message doesn't have JSON header")
    const index = str.slice(0, config.maxHeaderSize).indexOf('\n')
    if (index != -1) {
      try {
        const header: unknown = JSON.parse(str.slice(0, index))
        assert(typeof header == 'object' && header != null)
        assertRecord(header)
        return { header, payload: str.slice(index + 1) }
      } catch (err) {
        throw new Error("Failed to parse message header")
      }
    } else {
      if (str.length > config.maxHeaderSize) throw new Error('Message header too large')
      try {
        const header: unknown = JSON.parse(str)
        assert(typeof header == 'object' && header != null)
        assertRecord(header)
        return { header }
      } catch (err) {
        throw new Error("Failed to parse message header")
      }
    }
  }

  function messageFromBuffer(buf: Buffer): Message {
    if (buf[0] != 123) throw new Error("Message doesn't have JSON header")
    const index = buf.subarray(0, config.maxHeaderSize).indexOf('\n')
    if (index != -1) {
      try {
        const header: unknown = JSON.parse(buf.subarray(0, index).toString())
        assert(typeof header == 'object' && header != null)
        assertRecord(header)
        return { header, payload: buf.subarray(index + 1) }
      } catch (err) {
        throw new Error("Failed to parse message header")
      }
    } else {
      if (buf.length > config.maxHeaderSize) throw new Error('Message header too large')
      try {
        const header: unknown = JSON.parse(buf.toString())
        assert(typeof header == 'object' && header != null)
        assertRecord(header)
        return { header }
      } catch (err) {
        throw new Error("Failed to parse message header")
      }
    }
  }
}
