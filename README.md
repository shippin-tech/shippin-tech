# shippin.tech

Rust mail and groupware engine: SMTP, IMAP, JMAP, POP3, ManageSieve,
CalDAV and CardDAV. The scale image uses shared FoundationDB, S3 and NATS.

This directory is the application Git repository. Run Git commands here;
the parent directory is a separate empty repository. The adjacent `one-node`
directory contains local runtime data and is not source code.

`platform/` contains the imported Shippin infrastructure control plane and its
original panel baseline. The shared Svelte UI lives in `ui/`; the platform panel
is being migrated into it. See [platform provenance and status](platform/ABSORPTION.md).

See [server deployment](deploy/README.md) for test builds and server updates.
The GitHub Actions **Test container build** workflow builds on PRs and
publishes on pushes to `main` or manual runs. It publishes Linux amd64 only.

Local image build:

```sh
docker build -f Dockerfile.fdb -t shippin-scale:local .
```

The workflow becomes active after these files are committed and pushed and
Actions/package publishing are enabled. Builds use the current stable Rust
toolchain and moving builder dependencies; source rebuilds are not yet
bit-for-bit reproducible. Deploy using the resulting image digest.
