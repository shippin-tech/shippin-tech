# Platform baseline in shippintech

This directory contains the tracked maintained platform baseline from
`D:/localdev/shippin-platform`, commit
`013b8944ca4c5bbecc0ba4c6e5dee934be8aa501`. Its Go module remains
`shippin.cloud/console`, with the separate diagnostic module under `agent/`.
The original source checkout remains intact. The source project has not selected
a license; preserve its provenance and review dependency and asset rights before
redistribution.

`web/` is the original React panel, retained to keep the platform build and
behavior available while its features are ported into the repository's SvelteKit
application at `../ui/`. It is not evidence that the port is complete. The
control plane and mail engine remain separate processes with separate identity
and persistence until an integration is implemented and verified.

`SOURCE-AGENTS.md`, `.agents/`, and `.github/` preserve the source project's
instructions and workflows as historical reference. The root repository's
instructions govern this workspace, and workflows under `platform/.github/` are
not automatically run as repository-level GitHub Actions.

The baseline excludes local and generated files and the reference-only
`third_party/warden-ct102` tree. Its feature dispositions and any other omitted
source files remain in the [absorption ledger](../.ai/modules/plans/data/2026-11-07-platform-disposition.csv).
The source project documentation describes its own deployment and upstream CI;
those descriptions do not establish that this combined repository is deployed
or operational. Review installation-specific defaults before deployment.
