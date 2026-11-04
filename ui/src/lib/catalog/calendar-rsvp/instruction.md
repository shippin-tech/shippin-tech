# calendar-rsvp

Screen source for `calendar-rsvp.html`.

Rust still embeds `resources/html-templates/calendar-rsvp.html.min.gz`. Edit this component. The gzipped page is replaced when `ui/` is built and the engine is pointed at that build.

The route `ui/src/routes/(calendar)/rsvp/+page.svelte` calls `ui/src/lib/adapter/calendar.ts`. This folder does not fetch.

Query `i` is the token. Query `m` is a preset part-stat (`accepted`, `tentative`, `declined`).
Endpoint: `POST /api/calendar/rsvp`.
Kernel: `ui/src/lib/ai-runtime/mail/threads/calendar/instruction.md`.
