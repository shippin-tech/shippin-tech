# Sharing a domain with Google Workspace (angrygaming.org)

> **Pre-release.** This is how to test the self-hosted server next to a Google
> Workspace domain without risking the mail that already works there. Google stays
> in charge of the domain throughout. Nothing here is for other people's mail yet.

The goal: everyone already on Google Workspace at `angrygaming.org` (including the
grandfathered free edition) keeps their Gmail, Drive and Docs unchanged, while new
addresses on the same domain live on the self-hosted server. Mail between the two
groups flows both ways once the domain is listed in `SPLIT_DOMAINS` (below). Each step can be undone by reverting one setting.

## Phase 0: a subdomain first (no Google changes)

Start on a subdomain such as `lab.angrygaming.org`. Google never sees it, so
nothing that works today can break.

1. Install the server (`deploy/README.md`) with `--hostname mail.angrygaming.org`, and
   add an A record for `mail.angrygaming.org` pointing at the server.
2. Sign in as the administrator and add the domain `lab.angrygaming.org`, or sign
   it up at `/signup` like a customer would.
3. Publish what `/manage` (or the portal's domain page) lists: MX to
   `mail.angrygaming.org`, SPF, both DKIM keys and DMARC, all on
   `lab.angrygaming.org`.
4. Create accounts such as `you@lab.angrygaming.org` and test everything there:
   webmail, mail apps, the free plan, backups and upgrades.

## Phase 1: the same domain, Google first ("split delivery")

Once phase 0 is boring, put self-hosted accounts directly on `angrygaming.org`.
Google stays the domain's mail entry point (MX unchanged). Mail Google does not
recognise is passed on to your server.

**In the Google Admin console** (as a super admin):

1. *Apps → Google Workspace → Gmail → Hosts:* add a host named `self-hosted`,
   `mail.angrygaming.org`, port 25, with "Require secure transport (TLS)" checked
   once the server has a real certificate.
2. *Apps → Google Workspace → Gmail → Default routing:* add a setting that matches
   all recipients, changes the route to the `self-hosted` host, and is limited to
   **"Perform this action only on non-recognized addresses."**

Legacy free editions have shown these Gmail routing pages, but Google has changed
what legacy editions get. If yours does not show "Default routing", stay on phase 0.

**DNS for angrygaming.org** (only add to what Google already set up; never remove
Google's records):

| Record | Value |
| --- | --- |
| MX | unchanged: Google's |
| SPF (TXT at `@`) | one record listing both senders, for example `v=spf1 include:_spf.google.com ip4:<server IP> ~all` |
| DKIM | Google's `google._domainkey` stays; add the server's two selectors from the portal |
| DMARC (`_dmarc`) | `v=DMARC1; p=none; rua=mailto:<you>` while testing. Tighten only after both senders pass for a few weeks |

**On the server:**

1. Add the domain `angrygaming.org` in the portal as the administrator. Do not use
   `/signup`: that is for customers.
2. Create the self-hosted accounts (`newperson@angrygaming.org`). They must not also
   exist in Google, or Google keeps their mail.
3. **Do not turn on the domain's "allow relaying" setting.** It makes the server
   accept every unknown address on the domain from anyone. Google would pass the
   server mail for an address that exists on neither side, the server would pass
   it back to Google, and the message would loop.

**What works and what does not yet:**

| From | To | Today |
| --- | --- | --- |
| outside (another provider) | a Google user | Gmail, unchanged |
| outside | a self-hosted user | the server (Google passes it on) |
| Google user | self-hosted user | the server (Google passes it on) |
| self-hosted user | outside | delivered, with SPF, DKIM and DMARC passing once DNS is set |
| self-hosted user | Google user at the same domain | Delivered to Google, once the domain is listed in `SPLIT_DOMAINS` (below) |
| outside | an address nobody has | bounced by Google, then by the server; no loop |

**Turn on the missing direction.** Add the domain to `server.env` and update:

```
SPLIT_DOMAINS=angrygaming.org
```

For a domain listed there, an address the server does not hold is accepted only from someone signed in, and delivered to the domain's real MX, which is Google. Mail from the internet to such an address is still refused, so the two systems cannot pass a message back and forth. Listing a domain changes nothing else about it.

## Aliases that piggyback on Google

- An alias for someone in Google (`sales@` delivering to a Gmail user) is made in the
  Google Admin console as a user alias or group. Google recognises it, so it never
  reaches your server.
- An alias for someone on your server is made in `/manage` or the portal. Google does
  not recognise it and passes it on.
- One alias delivering to people on both sides is a Google group with the self-hosted
  person's address as an external member.

## Later: the server first (not during pre-release)

When the server is ready to be the entry point, MX moves to it and the direction
reverses: the server sends addresses it does not hold to Google (built on the same
`SPLIT_DOMAINS` setting), and Google's default routing is removed. Do this only after the release gate in `RELEASE.md` is
closed. Switching back is moving MX back.

## Google Drive and Docs (planned, not built)

The aim is for people to see and sync their Google Drive and Docs next to
`drive.<domain>`, and move files between them.

- **Sign-in to Google per person.** Each person connects their Google account with
  OAuth. For `angrygaming.org` the OAuth app can be "Internal" to your Workspace,
  which Google does not need to review.
- **Customers on other domains (the shippin fork).** That needs an "External" OAuth
  app. Google requires a verification, and for broad Drive access a security
  assessment, before strangers can connect. Plan for that before promising Drive sync
  to customers. The narrower `drive.file` scope (only files the app opened or
  created) avoids the heaviest review.
- **Sync.** Drive's changes feed keeps a per-person cursor; files map to `FileNode`
  entries on the server, storage counts against the mailbox quota, and conflicts keep
  both copies.
- **Docs.** Google Docs are not files: they are listed, opened in Google, and exported
  (PDF, DOCX) on request. Editing stays in Google until our own Docs exists.
- **Your whole organisation.** An administrator-level link (domain-wide delegation)
  comes after the per-person link, and only for your own Workspace.

Order of work: `ui/AUDIT.md`, "What changes, in order", items 4 to 6.
