Status: TODO

The clients should support only sending a fraction of traces for efficiency (of memory, bandwidth, and storage). 
They should support:

 - Sampling to a %, which should work to preserve or discard an entire trace (for example, using a hash of the trace-id to make a % in/out choice).
 If a trace will be discarded due to sampling, then clients should aim to minimise the memory use for that trace by not storing attributes.

 - Filtering at the span level, which would be done when closing a span.
 - Filtering at the trace level, which would be done when sending a trace.

Filters should use a chain, starting with include-all or exclude-all, then alternating exclude|include queries.
Queries can be a keyword across attributes, or a span.property:keyword, or a boolean combination. If the attribute-value is an object, then the keyword is checked against the json-string of the object.
Keywords are matched by case-insensitive includes - not exact-match.
E.g.
["exclude-all","attributes.gen_ai.tool.name:websearch AND attributes.gen_ai.tool.call.arguments:fish", "attributes.gen_ai.tool.call.arguments:shark"]
would include only if the WebSearch tool was used to search for "fish" (potentially with other words, but not "shark").

- Sampling and filtering can also be applied at the server level when traces are ingested.

## Sampling and filtering settings

Can be set by env vars, or can be set dynamically per-organization in the webapp.
Env-vars take priority if set.
Dynamic vars are the recommended way.

Env vars:

Client-side

AIQA_SAMPLING_RATE: [0-1] where 1 means keep all traces. Default: 1
AIQA_SPAN_FILTER: string[], default none = ["include-all"]
AIQA_TRACE_FILTER: string[], default none = ["include-all"]

Server side:

AIQA_SERVER_SAMPLING_RATE: [0-1] where 1 means keep all traces. Default: 1
AIQA_SERVER_SPAN_FILTER: string[], default none = ["include-all"]
AIQA_SERVER_TRACE_FILTER: string[], default none = ["include-all"]

Client and server side sampling and filtering can both apply - in which case they compound and only traces which pass both get stored.

For dynamic settings, clients should call the server to get and apply the latest settings.
This is controlled by client-side env vars:
AIQA_CHECK_SERVER_SETTINGS: true/false (default true)
AIQA_CHECK_SERVER_SETTINGS_FREQUENCY: cli duration format: m (minutes), h (hours), d (days) (default 1h)
