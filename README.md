### What Is This?
This is a reference implementation of a [Service Broker](https://github.com/ken107/service-broker/wiki/Specification).

### Starting the Service Broker
To start the broker: `npm start`.
To configure the broker: `vi .env`.

Environment Var | Type | Default Value | Description
--------------- | ---- | ----------- | -----------
LISTENING_PORT | Number | | HTTP/WebSocket listening port
LISTENING_HOST | String | | (Optional) bind address
SSL_PORT | Number | | SSL listening port
SSL_HOST | String | | (Optional) SSL bind address
SSL_CERT | String | | SSL certificate file
SSL_KEY | String | | SSL private key file
ALLOWED_ORIGINS | RegExp | /./ | Allowed CORS origins
TRUST_PROXY | | | ExpressJS trust proxy configuration parameter
PROVIDER_AUTH_TOKEN | String | | (Optional) provider must include matching `authToken` in advertise request
PROVIDER_KEEP_ALIVE | Number | 15 seconds | WebSocket ping/pong interval for service providers
NON_PROVIDER_KEEP_ALIVE | Number | 15 minutes | WebSocket ping/pong interval for clients
