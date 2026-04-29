# playbook — TODO

Living queue of UI/UX + content/data work. Exists so a fresh Claude
session (or you, after a week off) can resume without re-deriving
context. Cross items off as they ship. The strategic out-of-alpha plan
lives in [`ROADMAP.md`](./ROADMAP.md); this file is tactical only.

If you're Claude reading this for the first time in a new session: read
top to bottom; don't skip the "context for new sessions" block.

---

## Context for new sessions (read first)

- This repo is the **playbook** — a standalone Next.js 15 / React 19 /
  Tailwind v4 / Motion app. Static export (`output: 'export'`),
  deployable to any static host. Originated as `/playbook` inside
  angst.rocks; extracted into its own repo on 2026-04-29 to keep
  scaling without being shackled to that site's chrome.
- The app is a structured pentest walkthrough with three filter axes:
  1. **engagement** — `bug-bounty | private | lab` (legal/RoE context)
  2. **target OS** — `linux | windows | mixed`
  3. **tech tags** — `apache | nginx | wordpress | mssql | …` multi-select
- `/api/methodology.json` exposes the entire playbook dataset (~100 KB,
  `force-static`). Docs at `/api`. Fields exposed: `version`,
  `schema_version`, `generated`, `engagements`, `targetOSes`,
  `techTagGroups`, `tools[]` (deduped, with phase/step breadcrumbs),
  `phases[]` (with `name`, `label`, `slug`, `goal`, `blurb`, `team`,
  `tags`, `preChecks`, `steps`, `output`).
- Aesthetic constraints (per `~/.claude/.../MEMORY.md`):
  - Pure black, not blue-black. Avoid Tailwind `slate` / `zinc`.
  - Minimalist animation tone — subtle, pervasive.
  - No "AI cosplay" copy ("built in the dark", lowercase-as-personality,
    decorative mono eyebrows). Keep it plain.
  - Mobile-first is its own design pass, not shrunk desktop.
- Workflow: edit → `npx tsc --noEmit` → `npx next lint` → `npx next build`
  → commit (with `Co-Authored-By: Claude Opus 4.7 (1M context)` trailer)
  → `git push origin main`.

---

## UI / UX consistency

The API now exposes more than the UI surfaces. These are gaps where the
shell + focus view don't reflect everything `/api/methodology.json`
returns, plus places where the UI is confusing.

### High value (do first)

- [ ] **Hidden-by-filter count** on Commands and Tools sub-tabs.
      When filters reduce a step's commands from 15 → 3, show
      `12 hidden by your filters · adjust` with a clickable hint
      pointing at the context panel. Currently: silent shrinkage.
- [ ] **Strict-mode hint** on `requiresTechSelection: true` steps.
      Fingerprint shows only the 2 generic probes when no tags are
      picked — the 13 per-tech probes vanish without explanation.
      Add a short "Pick a stack on the right to surface per-tech
      probes" prompt inside the Commands tab when `requiresTechSelection`
      and `selectedTechTags.length === 0`.
- [ ] **Engagement `scopeNote`** — legal/RoE reminder is in the data
      (every engagement entry carries it), never displayed. Surface
      it at the top of the focus view or under the engagement chip in
      the shell. Especially important for `private` (signed RoE) and
      `bug-bounty` (program scope page).
- [ ] **Phase `output`** — every phase has an `output` string ("what
      this phase produces") that's not displayed anywhere. Surface
      it inline at the top of the phase, or as a tooltip on the
      "phase complete" CTA.
- [ ] **Tech-tag chip in shell** — currently the shell shows engagement
      + OS as one combined chip. Tech tags (the third axis) only
      show in the right-side context panel. Either add a tech-tag
      summary chip ("3 tags") or unify all three axes into one chip.
      Pick one consistent pattern; the current asymmetry is the
      confusing bit.

### Medium

- [x] ~~Reset access from outside the welcome~~ — done. Inline
      "reset all playbook data" link at the bottom of the context
      panel; two-stage confirm to avoid accidental wipes.
- [x] ~~Cheat-sheet export from UI~~ — done. "↓ export" chip in the
      shell next to the engagement chip. Builds a Markdown file
      filtered to the current axes, with `{target}` / per-tag
      `{version}` / scratch tokens already interpolated.
- [x] ~~"What changed?" diff hint~~ — done. Inline `+N · −N
      commands in this phase` toast appears in the stack panel
      header on every tag toggle, auto-dismisses after 2.4s.
      Phase-scoped count so the signal stays focused.
- [ ] **Mobile-first review of context panel.** Currently stacks
      below the step card on small screens. Probe at 375px / 414px
      / iPhone landscape — make sure the panel isn't a buried
      afterthought. (Needs visual testing — defer to a real-device
      pass.)
- [x] ~~Per-step `team` indication~~ — decided: keep hidden. The
      defense thread-back panel (added in this session) makes the
      defense phase materially distinct from the offense phases, so
      the team distinction is now visible by design. A header glyph
      would be redundant with the phase name + the panel.

### Low / future

- [x] ~~Pin a step~~ — done. `◇ auto` / `◆ pinned` toggle next to
      the phase reset action in the step strip. Pinned mode keeps
      focus on the manually-chosen step even after you mark it
      complete.
- [x] ~~Per-step persistent notes~~ — done. Notes drawer below the
      sub-tabs on every step, collapsed by default. Persists per
      stepId; survives reset only via the explicit "reset all"
      action. A small "·" appears in the header when content
      exists so the user knows there's saved content even when
      collapsed.
- [ ] **Diff view across axis changes.** Toggle a tag and highlight
      which commands appeared/disappeared in animation. Onboarding
      win.

---

## Catalog content (data-only, no code)

From the Windows-AD simulation (sim 4) and the post-audit cull:

- [x] ~~Audit empty tags~~ — done. Dropped 15 tags with zero
      content and no clear plan. Catalog now has 18 tags, all
      with content or a deliberate "to populate" plan.
- [x] ~~AD-protocol probe pack~~ — done. `kerberos` + `ldap`
      now carry 16 / 11 commands respectively across recon
      (enum4linux-ng, GetNPUsers, ldapsearch anon, DC SRV) and
      post-ex (certipy, Rubeus, lsassy, kerberoast, AS-REP roast,
      DCSync, Golden Ticket).
- [x] ~~AD-CVE family~~ — done. Zerologon, PrintNightmare, NoPac,
      Certifried/ESC8 + an AD-tagged nuclei sweep added to vuln
      phase. SpecterOps ADCS reference linked as a tool.
- [x] ~~Modern Windows post-ex~~ — done. certipy (ESC1 cert
      request + PKINIT auth), Rubeus, lsassy, DCSync via
      secretsdump (`-just-dc-user krbtgt`), Golden Ticket forging
      via impacket-ticketer.
- [x] ~~Cloud probe pack~~ — done. AWS / GCP / Azure each with
      bucket-fingerprint + IMDS probes (recon) and current-identity
      enumeration (post-ex). prowler / pacu / ScoutSuite added as
      tools; k8s gets `kubectl auth can-i` + `kubectl-who-can`.
- [ ] **Tomcat / Django / Flask back as needed.** Removed in audit
      pass 1, but if real per-framework commands materialize
      (Tomcat manager, Django debug pages, Flask debug console),
      add them back with content.
- [ ] **Backfill `mitreTechniques` across the rest of the catalog.**
      Today's coverage is just AD post-ex (kerberoast, AS-REP roast,
      DCSync, lsassy, certipy, Golden Ticket). Recon enumeration,
      vuln scanning, exploit delivery, lateral movement all
      deserve technique IDs to unlock the defense thread-back.

---

## Contribution rules — what gets in, what doesn't

Aimed at staying out of the dumping-ground future state. Each entry
is a question to ask before merging a new command, tool, or tag.

1. **Does this solve a "the user has to leave the playbook" gap?**
   If the user can do the same thing with one of the 5 already-listed
   nuclei variants, don't add a sixth.
2. **Is it tag-scoped enough to be precise?** A new command that
   targets `nginx + linux` is good. A generic "`nmap -sV`" variant
   is dilution.
3. **Does the maintainer actually run this?** The voice of the playbook is
   "what an offensive-security practitioner uses in real
   engagements," not "what tools exist on the internet." Trust
   signal comes from authorship.
4. **Is it dated?** searchsploit / msf module names rot. If the
   command relies on a tool / module name that's been deprecated
   or renamed in the last 12 months, find a current variant first.
5. **Tag rules:** every new tag must ship with at least 3 entries
   on day one. No more empty-tag-with-future-plans. If a tag is
   conceptually right but content isn't ready, hold the tag.

---

## API additions (small + leveragable)

- [x] ~~`mitreTechniques: string[]` on commands~~ — done. Field on
      the type; ATT&CK IDs populated for AD post-ex commands
      (T1558.003 kerberoast, T1558.004 AS-REP, T1558.001 Golden
      Ticket, T1003.006 DCSync, T1003.001 lsassy, T1649 ADCS).
      Backfill across recon / exploit / lateral is the remaining
      content task.
- [x] ~~`tagCoverage` summary at the top level~~ — done. Built
      dynamically from the catalog at request time; entry per tag
      with `{commands, tools, total}`. Never goes stale.
- [x] ~~`commands_count` + `tools_count` rollups~~ — done. Annotated
      on every phase + every step in the API output. Consumers
      can size things without walking arrays.

---

## Defense thread-back

- [x] ~~Defense as a derivative view~~ — done (first pass). New
      `<DefenseThreadback>` panel renders at the top of the defense
      phase. Walks `state.progress`, finds the union of
      `mitreTechniques` from completed-step commands (filtered by
      the user's current axes), surfaces them with deep links to
      MITRE ATT&CK for detection guidance.
- [ ] **Inline detection commands per technique.** Today the
      thread-back only links to MITRE. Next: per-technique sigma
      rule snippet + 4769/4624 EID query + Splunk / Sentinel
      template inline. Requires a `lib/playbook/detections.ts`
      keyed by technique ID.
- [ ] **Group detections by data source.** Once a few techniques
      have detections, sort the panel by log source (windows
      security log, sysmon, edr telemetry, network) so a defender
      reading it groups the work, not the techniques.

---

## Already shipped (recent)

System & data
- Three-axis filter (engagement + OS + tech tags) with
  `requiresTechSelection` strict-mode flag.
- `/api/methodology.json` + docs at `/api` (force-static).
- Per-tag `versions: Record<TechTag, string>` (replaces the single
  global version string); commands resolve `{version}` against
  their own techApplies tag.
- Scratch-token pipeline: `extractTokens` auto-detects `{cve}`,
  `{exploit_id}`, etc.; editor in the right-side context panel
  persists values globally.
- `(?<!%)\{(\w+)\}` regex so curl `-w` format strings (`%{http_code}`)
  aren't mistaken for playbook tokens.
- API additions: `schema_version` + `version`, `tagCoverage`
  rollup, `commands_count` + `tools_count` rollups per phase +
  step, `mitreTechniques: string[]` field on commands.
- 36 unique MITRE ATT&CK techniques tagged across recon / vuln /
  exploit / post-ex / lateral.
- 18-tag tech-tag catalog (down from 33; cull dropped 15 empties).

Catalog content
- AD probe pack: enum4linux-ng, GetNPUsers, ldapsearch anon, DC
  SRV discovery, smbclient null session.
- AD-CVE family: Zerologon, PrintNightmare, NoPac, Certifried.
- Modern Windows post-ex: certipy ESC1, Rubeus, lsassy, DCSync via
  secretsdump, AS-REP roast, Golden Ticket forging.
- Cloud probe pack: AWS / GCP / Azure bucket fingerprint + IMDS
  probes (recon) and identity-enum (post-ex). pacu, prowler,
  ScoutSuite, kubectl-who-can as tools.

UI
- Three-axis context chip in shell (engagement · OS · tech tags).
- Engagement scope reminder banner (collapsible, surfaces RoE).
- Phase output deliverable on phase-complete CTA.
- Hidden-by-filter count + strict-mode hint inside Commands /
  Tools sub-tabs.
- Per-tag versions block in stack panel.
- Per-step notes drawer (collapsible, persisted).
- "↓ export" button → Markdown cheat-sheet of current filter set.
- Inline reset-all in stack panel (two-stage confirm).
- ◇ auto / ◆ pinned step-strip toggle.
- `+N · −N commands in this phase` toast on tag toggle.
- DefenseThreadback panel at top of defense phase: surfaces every
  ATT&CK technique demonstrated by completed steps, links to
  attack.mitre.org.

VPS
- bootstrap.sh + server-caddy.sh + deploy.sh for Hetzner CPX11.
