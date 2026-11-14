# shippin.tech

> **Pre-release. Not production.** Nothing here is supported for real users' mail.
> Interfaces, data layouts and settings change without migration or notice, and data
> on test installs can be lost. Do not host anyone else's mail on it. The release gate
> is [RELEASE.md](RELEASE.md); pull requests are closed automatically until the AI
> working system in [mcpl/](mcpl/README.md) is accepted (see [AGENTS.md](AGENTS.md)).

Rust mail and groupware engine: SMTP, IMAP, JMAP, POP3, ManageSieve,
CalDAV and CardDAV. The scale image uses shared FoundationDB, S3 and NATS.

This directory is the application Git repository. Run Git commands here;
the parent directory is a separate empty repository. The adjacent `one-node`
directory contains local runtime data and is not source code.

`platform/` contains the imported Shippin infrastructure control plane and its
original panel baseline. The shared Svelte UI lives in `ui/`; the platform panel
is being migrated into it. See [platform provenance and status](platform/ABSORPTION.md).

See [server deployment](deploy/README.md) for installs and updates. Work happens
on one branch, `main`. Every push runs **Check** (brand, portal type-check,
unit and mocked browser tests, the deploy-script tests, and `cargo check` when
Rust changes). **Test container build** runs only for a `v*` tag or when started
by hand; a hand-started build publishes `sha-<commit>` only and never moves the
`release` channel. Images are Linux amd64.

Local image build:

```sh
docker build -f Dockerfile.fdb -t shippin-scale:local .
```

The workflow becomes active after these files are committed and pushed and
Actions/package publishing are enabled. Builds use the current stable Rust
toolchain and moving builder dependencies; source rebuilds are not yet
bit-for-bit reproducible. Deploy using the resulting image digest.
