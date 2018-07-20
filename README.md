[![Build Status](https://travis-ci.org/ken107/service-broker.svg?branch=master)](https://travis-ci.org/ken107/service-broker)

#### What Is This?
In microservices architecture, independent service providers connect to a central service broker and advertise their services.  When a client needs some service, it sends a request to the service broker, who picks a qualified provider and forwards the request to it.  All communication between client and provider go through the broker.  This module implements a service broker for NodeJS.

#### Starting the Service Broker
To start the broker: `node index.js`.
To configure the broker: `vi .env`.

#### Messaging Protocol
We use WebSocket as the base protocol.  Each message is a WebSocket binary message and contains two parts: a JSON-object header, followed optionally by a newline (LF) character and an arbitrary payload.

#### API for Service Providers
A service provider advertises its services by sending an empty-body message to the broker with the following header fields:
```javascript
{
	type: "AdvertiseRequest",
	services: [
		{
			name: "service-name",
			capabilities: ["capability-1", "capability-2", ...]
			priority: 1
		}
	]
}
```

> The broker will always pick a provider with a higher priority. If two providers specify the same priority, they will be randomly chosen.

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

#### API for Service Clients
To request service, a client sends a message to the broker.  The message's content is intended for the service provider.  But to allow the broker to pick a provider, the message's header must contain the following additional field:
```javascript
{
	"service": {
		name: "service-name",
		capabilities: ["capability-1", "capability-2", ...]
	}
}
```

> The broker will pick a service provider who supports ALL of the listed capabilities.  Note that the message SHOULD NOT contain a `to` header.

When the broker forwards a provider's response to the client, it will add a `from` header containing the provider's endpoint-id:
```javascript
{
	from: "endpoint-id"
}
```

To send subsequent messages to the _same_ provider, the client can specify the provider's endpoint-id in the `to` header.
```javascript
{
	to: "endpoint-id"
}
```

Clients can, of course, send messages to other clients by specifying their endpoint-ids in the `to` header.  How they discover each other's endpoint-ids is entirely up to the service providers.

#### Delivery Failure
When the broker fails to deliver a message for any reason, if the message contains an `id` header, the broker will send the following notification to the sender:
```javascript
{
	"id": "the message's id",
	"error": "reason for delivery failure"
}
```
