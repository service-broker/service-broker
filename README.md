[![Build Status](https://travis-ci.org/ken107/service-broker.svg?branch=master)](https://travis-ci.org/ken107/service-broker)

### What Is This?
In this microservices architecture, independent service providers connect to a central service broker and advertise their services.  When a client needs some service, it sends a request to the service broker, who picks a qualified provider and forwards the request to it.  All communication between client and provider go through the broker.  This module implements a service broker for NodeJS.

### Starting the Service Broker
To start the broker: `node ./dist/index.js`.
To configure the broker: `vi .env`.

Environment Var         | Type   | Description
----------------------- | ------ | --------------------------------------------------
LISTENING_PORT          | Number | HTTP/WebSocket listening port
ALLOWED_ORIGINS         | RegExp | Allowed CORS origins
PROVIDER_KEEP_ALIVE     | Number | WebSocket ping/pong interval for service providers
NON_PROVIDER_KEEP_ALIVE | Number | WebSocket ping/pong interval for clients

### Messaging Protocol
We use WebSocket as the base protocol.  Each message is a WebSocket message and has two parts: a JSON-object header, followed _optionally_ by a newline (LF) character and an arbitrary payload.

### API for Service Providers
A service provider advertises its services by sending an empty-payload message to the broker with the following header fields:
```javascript
{
    type: "SbAdvertiseRequest",
    services: [
        {
            name: "service-1",
            capabilities: ["capability-1", "capability-2", ...]
            priority: 50
        },
        {
            name: "service-2",
            capabilities: [...],
            priority: 20
        }
    ]
}
```

> For a particular service, the broker will always pick the provider with the highest priority. If two providers specify the same priority, one will be randomly chosen.

> A provider can indicate it supports ANY capabilities by omitting the `capabilities` field. 

When the broker forwards a client's request to the provider, it will add a `from` header containing the client's endpoint-id:
```javascript
{
    from: "endpoint-id"
}
```

To send a response to the client, the provider must specify the client's endpoint-id in the `to` header:
```javascript
{
    to: "endpoint-id"
}
```

### API for Service Clients
To request service, a client sends a message to the broker.  The message itself is intended for the service provider.  But to allow the broker to pick a provider, the message's header must contain the following additional field:
```javascript
{
    service: {
        name: "service-name",
        capabilities: ["capability-1", "capability-2", ...]
    }
}
```

> The broker will pick a service provider who supports ALL of the listed capabilities.

When the broker forwards a provider's response to the client, it will add a `from` header containing the provider's endpoint-id:
```javascript
{
    from: "endpoint-id"
}
```

To send subsequent messages to the _same_ provider, the client can specify the provider's endpoint-id in the `to` header:
```javascript
{
    to: "endpoint-id"
}
```

Clients can, of course, send messages to other clients by specifying their endpoint-id's in the `to` header.  How they discover each other's endpoint-id's is entirely up to the service providers.

### Delivery Failure
When the broker fails to deliver a message for any reason, if the message contains an `id` header, the broker will send the following notification to the sender:
```javascript
{
    id: "the message's id",
    error: "reason for delivery failure"
}
```

### PUB/SUB
When the service's name begins with the character `#`, the broker behaves slightly differently.  Rather than choosing randomly from the list of qualified providers having the same priority, the broker will broadcast the client's message to all of them.

### HTTP Adapter
The broker can accept service requests via HTTP on its listening port.  The HTTP request must have the following format:
```
POST /<SERVICE-NAME>?capabilities=<COMMA-SEP-LIST> HTTP/1.1
x-service-request-header: <OPTIONAL JSON-OBJECT>
Content-Type: <MIME-OF-PAYLOAD>

<PAYLOAD>
```

The broker will generate a WebSocket message from the HTTP request and send it to a qualified service provider.  Upon receiving a response from the provider, it will generate a corresponding HTTP response:
```
200 OK HTTP/1.1
x-service-response-header: <JSON-OBJECT>
Content-Type: <MIME-OF-PAYLOAD>

<PAYLOAD>
```
