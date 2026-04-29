# playbook

> **Abandoned. Successor:** [`pb3ck/quarry`](https://github.com/pb3ck/quarry).
>
> This repo is preserved for archaeology — no further development. The
> approach pivoted: a curated phase-by-phase walkthrough turned out to
> be the wrong shape; the next attempt is an evidence-aware reasoning
> layer over the artifacts a hunter actually produces, not a
> hand-curated methodology framework. If you landed here looking for
> active work, go to **Quarry**.

## What this was

A static-export Next.js app that surfaced a curated pentest workflow
filtered by three axes (engagement type / target OS / tech tags). Five
phases (recon → vuln → exploit → post-ex → defense), each with
goal, pre-checks, sequenced steps, and copy-ready commands. Optional
features layered on top: an auto-derived attack-graph map, defense
thread-back via local MITRE ATT&CK bundle, BYOK CVE enrichment, on-demand
AI assistance for catalog gaps, and a continuous-fill workflow that
opened weekly PRs growing the catalog autonomously.

The tool worked. It just turned out to solve a problem that, for
serious bounty hunters at least, isn't the bottleneck.

## Why it was abandoned

Three lessons informed the pivot to Quarry:

1. **A hand-curated methodology catalog is the wrong unit of leverage.**
   Catalog content is a sliding gauge that's never "done." Hitting 100%
   coverage across 18 tag stacks × 5 phases would have meant ~900
   commands, all hand-validated, all kept current as tools and CVEs
   churn. Even with the AI authoring CLI + the continuous-fill
   workflow getting that to 8/18 tags ready in a few sessions, the
   marginal utility of the next 10 tags wasn't worth the maintenance
   debt of the first 8.

2. **Real engagements are evidence-driven, not procedure-driven.**
   The "I've followed steps 1-7 of the recon phase" model doesn't
   match how good hunters work. They respond to *what their tools
   actually surfaced*: a weird endpoint in the katana crawl, a
   reference to `/admin` in a JS bundle, a 502 that suggests a
   misconfigured proxy. A linear walkthrough is for training; an
   evidence index is for working.

3. **The most useful AI surface wasn't "fill catalog gaps" — it was
   "reason over my data."** The on-demand AI Assist surface in
   Playbook had to be carefully scoped (closed MITRE vocabulary,
   tool inventory injection, three layers of "AI-generated" disclosure)
   because it was generating *advice* for a specific situation. The
   higher-leverage version of that idea is to feed the model your
   actual recon corpus and let it answer questions grounded in your
   evidence — which is what Quarry is.

Quarry's README is explicit about this:

> Not a methodology framework. If you want a phase-by-phase
> walkthrough, use a different tool. Quarry assumes you already
> know what you're doing and want leverage on the parts that don't
> scale: reading, cross-referencing, and remembering.

That sentence is essentially Playbook's epitaph.

## What worked here (worth carrying forward)

If you fork this repo or rebuild parts of it, these were the design
ideas that did pull weight:

- **Three filter axes (engagement / OS / stack) gating visibility.**
  Solved the "show only what's relevant to me" problem cleanly.
- **Activity over completion.** Per-command `ran` ticks +
  visited-step tracking, no fake "phase X% done" gauges. Honest
  signal.
- **Local-first MITRE bundle.** Subset of the canonical STIX bundle,
  scoped to only the technique IDs referenced in the catalog.
  Bundled at build time (~14 KB), no runtime network.
- **BYOK pattern with explicit privacy posture.** Keys in
  localStorage, never sent to the static-export server (because
  there isn't one). Applied uniformly across CVE enrichment + AI
  generation profiles. Reused in Quarry.
- **Provenance separation in the UI.** Catalog-derived nodes use
  service-color edges; AI-generated nodes use warn-amber across
  the board. Three layers of "this is AI" disclosure (badge,
  border, edge color, export annotation). The user always knows
  what they're looking at.
- **`ai:draft` + `ai:apply` maintainer pipeline.** Drafted
  candidates with closed-vocabulary prompts (real MITRE IDs, real
  tool names from the catalog), placed them via AI-suggested step
  matching, ran typecheck, reverted on failure. The maintainer
  reviewed a `git diff` instead of writing TypeScript. Cohesion
  win that survived the pivot in spirit.
- **Continuous-fill workflow.** Weekly GitHub Action that ran the
  draft+apply pipeline against the lowest-coverage gap and opened
  a PR. Never enabled in practice (no `ANTHROPIC_API_KEY` secret
  was added to the repo) but the architecture is sound.

## What didn't work

The lessons that informed Quarry, more concretely:

- **Curated catalog content was a treadmill.** Even with AI
  acceleration, every new tool / CVE / framework version meant
  catalog drift. Tools renamed (cvemap → vulnx during this
  project). CVE syntax changed. Detection rules went out of date.
  The catalog needed perpetual maintenance to stay accurate, and
  accuracy was the entire trust signal.
- **The `validated:` field never moved off 0%.** The whole
  authoring pipeline was designed to make lab-validation cheap —
  per-command `validated: { on, notes? }` annotations,
  staleness-aware UI badges, coverage-report column. Nobody
  validated anything because nobody had a lab box hooked up to
  the loop. Coverage gauges climbed; trust signal stayed flat.
- **The Map was rich but rarely the bottleneck.** Auto-derived
  attack graph with color-coded service ancestry, drag-with-subtree,
  pan + zoom + scroll-wheel + SVG/PNG export, AI-derivation
  layered on top with amber treatment. Nobody used it for real
  decisions. The information was already in the focus view; the
  Map was a viz layer that demoed well but didn't change behavior.
- **Phase ordering implied linearity it never had.** Recon → vuln
  → exploit → post-ex → defense is fiction. Real work loops
  between recon and exploit constantly. The Coverage Pulse banner
  helped, but the underlying focus-view "what phase am I on"
  framing was always slightly wrong for how engagements actually
  flow.

## Final state

Last working build at the time of abandonment:

| | |
|---|---|
| Tags ready (≥5 cmds, ≥3 phases, ≥1 tagged tool, ≥1 MITRE) | **8 / 18** |
| Total commands | **165** |
| Site-wide MITRE coverage | **41%** |
| Lab-validated commands | **0%** *(see lessons above)* |
| Local MITRE techniques bundled | 47 (~14 KB) |
| Catalog tools | 78 |
| Catalog phases × steps | 5 × 29 |
| Last commit | `996ba95` (AI generations flow into the Map) |

Run it locally if you want to see the artifact:

```bash
npm install
npm run dev
# http://localhost:3000
# Click "load example engagement" in the welcome modal for a
# pre-populated Windows AD demo.
```

## Stack (snapshot at abandonment)

- Next.js 15 App Router (`output: 'export'` — fully static)
- React 19 + Motion
- Tailwind v4 with `@theme` color tokens (pure black aesthetic)
- TypeScript strict mode
- MIT license

## Maintenance scripts (still functional)

These were never deleted. If you fork this repo, they still work
with `ANTHROPIC_API_KEY` set in `.env.local`:

```bash
npm run coverage          # per-tag + per-phase coverage report
npm run ai:draft          # AI-draft candidate commands for a gap
npm run ai:apply          # auto-merge a draft YAML into the catalog
npm run validate          # interactive triage of a draft
npm run sync:mitre        # refresh the local MITRE bundle
npm run check:sources     # HEAD-check every tool URL for link rot
npm run autofill:next     # pick a gap + draft + apply, one shot
```

`.github/workflows/autofill.yml` was never enabled (the
`ANTHROPIC_API_KEY` repo secret was never added). It would have
opened weekly PRs against the lowest-coverage gap; if you fork and
want the loop, add the secret and it works.

## Where to go from here

- **Active work**: [`pb3ck/quarry`](https://github.com/pb3ck/quarry).
  Local-first evidence indexer + LLM reasoning layer. Rust, AGPL.
  The actual problem this attempt was reaching for.
- **Fork this repo** if you want a curated-walkthrough scaffold to
  build something else on. The Next.js skeleton, the BYOK pattern,
  the MITRE sync, and the AI-draft/apply pipeline are all reusable.
- **Read the commit history** if you're curious about the
  evolution. 14 commits across one productive day; the trajectory
  from "manual catalog" to "self-filling pipeline" is in there.

## License

MIT — see [`LICENSE`](./LICENSE). Use it, fork it, mine it for
parts. Just keep the copyright notice.
