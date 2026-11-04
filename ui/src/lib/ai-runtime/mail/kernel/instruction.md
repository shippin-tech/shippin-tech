# mail

This kernel is the only door for AI work on mail.

Start here. Open one sub-thread. Do not invent a second path.

| Thread | Path |
| --- | --- |
| email | threads/email/instruction.md |
| mailbox | threads/mailbox/instruction.md |
| calendar | threads/calendar/instruction.md |
| contacts | threads/contacts/instruction.md |
| files | threads/files/instruction.md |

Rust owner: `crates/jmap`. HTTP: `/jmap`.
Adapter: `ui/src/lib/adapter`. Catalog does not fetch.
Screens that exist: `catalog/login`, `catalog/calendar-rsvp`.
Mail bodies that stay HTML: `catalog/calendar-invite`, `catalog/calendar-alarm`.
