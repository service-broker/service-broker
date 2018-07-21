[![Build Status](https://travis-ci.org/ken107/service-broker.svg?branch=master)](https://travis-ci.org/ken107/service-broker)

### What Is This?
In microservices architecture, independent service providers connect to a central service broker and advertise their services.  When a client needs some service, it sends a request to the service broker, who picks a qualified provider and forwards the request to it.  All communication between client and provider go through the broker.  This module implements a service broker for NodeJS.

### Starting the Service Broker
To start the broker: `node ./dist/index.js`.
To configure the broker: `vi .env`.

### Messaging Protocol
We use WebSocket as the base protocol.  Each message is a WebSocket message and has two parts: a JSON-object header, followed _optionally_ by a newline (LF) character and an arbitrary payload.

### API for Service Providers
A service provider advertises its services by sending an empty-payload message to the broker with the following header fields:
```javascript
{
    type: "AdvertiseRequest",
    services: [
        {
            name: "service-1",
            capabilities: ["capability-1", "capability-2", ...]
            priority: 50
        },
        {
            name: "service-2",
            capabilities: undefined,   //all capabilities are supported
            priority: 20
        }
    ]
}
```

> The broker will always pick the provider with a highest priority. If two providers specify the same priority, one will be randomly chosen.

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
        capabilities: ["capability-1", "capability-2", ...]     //optional
    }
}
```

> The broker will pick a service provider who supports ALL of the listed capabilities.  If `capabilities` is omitted, any provider will match.

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

#### Delivery Failure
When the broker fails to deliver a message for any reason, if the message contains an `id` header, the broker will send the following notification to the sender:
```javascript
{
    id: "the message's id",
    error: "reason for delivery failure"
}
```
