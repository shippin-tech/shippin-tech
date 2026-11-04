# account

Control plane screen for accounts. The route calls `registryGet('Account')`, which posts `x:Account/get` to `/jmap`.

Sign-in for a mailbox user is `catalog/login`, not this screen.
This folder does not fetch.
Kernel: `ui/src/lib/ai-runtime/control-plane/threads/account/instruction.md`.
