# playbook

A phase-driven walkthrough of offensive security. Engagement-aware,
ATT&CK-mapped, with an auto-derived attack graph and BYOK CVE
enrichment. Static export, no backend, runs anywhere.

> **Status: alpha.** Coverage is uneven — Active Directory and a
> handful of web/cloud stacks are deep, most others are shallow or
> empty. Treat this as a starting frame to iterate on, not a
> comprehensive replacement for established methodology references.
> See [`ROADMAP.md`](./ROADMAP.md) for the path to 1.0.

## What this is

A guided pentest workflow built around three filter axes:

- **Engagement type** — bug-bounty / private / lab. Gates legal /
  scope / safety considerations, plus what tooling is fair game.
- **Target OS** — linux / windows / mixed. Hides OS-specific
  commands that don't apply.
- **Tech stack** — multi-select tags (Apache, WordPress, Postgres,
  Kerberos, AWS, Kubernetes, …). Drives which steps and commands
  surface within each phase.

Five phases (recon → vuln → exploit → post-ex → defense), each with
a goal, pre-checks, sequenced steps, and copy-ready commands.

## What this isn't

- Not a vulnerability scanner. It nominates checks — you run them.
- Not a Burp/Metasploit replacement. The playbook organizes what
  to do; the actual tools live outside.
- Not a teaching tool first. Assumes the user knows enough pentest
  fundamentals to read a command and judge its appropriateness.
- Not a substitute for a written report. The session snapshot is
  engagement state, not deliverable content.

## Features that already work

- **Auto-derived attack-graph map.** Hosts → recon-tools →
  services → finding-tools → findings, derived from your ticked
  commands. Drag to rearrange (subtree-aware), pan/zoom, export
  as SVG or PNG.
- **Per-command "ran" attribution.** Activity over completion:
  the model is "I have / haven't ticked this command" — not "this
  step is done." Pentesting isn't linear and "done" was a
  fiction.
- **Defense thread-back.** Every ticked command's MITRE ATT&CK
  techniques roll up into a "you demonstrated X — here's the
  detection" surface.
- **Session snapshots.** Export the entire session as JSON, share
  via a URL fragment (`#s=...`), import on another browser to
  resume. Pairs with `/api/methodology.json` for catalog +
  session round-trip.
- **BYOK CVE enrichment.** Configure NVD / EPSS / OSV / VulnCheck
  / Custom-internal-DB profiles. CVE-bearing finding nodes get a
  "lookup" chip that fans out across enabled providers and
  displays merged best-of summary + per-profile cards. Keys live
  in your browser's localStorage; this app has no backend so we
  can't see them.
- **Cross-cutting search.** Search the whole catalog (phases,
  steps, commands, tools, ATT&CK techniques) at once.

## Stack

- Next.js 15 App Router (`output: 'export'` — fully static)
- React 19 + Motion
- Tailwind v4 with `@theme` color tokens (pure black aesthetic)
- TypeScript, no test framework yet (added during M2 of the
  roadmap)

## Develop

```bash
npm install
npm run dev
# open http://localhost:3000
```

Build:

```bash
npm run build       # produces ./out/ (static)
npm run typecheck   # strict mode
```

## Deploy

Drop `out/` onto any static host. Tested targets:

- Vercel / Netlify / Cloudflare Pages — works out of the box
- Caddy / nginx — point root at `out/`, enable `try_files`-style
  index resolution (or rely on `trailingSlash: true` + per-dir
  `index.html`)
- A VPS with Caddy is the long-term plan; see angst.rocks's
  `scripts/server-caddy.sh` for a reference setup if you're
  rolling your own.

## Embed in another site

This is currently a standalone Next.js app. Embedding into a
parent site is on the roadmap (extract `<Playbook />` into an npm
package). For now: deploy this app to its own subdomain (e.g.
`playbook.your-domain.com`) and link or iframe from the parent.

## Privacy

- BYOK API keys live in `localStorage` on your device. They are
  sent only to the endpoint configured for each profile.
- The session snapshot does **NOT** include BYOK keys, so sharing
  a snapshot URL or downloaded JSON cannot leak them.
- The app has no backend. There is no server log of your
  engagement state, your target, or your scratch values. Whatever
  is in your browser stays in your browser.

## Catalog contributions

Contributions to the catalog (`lib/methodology.ts` +
`lib/tech-tags.ts`) are welcome. Per the alpha-window rule,
**no new framework features unless they unblock content
authoring** — coverage is the bottleneck. See
[`TODO.md`](./TODO.md) for the priority list and
[`ROADMAP.md`](./ROADMAP.md) Appendix for the "ready for a new
tech tag" checklist.

## License

TBD.
