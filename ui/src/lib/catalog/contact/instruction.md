# contact

Contacts at `/contacts`: search, address books, create, edit and delete, and one-click writing through webmail (`/mail/compose?to=`).

The server side is JMAP `AddressBook` and `ContactCard` (`crates/jmap/src/addressbook`, `crates/jmap/src/contact`). Calls live in `ui/src/lib/adapter/people.ts`, pure helpers in `people-call.ts`. This folder does not fetch; the route joins them and emits the `contact.*` events after the server confirms. The "Keep your contacts" lesson finishes on those events. Sorting and search run in the browser on the full list. An update sends only the fields this form covers, so details added by another app are kept.

Kernel: `ui/src/lib/ai-runtime/mail/kernel/instruction.md`.
