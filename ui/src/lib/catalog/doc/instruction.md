# doc

Docs at `/docs` (list) and `/docs/edit?id=<id>` (editor, with `&drive=<accountId>` for someone else's document).

A document is an ordinary HTML file in Drive named `<title>.shdoc.html`, kept in a Documents folder at the top of Drive unless moved. So sharing, storage limits and WebDAV apply without any code here. The editor is TipTap with our own Svelte toolbar; it parses stored HTML against its schema, which drops anything that is not document content. Calls live in `ui/src/lib/adapter/docs.ts`, pure helpers in `docs-call.ts`.

Saving is automatic, one second after the last keystroke. Before each save the page compares the stored file with the one it opened; if someone else saved in between, nothing is written and the person chooses whose version to keep. Two people editing at the same moment do not merge; that needs real-time collaboration, which is not built.

Export is HTML, Word (HTML that Word opens) and the browser's print or save as PDF.

Kernel: `ui/src/lib/ai-runtime/docs/kernel/instruction.md`.
