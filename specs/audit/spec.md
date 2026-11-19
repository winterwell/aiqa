
Logging could be used for surveillance, and traces can contain private data.

TODO 
To provide accountability:

User actions in the webapp are records in an immutable audit log.

Audit log events are created for:

 - traces: search
 - organisation: add/remove member

Other auditable events may be added later.

Each audit log event records: timestamp, organisation-id, user-id, object-type, action, action-details
E.g.
2026-11-04T13:37:24, 1234, 5678, trace, search, "sex"

The webapp allows viewing (and searching) of audit log records.
Navigation: The Audit Log page is reached from a link on the Organisation page.
