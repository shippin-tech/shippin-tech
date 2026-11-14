# file

Drive at `/files`: browse folders, upload (button or drag and drop), download, new folder, rename, move, delete, search by name, storage used.

Sharing: anyone with the share right can give people on their domain view or edit access; a folder's sharing always covers everything inside it, and something moved into a folder takes on that folder's sharing. What others share appears under "Shared with me", browsed through `?drive=<accountId>&folder=<id>`; buttons appear only where `myRights` allows them.

The server side is JMAP `FileNode` in `crates/jmap/src/file`, which also enforces each person's storage limit and the per-file limit. Calls live in `ui/src/lib/adapter/drive.ts`, pure helpers in `drive-call.ts`. This folder does not fetch; the route joins them and emits the `drive.*` events after the server confirms each action. The "Use your Drive" lesson finishes on those events.

Listing the top of Drive uses the `isTopLevel` filter; a null `parentId` filter is rejected. An upload whose name is taken becomes "name (2)", so nothing is overwritten.

Kernel: `ui/src/lib/ai-runtime/mail/kernel/instruction.md`.
