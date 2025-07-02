import { ClientRequestArgs, IncomingMessage } from "http"
import * as rxjs from "rxjs"
import { type ClientOptions, CloseEvent, ErrorEvent, MessageEvent, type ServerOptions, WebSocket, WebSocketServer } from "ws"

export interface Connection {
  request?: IncomingMessage
  message$: rxjs.Observable<MessageEvent>
  pong$: rxjs.Observable<Event>
  error$: rxjs.Observable<ErrorEvent>
  close$: rxjs.Observable<CloseEvent>
  send: WebSocket['send']
  ping: WebSocket['ping']
  close: WebSocket['close']
  terminate: WebSocket['terminate']
  keepAlive(interval: number, timeout: number): rxjs.Observable<never>
}

export function makeServer(opts: ServerOptions) {
  return rxjs.defer(() => {
    const server = new WebSocketServer(opts)
    return rxjs.fromEvent(server, 'listening').pipe(
      rxjs.take(1),
      rxjs.map(() => ({
        connection$: rxjs.fromEvent(server, 'connection', (ws: WebSocket, req: IncomingMessage) => makeConnection(ws, req)),
        error$: rxjs.fromEvent(server, 'error', (event: ErrorEvent) => event),
        close$: rxjs.fromEvent(server, 'close', (event: CloseEvent) => event),
        close: server.close.bind(server)
      }))
    )
  })
}

export function connect(address: string | URL, options?: ClientOptions | ClientRequestArgs) {
  return rxjs.defer(() => {
    const ws = new WebSocket(address, options)
    return rxjs.race(
      rxjs.fromEvent(ws, 'error', (event: ErrorEvent) => event).pipe(
        rxjs.map(event => { throw event.error })
      ),
      rxjs.fromEvent(ws, 'open').pipe(
        rxjs.take(1),
        rxjs.map(() => makeConnection(ws))
      )
    )
  })
}

function makeConnection(ws: WebSocket, request?: IncomingMessage): Connection {
  return {
    request,
    message$: rxjs.fromEvent(ws, 'message', (event: MessageEvent) => event),
    pong$: rxjs.fromEvent(ws, 'pong', (event: Event) => event),
    error$: rxjs.fromEvent(ws, 'error', (event: ErrorEvent) => event),
    close$: rxjs.fromEvent(ws, 'close', (event: CloseEvent) => event),
    send: ws.send.bind(ws),
    ping: ws.ping.bind(ws),
    close: ws.close.bind(ws),
    terminate: ws.terminate.bind(ws),
    keepAlive: (interval, timeout) => rxjs.interval(interval).pipe(
      rxjs.switchMap(() => {
        ws.ping()
        return rxjs.fromEventPattern(h => ws.on('pong', h), h => ws.off('pong', h)).pipe(
          rxjs.timeout(timeout),
          rxjs.take(1),
          rxjs.ignoreElements()
        )
      })
    )
  }
}
