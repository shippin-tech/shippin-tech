# calendar

The calendar at `/calendar`: month and agenda views, several calendars with show and hide, create, edit and delete events, all-day and repeating events, guests invited by email, and replies.

The server side is JMAP `Calendar` and `CalendarEvent` (`crates/jmap/src/calendar`, `crates/jmap/src/calendar_event`). Calls live in `ui/src/lib/adapter/events.ts`, pure helpers in `events-call.ts`. This folder does not fetch; the route joins them and emits the `calendar.*` events after the server confirms. The "Use your calendar" lesson finishes on those events.

Listing uses `expandRecurrences`, so each occurrence has its own id, `utcStart` and `utcEnd` and the page needs no time zone arithmetic. Editing loads the stored event by `baseEventId`: a repeating event is edited as a whole, in its own time zone. Invitations and replies go out because every write sends `sendSchedulingMessages`.

Kernel: `ui/src/lib/ai-runtime/mail/kernel/instruction.md`.
