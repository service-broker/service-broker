[![Build Status](https://travis-ci.org/ken107/service-broker.svg?branch=master)](https://travis-ci.org/ken107/service-broker)

### What Is This?
This is a reference implementation of a [Service Broker](https://github.com/ken107/service-broker/wiki/Specification).

### Starting the Service Broker
To start the broker: `npm start`.
To configure the broker: `vi .env`.

Environment Var         | Type   | Description
----------------------- | ------ | --------------------------------------------------
LISTENING_PORT          | Number | HTTP/WebSocket listening port
ALLOWED_ORIGINS         | RegExp | Allowed CORS origins
PROVIDER_KEEP_ALIVE     | Number | WebSocket ping/pong interval for service providers
NON_PROVIDER_KEEP_ALIVE | Number | WebSocket ping/pong interval for clients
