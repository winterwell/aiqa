A simple client-side web-app for viewing the server data
Connects to the server API and displays the data.

Language: typescript
React framework using Vite
Bootstrap CSS framework
Use Reactstrap for UI components where appropriate.

Use react-query and rerenderer for state management and updates.

Typical Flow:
- Make a User
- Make an Organisation
- Make an API Key
- Add tracing to code ...hence collect traces
- Make a Dataset from selected traces
- Add metrics to the Dataset and model-keys to the Organisation
- Run an Experiment on the Dataset using an ExperimentRunner client -- with AIQA providing LLM-as-judge scoring if needed
- View the Experiment results in the web-app

Pages:
- / Welcome / login
- /organisation/:organisationId Status page
- /organisation/:organisationId/traces list of traces
- /organisation/:organisationId/traces/:traceId trace details
- /organisation/:organisationId/dataset list of datasets
- /organisation/:organisationId/dataset/:datasetId dataset details
- /organisation/:organisationId/dataset/:datasetId/experiment/:experimentId experiment details

Provide deep-linking url support:

/organisation/:organisationId/dataset/:datasetId/experiment/:experimentId

Login using Auth0.

rerenderer makes it convenient to work with json objects as state, reducing the  useState/setState needed. Rerenderer is good for when editing the API-served-up data objects. useState is good for when editing local view parameters.

Run scripts:
npm run dev (watches for changes and recompiles, starts a local web-app server)
npm run build (compiles the code)

Package manager: pnpm

Code structure:
- src/common This is a sym-link to the server/common directory. This code is shared between the server and the web-app!
- src/app/ Most pages and components are in this directory.
