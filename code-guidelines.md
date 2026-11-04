
This file sets general code principles to follow and to check in code reviews.

- Work on one feature at a time. Stay focused.
- DRY KISS and minimal edits for a feature.
- Core UI must be robust and low-latency.
- Prefer modular code with fewer dependencies. This is better for code reuse, testing, clarity, and maintenance.
- Avoid heavily nested functions. Avoid long functions. If these occur, refactor to use a helper function. 
- Avoid very slim wrapper/helper functions when a more direct call would be clearer.

## Comments and Docs

Comments and docs help with specification, testing, and maintenance. Please write them as you work, but avoid obvious comments or filler. Keep them brief. A clear reference to a key bit of code is often better than an explanation.

Keep comments and docs up to date so they are accurate. 
Avoid editing existing comments and docs except when needed to keep them up to date and accurate, or if asked by the user.

Every code and script file should have a comment stating its purpose.

Constant values, especially opaque IDs, should have a comment for maintenance: the why behind numbers, and the provenance for an ID.

Lifecycle flows (init, clean-up), and data-storage sequencing (when data is created and updated), are worth a comment to clarify expected behaviour.

## Tests

Create basic unit tests, integration tests, and E2E tests as you go.
Check tests pass after chunks of work.
Do not aim for full coverage. Partial coverage with brief notes on gaps is fine.
Tests should be robust, and expected to always pass.

## Typescript style

- Avoid making two similar interfaces. Prefer reusing one interface with some optional fields.
