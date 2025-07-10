import http from "http";
import * as rxjs from "rxjs";
import Stream from "stream";

export function immediate<T>(func: () => T) {
  return func()
}

export function assertRecord(value: object): asserts value is Record<string, unknown> {
}

export function pickRandom<T>(list: Array<T>): T {
  const randomIndex = Math.floor(Math.random() *list.length);
  return list[randomIndex];
}

export function getStream(stream: Stream): Promise<Buffer> {
  return new Promise<Buffer>((fulfill, reject) => {
    const chunks: Buffer[] = []
    let totalLength = 0
    stream.on("data", chunk => {
      chunks.push(chunk)
      totalLength += chunk.length
    })
    stream.once("end", () => fulfill(Buffer.concat(chunks, totalLength)))
    stream.once("error", reject)
  })
}

export function pTimeout<T>(promise: Promise<T>, millis: number): Promise<T> {
  let timer: NodeJS.Timeout
  return Promise.race([
    promise
      .finally(() => clearTimeout(timer)),
    new Promise(f => timer = setTimeout(f, millis))
      .then(() => Promise.reject(new Error("Timeout")))
  ])
}

export function generateId() {
  return Math.random().toString(36).slice(2)
}

export function getClientIp(req: http.IncomingMessage, trustProxy: number) {
  if (!req.socket.remoteAddress) throw "remoteAddress is null"
  const xForwardedFor = req.headers['x-forwarded-for'] ? (<string>req.headers['x-forwarded-for']).split(/\s*,\s*/) : [];
  return xForwardedFor.concat(req.socket.remoteAddress.replace(/^::ffff:/, '')).slice(-1-trustProxy)[0]
}

export class StatsCounter {
  private map: {[key: string]: number};
  constructor() {
    this.map = {};
  }
  inc(name: string) {
    this.map[name] = (this.map[name] || 0) +1;
  }
  clear() {
    this.map = {};
  }
  toJson(): string {
    return JSON.stringify(this.map);
  }
}
