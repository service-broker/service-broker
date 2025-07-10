import { describe, expect, oneOf, valueOfType } from "@service-broker/test-utils";
import { connect } from '@service-broker/websocket';
import assert from "assert";
import * as rxjs from "rxjs";
import config from './config.js';
import { Endpoint, makeEndpoint } from "./endpoint.js";
import './index.js';

const localIp = oneOf(['::1', '127.0.0.1'])

async function makeClient() {
  const con = await rxjs.firstValueFrom(connect('ws://localhost:' + config.listeningPort))
  return makeEndpoint(con, config)
}

async function makeProvider(services: unknown) {
  const endpoint = await makeClient()
  endpoint.send({
    header: { id: 1, type: "SbAdvertiseRequest", services, authToken: config.providerAuthToken }
  })
  expect(await rxjs.firstValueFrom(endpoint.message$), {
    header: { id: 1, type: "SbAdvertiseResponse" }
  })
  return endpoint
}


describe("request-response", ({ beforeEach, afterEach, test }) => {
  let c1: Endpoint, p1: Endpoint

  beforeEach(async () => {
    [c1, p1] = await Promise.all([
      makeClient(),
      makeProvider([{ name: "s1", capabilities: ["c1", 'c2'] }])
    ])
  })

  afterEach(() => {
    c1.debug.connection.close()
    p1.debug.connection.close()
  })

  test("http-request-text-payload", async () => {
    const promise = fetch(`http://localhost:${config.listeningPort}/s1?capabilities=c1,c2`, {
      method: 'post',
      headers: {
        'x-service-request-header': JSON.stringify({ a: 1 }),
        'content-type': 'application/json'
      },
      body: 'request'
    })
    const req = await rxjs.firstValueFrom(p1.message$)
    expect(req, {
      header: {
        from: valueOfType('string'),
        ip: localIp,
        id: valueOfType('string'),
        service: { name: 's1', capabilities: ['c1', 'c2'] },
        contentType: 'application/json',
        a: 1
      },
      payload: 'request'
    })

    p1.send({
      header: {
        to: req.header.from,
        id: req.header.id,
        contentType: "text/html"
      },
      payload: '<html>'
    })
    const res = await promise
    assert(res.ok)
    expect(JSON.parse(res.headers.get('x-service-response-header')!), {
      from: valueOfType('string'),
      to: req.header.from,
      id: req.header.id
    })
    assert(res.headers.get('content-type')?.startsWith('text/html'))
    expect(await res.text(), '<html>')
  })

  test('http-request-binary-payload', async () => {
    const promise = fetch(`http://localhost:${config.listeningPort}/s1`, {
      method: 'post',
      headers: {
        'x-service-request-header': JSON.stringify({ a: 2 }),
        'content-type': 'image/png'
      },
      body: 'image'
    })
    const req = await rxjs.firstValueFrom(p1.message$)
    expect(req, {
      header: {
        from: valueOfType('string'),
        ip: localIp,
        id: valueOfType('string'),
        service: { name: 's1' },
        contentType: 'image/png',
        a: 2
      },
      payload: Buffer.from('image')
    })

    p1.send({
      header: {
        to: req.header.from,
        id: req.header.id,
        contentType: "application/octet-stream"
      },
      payload: Buffer.from('binary')
    })
    const res = await promise
    assert(res.ok)
    expect(JSON.parse(res.headers.get('x-service-response-header')!), {
      from: valueOfType('string'),
      to: req.header.from,
      id: req.header.id
    })
    expect(res.headers.get('content-type'), 'application/octet-stream')
    expect(Buffer.from(await res.arrayBuffer()), Buffer.from('binary'))
  })

  test("ws-request-response", async () => {
    c1.send({
      header: {
        id: 1,
        service: { name: 's1' }
      },
      payload: 'request'
    })
    const req = await rxjs.firstValueFrom(p1.message$)
    expect(req, {
      header: {
        from: valueOfType('string'),
        ip: localIp,
        id: 1,
        service: { name: 's1' }
      },
      payload: 'request'
    })

    p1.send({
      header: {
        to: req.header.from,
        id: 11
      },
      payload: Buffer.from('response')
    })
    expect(await rxjs.firstValueFrom(c1.message$), {
      header: {
        to: req.header.from,
        from: valueOfType('string'),
        id: 11
      },
      payload: Buffer.from('response')
    })

    c1.send({
      header: {
        id: 2,
        service: { name: 's1', capabilities: ['c5'] }
      },
      payload: Buffer.from('request')
    })
    expect(await rxjs.firstValueFrom(c1.message$), {
      header: {
        id: 2,
        error: 'NO_PROVIDER s1'
      }
    })
  })

  test("load-balancing", async () => {
    const p2 = await makeProvider([{ name: 's1', capabilities: ['c1'] }])
    try {
      for (let i=0; i<10; i++) {
        c1.send({
          header: {
            id: i,
            service: { name: 's1', capabilities: ['c1'] }
          },
          payload: 'request'
        })
      }
      await Promise.race([
        Promise.all([
          rxjs.firstValueFrom(p1.message$),
          rxjs.firstValueFrom(p2.message$)
        ]),
        new Promise((f,r) => setTimeout(() => r(new Error('Load was not distributed as expected')), 500))
      ])
    } finally {
      p2.debug.connection.close()
    }
  })
  
  test("rate-limiting", async () => {
    assert(config.nonProviderRateLimit)
    for (let i=0; i<config.nonProviderRateLimit.limit; i++) {
      c1.send({
        header: {
          id: i,
          service: { name: 's1' }
        },
        payload: 'request' + i
      })
      expect(await rxjs.firstValueFrom(p1.message$), {
        header: {
          from: valueOfType('string'),
          ip: localIp,
          id: i,
          service: { name: 's1' }
        },
        payload: 'request' + i
      })
    }
    c1.send({
      header: {
        id: 1000,
        service: { name: 's1' }
      },
      payload: 'limited request'
    })
    expect(await rxjs.firstValueFrom(c1.message$), {
      header: {
        id: 1000,
        error: 'TOO_FAST'
      }
    })
  })
})


describe("pub-sub", ({ beforeEach, afterEach, test }) => {
  let s1: Endpoint, s2: Endpoint, p1: Endpoint

  beforeEach(async () => {
    [s1, s2, p1] = await Promise.all([
      makeProvider([{ name: '#t1', capabilities: ['c1'] }]),
      makeProvider([{ name: '#t1', capabilities: ['c1', 'c2'] }]),
      makeClient()
    ])
  })

  afterEach(() => {
    s1.debug.connection.close()
    s2.debug.connection.close()
    p1.debug.connection.close()
  })

  test("publish-subscribe", async () => {
    p1.send({
      header: {
        id: 2,
        service: { name: '#t1', capabilities: ['c1', 'c2'] }
      },
      payload: Buffer.from('notification')
    })
    expect(await rxjs.firstValueFrom(s2.message$), {
      header: {
        from: valueOfType('string'),
        ip: localIp,
        id: 2,
        service: { name: '#t1', capabilities: ['c1', 'c2'] }
      },
      payload: Buffer.from('notification')
    })

    p1.send({
      header: {
        id: 1,
        service: { name: '#t1' }
      },
      payload: 'notification'
    })
    expect(await Promise.all([
      rxjs.firstValueFrom(s1.message$),
      rxjs.firstValueFrom(s2.message$)
    ]), [{
      header: {
        from: valueOfType('string'),
        ip: localIp,
        id: 1,
        service: { name: '#t1' }
      },
      payload: 'notification'
    }, {
      header: {
        from: valueOfType('string'),
        ip: localIp,
        id: 1,
        service: { name: '#t1' }
      },
      payload: 'notification'
    }])
  })
})


describe("endpoint-healthcheck", ({ beforeEach, afterEach, test }) => {
  let c1: Endpoint, p1: Endpoint

  beforeEach(async () => {
    [c1, p1] = await Promise.all([
      makeClient(),
      makeProvider([{ name: 's1' }])
    ])
    c1.send({
      header: {
        id: 1,
        service: { name: 's1' }
      }
    })
    const req = await rxjs.firstValueFrom(p1.message$)
    expect(req, {
      header: {
        from: valueOfType('string'),
        ip: localIp,
        id: 1,
        service: { name: 's1' }
      }
    })
    c1.id = req.header.from as string
  })

  afterEach(() => {
    c1.debug.connection.close()
    p1.debug.connection.close()
  })

  test("endpoint-status-request", async () => {
    p1.send({
      header: {
        id: 2,
        type: "SbEndpointStatusRequest",
        endpointIds: [c1.id, 'crap']
      }
    })
    expect(await rxjs.firstValueFrom(p1.message$), {
      header: {
        id: 2,
        type: "SbEndpointStatusResponse",
        endpointStatuses: [true, false]
      }
    })
  })

  test("wait-endpoint", async () => {
    p1.send({
      header: {
        id: 3,
        type: "SbEndpointWaitRequest",
        endpointId: c1.id
      }
    })
    await new Promise(f => setTimeout(f, 100))
    c1.send({
      header: {
        id: 4,
        service: { name: 's1' }
      }
    })
    expect(await rxjs.firstValueFrom(p1.message$), {
      header: {
        from: c1.id,
        ip: localIp,
        id: 4,
        service: { name: 's1' }
      }
    })
    await new Promise(f => setTimeout(f, 100))
    c1.debug.connection.close()
    expect(await rxjs.firstValueFrom(p1.message$), {
      header: {
        id: 3,
        type: "SbEndpointWaitResponse",
        endpointId: c1.id
      }
    })
  })

  test("auth-token", async () => {
    assert(config.providerAuthToken)
    const endpoint = await makeClient()
    try {
      endpoint.send({
        header: { id: 1, type: "SbAdvertiseRequest", services: [{ name: 's1' }] }
      })
      expect(await rxjs.firstValueFrom(endpoint.message$), {
        header: { id: 1, error: 'FORBIDDEN' }
      })
    } finally {
      endpoint.debug.connection.close()
    }
  })
})
