
# AIQA

## Client Libraries

See the repositories:

- Javascript / Typescript: https://github.com/winterwell/aiqa-client-js
- Python: https://github.com/winterwell/aiqa-client-python
- Go: https://github.com/winterwell/aiqa-client-go
- Java: https://github.com/winterwell/aiqa-client-java

## Architecture Overview

Using ElasticSearch as the storage database.
OpenTelemetry as the tracing system.

## The AIQA Servers

https://app-aiqa.winterwell.com - production webapp
https://aiqa.winterwell.com - production website AND proxy to the server

### Local Servers

http://localhost:4000 - local webapp
http://localhost:4318 - local server


## Deployment

For 24x7 deployment on Ubuntu with CI/CD, see [deploy/DEPLOYMENT.md](deploy/DEPLOYMENT.md).
