import * as rxjs from "rxjs";
import config from './config.js';
import { Endpoint, makeEndpoint } from "./endpoint.js";
import './index.js';
import { describe, expect } from "./test-utils.js";
import { connect } from './websocket.js';

describe("service-broker", ({ beforeEach, afterEach, test }) => {
  let c1: Endpoint, p1: Endpoint

  beforeEach(async () => {
    [c1, p1] = await rxjs.firstValueFrom(
      rxjs.forkJoin([
        connect('ws://localhost:' + config.listeningPort),
        connect('ws://localhost:' + config.listeningPort)
      ]).pipe(
        rxjs.map(cons => cons.map(makeEndpoint))
      )
    )
    p1.send({
      header: {
        id: 1,
        type: "SbAdvertiseRequest",
        services: [{ name: "s1", capabilities: ["c1"] }]
      }
    })
    expect(await rxjs.firstValueFrom(p1.message$)).toEqual({
      header: { id: 1, type: "SbAdvertiseResponse" },
      payload: undefined
    })
  })

  afterEach(() => {
    c1.debug.connection.close()
    p1.debug.connection.close()
  })

  test("http-request-response", async () => {
    //TODO
  })

  test("request-response", async () => {
    //TODO
  })

  test("load-balancing", async () => {
    //TODO
  })

  test("publish-subscribe", async () => {
    //TODO
  })

  test("wait-endpoint", async () => {
    //TODO
  })

  test("endpoint-status-request", async () => {
    //TODO
  })

  test("rate-limiting", () => {
    //TODO
  })
})
