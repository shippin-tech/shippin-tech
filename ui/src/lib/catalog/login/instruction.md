# login

Screen source for the sign-in page the engine serves at `login.html`.

Rust still embeds `resources/html-templates/login.html.min.gz`. Edit this component. The gzipped page is replaced when `ui/` is built and the engine is pointed at that build.

Posts go through `ui/src/routes/(account)/login/+page.svelte`, which calls `ui/src/lib/adapter/auth.ts`. This folder does not fetch.

Endpoint: `POST /api/auth`.
Kernel: `ui/src/lib/ai-runtime/control-plane/threads/account/instruction.md`.
