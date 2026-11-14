# google

The Google Drive tab at `/files?view=google`: connect a Google account, browse My files and Shared with me, search, copy a file into Drive, download, export Google Docs, Sheets and Slides, open in Google, disconnect. In My Drive, To Google copies a file the other way.

The work is on the server (`crates/common/src/shippin/google.rs`, routes in `crates/http/src/shippin/google.rs`): the client secret and each person's tokens never reach the browser, and tokens are stored encrypted and bound to their account. Calls live in `ui/src/lib/adapter/google.ts`, pure helpers in `google-call.ts`. This folder does not fetch.

Copies are one-time, in either direction. Continuous two-way sync is not built.

Kernel: `ui/src/lib/ai-runtime/docs/kernel/instruction.md`.
