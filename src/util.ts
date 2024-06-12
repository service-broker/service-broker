import Stream from "stream";
import { Message } from "./endpoint";

export function messageFromString(str: string): Message {
  if (str[0] != '{') throw new Error("Message doesn't have JSON header");
  const index = str.indexOf('\n');
  const headerStr = (index != -1) ? str.slice(0,index) : str;
  const payload = (index != -1) ? str.slice(index+1) : undefined;
  let header: any;
  try {
    header = JSON.parse(headerStr);
  }
  catch (err) {
    throw new Error("Failed to parse message header");
  }
  return {header, payload};
}

export function messageFromBuffer(buf: Buffer): Message {
  if (buf[0] != 123) throw new Error("Message doesn't have JSON header");
  const index = buf.indexOf('\n');
  const headerStr = (index != -1) ? buf.subarray(0,index).toString() : buf.toString();
  const payload = (index != -1) ? buf.subarray(index+1) : undefined;
  let header: any;
  try {
    header = JSON.parse(headerStr);
  }
  catch (err) {
    throw new Error("Failed to parse message header");
  }
  return {header, payload};
}

export function pickRandom<T>(list: Array<T>): T {
  const randomIndex = Math.floor(Math.random() *list.length);
  return list[randomIndex];
}

export function getStream(stream: Stream): Promise<Buffer> {
  return new Promise<Buffer>((fulfill, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", chunk => chunks.push(chunk))
    stream.once("end", () => fulfill(concatChunks(chunks)))
    stream.once("error", reject)
  })
}

function concatChunks(chunks: Buffer[]) {
  let size = 0
  for (const chunk of chunks) {
    size += chunk.length
  }
  const buffer = Buffer.allocUnsafe(size)
  let index = 0
  for (const chunk of chunks) {
    buffer.set(chunk, index)
    index += chunk.length
  }
  return buffer
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
