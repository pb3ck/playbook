# playbook — out-of-alpha roadmap

> Status: **alpha** as of 2026-04-29 (extracted from angst.rocks
> into its own repo). This document defines what "alpha → 1.0" means,
> the milestones to get there, and explicit exit criteria. Tactical
> UI/UX backlog lives in [`TODO.md`](./TODO.md); this file is the
> strategic plan.

---

## 1. Honest assessment of where we are

**The shape of the gap.** Today the catalog has roughly:

- **18 tech tags** (Apache, Nginx, IIS, Spring, Express, WordPress,
  Postgres, MySQL, MSSQL, Java, .NET, Node, Kerberos, LDAP, AWS,
  GCP, Azure, Kubernetes — plus engagement/OS/wildcard scoping)
- **~130 commands** spread across 5 phases
- **~79 tag-attributions** — average ~4 commands per tag, but
  heavily uneven: the AD pack (kerberos / ldap / mssql) carries
  the load, several other tags are 0-2 commands.

**What works well already.** The framework, not the content:

- Per-command "ran" attribution (honest activity model)
- Auto-derived attack-graph map (host → tool → service → tool → finding)
- Session snapshot share/import (URL fragment + JSON)
- Markdown / SVG / PNG exports
- BYOK CVE enrichment (NVD/EPSS/OSV/VulnCheck/Custom)
- Defense thread-back (ATT&CK techniques rolled up from ticked commands)
- Cross-cutting search (phases / steps / commands / tools / techniques)
- Demo session for first-touch evaluation

**What blocks 1.0.** Mostly content depth, partly real-world
validation. The tooling has outpaced the catalog. The disclaimer
isn't false modesty — most engagements really will hit gaps fast.

---

## 2. Definition of "out of alpha"

The `alpha` chip + welcome banner come down when **all** of the
following are true:

### Coverage

- [ ] Every selectable tech tag has at least **5 commands** spanning
      ≥3 phases. (Today: ~half the tags.)
- [ ] At least **10 tags** have ≥10 commands AND ≥3 tools AND ≥1
      ATT&CK technique mapping per command. (Today: ~3.)
- [ ] Every command carries a `mitreTechniques` array where
      applicable (so Defense thread-back is non-empty for typical
      engagements). Coverage target: ≥75% of non-recon commands.
- [ ] Each phase has at least **8 generic (tag-agnostic) steps**
      that fire regardless of stack — discovery, common
      misconfigurations, post-ex pivots, defense recommendations.
      (Today: variable.)

### Accuracy

- [ ] Every command has been **run at least once** on a real or
      lab target by someone other than the author. Tracked via a
      lightweight `validated: { by, on, notes? }` field added to
      `CommandSnippet`, surfaced as a small ✓ badge on the command
      block.
- [ ] No command interpolates a token that isn't documented in the
      step's `description`.
- [ ] Tool URLs lint-checked monthly (link rot is the silent
      killer). Add a `scripts/check-tool-urls.ts` to CI.
- [ ] CVE-named commands have an EPSS/CVSS-context line that's
      either current within 90 days or marked stale via BYOK
      pipeline.

### Real-world signal

- [ ] **≥10 documented real engagements** have run end-to-end
      through the playbook. "Documented" = a session snapshot was
      exported and shared with the maintainer (privately is fine).
- [ ] **≥3 distinct users** beyond the author have completed at
      least one engagement with it.
- [ ] First-pass usability problems collected from those users have
      either been fixed or explicitly punted with reasoning in
      this file.

### Feature stability

- [ ] BYOK has been exercised with **≥3 provider kinds** in
      production. (Currently shipped, untested with real keys.)
- [ ] Map exports (SVG + PNG) reproduce identically across
      Chrome/Firefox/Safari current.
- [ ] Session snapshot import handles every ≥0.5.x export without
      data loss. Add an `e2e/session-roundtrip.test.ts`.
- [ ] No P0/P1 bugs filed in the last 30 days.

### Documentation

- [ ] `README.md` at repo root exists with screenshots + a
      "what this is / what this isn't" section.
- [ ] A "how to use this on a real engagement" writeup published
      under `/writing/` linking back to the playbook.
- [ ] `/api` docs reflect the current schema; pinned API version
      bumped to `1.0`.
- [ ] BYOK custom-profile cookbook with at least 2 worked examples
      (Cloudflare Worker proxy, internal-CVE-DB shape).

---

## 3. Phased plan

Four milestones. Each is sized for solo execution; effort estimates
assume ~10 focused hours/week. Reorder freely — they're mostly
independent except for M4 depending on M2.

### M1 — Coverage breadth (audit + plan)
**Goal:** Know exactly what's missing, not just "a lot."
**Effort:** ~1 week.

1. Add `scripts/coverage-report.ts` — walks `lib/methodology.ts`
   and prints a table per tag: `tag · commands · tools · phases
   covered · MITRE coverage %`.
2. Run it. Commit the output to `coverage/2026-04-28.md` as the
   baseline.
3. From the report, pick the **next 6-10 tags to deepen** and
   record them in `TODO.md` under a new "M2 catalog focus"
   heading. Likely candidates given current usage patterns:
   Tomcat (currently absent), Django/Flask (web app pentests),
   Kubernetes (cloud-native), GraphQL (API testing), Express
   (Node), MSSQL (already on the way), Linux post-ex tooling.
4. Decide what tags get **dropped** vs deepened. The current
   list includes some thin tags that may not be worth filling
   (e.g. .NET vs ASP.NET specifically). Cull explicitly so the
   picker isn't a wall of empty options.

**Exit:** A commit lands `coverage/baseline.md` + an updated
`TODO.md` with named priority tags and rationale.

### M2 — Coverage depth (write the content)
**Goal:** Hit the "≥5 commands across ≥3 phases" bar for every
tag we're keeping.
**Effort:** ~6-10 weeks. This is the big one.

For each priority tag, in this order per tag:
1. Recon: 2 commands (passive, active)
2. Vuln: 2-3 commands (config check, version-driven CVE, fuzz/spray)
3. Exploit: 2-4 commands (the actual attack paths the tag enables)
4. Post-ex: 1-2 commands (lateral / persistence specific to that
   stack)
5. Defense: 1 command per ATT&CK technique cited above (detection
   or hardening)

Each command needs:
- `command` string with `{target}`/`{version}` interpolation
- `appliesTo`/`osApplies`/`techApplies` scoping
- `mitreTechniques` where applicable
- A `label` short enough to scan in the focus view

**Sourcing rule.** Every command must have a citable source in
the commit message (book chapter, official docs, or a writeup).
Don't write commands you can't trace.

**Exit:** Coverage report shows ≥5 commands, ≥3 phases, ≥75%
ATT&CK coverage on every tag in the priority list. The dropped
tags either have content too or have been removed from
`TECH_TAGS`.

### M3 — Real-world validation
**Goal:** Stop guessing whether the playbook is useful.
**Effort:** ~4 weeks (mostly waiting on others).

1. Recruit 3-5 friendly pentesters. Hand each one a fresh
   playbook + ask them to run a real engagement through it (or
   replay a recent one).
2. They send back the session snapshot JSON when done. We don't
   need the asset — just the engagement-shape: which steps were
   visited, which commands ticked, which scratch tokens
   populated.
3. From those snapshots:
   - Which steps have **0 tick rate** across users? Cull or
     rewrite. Dead steps drown signal.
   - Which commands had 100% tick rate but no `mitreTechniques`?
     Add the mapping.
   - Which scratch tokens did everyone create manually? Add to
     the catalog as known tokens.
4. Add a `feedback` button in the shell that downloads a
   session snapshot pre-titled `feedback-<engagement>-<date>.json`
   and pops a mailto: with the file attached. Lower-friction
   than asking users to dig through the export menu.

**Exit:** ≥10 real-engagement snapshots received and triaged.
At least 5 have produced a catalog change committed back.

### M4 — Polish, docs, and launch
**Goal:** Make the tool **discoverable** to the next user.
**Effort:** ~2 weeks.

1. Mobile design pass on the Map (currently `lg:hidden`
   placeholder). Decide: tap-to-focus single-node mode, or stay
   desktop-only with a clearer "open on a laptop" message.
2. Public `README.md` with: screenshot, "what this is / isn't,"
   quickstart, link to the demo session URL, link to `/api`.
3. A writeup post at `/writing/playbook-out-of-alpha`
   describing the model (5 phases × engagement × OS × stack),
   the activity-not-completion stance, the BYOK approach. This
   is the on-ramp for serious users.
4. Drop the alpha banner + chip. Bump `/api` `version` to
   `1.0`. Tag `v1.0.0` in git.
5. Post about it: HN Show, /r/AskNetsec, Twitter/Mastodon.
   Soft launch — measure traffic + bug reports for ~2 weeks
   before claiming "stable."

**Exit:** Alpha disclaimer is deleted in a single commit
referencing this file.

---

## 4. Risks and open questions

### Risk: content drift outpaces validation
Once volume of commands grows, validating "does this still work
on current versions" gets expensive. Mitigation: link every
command to its source, prefer official docs over personal
writeups (longer half-life), accept that some commands will be
out of date and ship a `report-stale` button per command.

### Risk: scope creep on the framework
Resist adding more app features until M2 catalog content lands.
The disclaimer says "uneven coverage" — fixing that means
writing prose, not React. Hard rule for the rest of the alpha
window: **net new framework features only if they unblock
content authoring** (e.g., a better `commandValidated` field).

### Risk: no real users sign up for M3
Plan B: do M3 myself across 3-5 different lab environments
(HTB, TryHackMe, VulnHub) and treat my own snapshots as the
validation set. Less generalizable, but still better than
"I think this is useful."

### Open question: should defense content live in its own tab?
Today defense is the 5th phase. Real defenders may want a
"detection-only" view that strips the offense flow. Decide
before M4 launch — adding it later changes the API contract.

### Open question: mobile story
Map is desktop-only and probably should stay that way. But the
**reading** flow (focus view, command snippets) could work on
mobile if we accept the side-panel/scratch UI gets compact.
M4 forces a decision.

---

## 5. What out-of-alpha does NOT mean

Setting expectations clearly so 1.0 doesn't feel underwhelming:

- **Not a Burp/Metasploit replacement.** The playbook
  organizes what to do; the actual tools live outside.
- **Not a teaching tool first.** Assumes the user knows enough
  pentest fundamentals to read a command and judge its
  appropriateness for their target.
- **Not a vulnerability scanner.** It nominates checks for the
  user to run. It doesn't run them.
- **Not a substitute for a written report.** The session
  snapshot is engagement state, not deliverable content.

---

## Appendix: definition of "ready" for a new tech tag

When adding a new tag (e.g. `tomcat`), it doesn't ship until:

- [ ] Listed in `TECH_TAG_GROUPS` in `lib/tech-tags.ts`
- [ ] Has a `techTagLabel` entry
- [ ] At least 5 commands attribute to it via `techApplies`
- [ ] Spans ≥3 phases
- [ ] At least 1 step has it in `tools` (so the map can derive
      a discoverer-tool node)
- [ ] At least 1 command carries `mitreTechniques`
- [ ] A snapshot using only this tag produces a non-empty
      `CoverageBand` in the map
- [ ] Listed in `coverage/<date>.md` as "covered"

That's the bar. Anything below is back to alpha for that tag.
