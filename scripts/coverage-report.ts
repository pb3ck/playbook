/**
 * Coverage report — walks the catalog and emits a per-tag /
 * per-phase rollup that shows where the gaps are.
 *
 * Why this exists: the alpha disclaimer says "coverage is uneven"
 * and the roadmap commits to fixing it (M2). Without a baseline,
 * "uneven" is a vibe; with this report, it\'s a sortable list of
 * things to write. Re-run after every catalog change to see the
 * gauge move.
 *
 * Output: a Markdown file at `coverage/<YYYY-MM-DD>.md` (committed
 * deliberately, not auto — `coverage/` is gitignored). The script
 * also prints a summary to stdout so you can run it without
 * always opening the file.
 *
 * Usage:
 *
 *   npm run coverage          # writes coverage/<today>.md + stdout
 *   npm run coverage -- --no-write  # just stdout, don't write the file
 *
 * The "ready" column reflects the ROADMAP appendix bar:
 *   - ≥5 commands attribute via techApplies
 *   - ≥3 phases covered
 *   - ≥1 tool listed for the tag (so the map can derive a discoverer)
 *   - ≥1 command carries mitreTechniques
 *
 * A tag passes only if all four are true.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES } from '../lib/methodology';
import { TECH_TAG_GROUPS, type TechTag } from '../lib/tech-tags';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/* =================================================== Types */

type TagRow = {
  tag: TechTag;
  label: string;
  group: string;
  commands: number;
  toolEntries: number; // step.tools entries that include this tag
  phasesCovered: number;
  phasesList: string[];
  mitreCount: number; // commands with mitreTechniques set, attributed to this tag
  mitrePct: number; // 0..100
  validatedCount: number; // commands with validated set, attributed to this tag
  validatedPct: number; // 0..100
  ready: boolean;
  gaps: string[]; // human-readable list of what\'s missing
};

type PhaseRow = {
  slug: string;
  short: string;
  totalSteps: number;
  totalCommands: number;
  tagAgnosticCommands: number;
  taggedCommands: number;
  toolEntries: number;
  mitreCount: number;
  mitrePct: number;
  validatedCount: number;
  validatedPct: number;
};

/* =================================================== Build */

function buildTagRows(): TagRow[] {
  const flatTags: { id: TechTag; label: string; group: string }[] = [];
  for (const group of TECH_TAG_GROUPS) {
    for (const t of group.tags) {
      flatTags.push({ id: t.id, label: t.label, group: group.label });
    }
  }

  return flatTags
    .map(({ id: tag, label, group }) => {
      let commands = 0;
      let mitreCount = 0;
      let validatedCount = 0;
      let toolEntries = 0;
      const phaseSet = new Set<string>();

      for (const phase of PHASES) {
        for (const step of phase.steps) {
          for (const cmd of step.commands ?? []) {
            if (!cmd.techApplies?.includes(tag)) continue;
            commands++;
            phaseSet.add(phase.slug);
            if (cmd.mitreTechniques && cmd.mitreTechniques.length > 0) {
              mitreCount++;
            }
            if (cmd.validated) validatedCount++;
          }
          for (const tool of step.tools ?? []) {
            if (tool.techApplies?.includes(tag)) toolEntries++;
          }
        }
      }

      const phasesCovered = phaseSet.size;
      const phasesList = [...phaseSet];
      const mitrePct = commands === 0 ? 0 : Math.round((mitreCount / commands) * 100);
      const validatedPct =
        commands === 0 ? 0 : Math.round((validatedCount / commands) * 100);

      const gaps: string[] = [];
      if (commands < 5) gaps.push(`only ${commands} cmd${commands === 1 ? '' : 's'} (need ≥5)`);
      if (phasesCovered < 3) gaps.push(`${phasesCovered}/5 phases (need ≥3)`);
      if (toolEntries === 0) gaps.push('no tagged tool (map can\'t derive discoverer)');
      if (mitreCount === 0) gaps.push('no MITRE mapping');

      const ready =
        commands >= 5 && phasesCovered >= 3 && toolEntries >= 1 && mitreCount >= 1;

      return {
        tag,
        label,
        group,
        commands,
        toolEntries,
        phasesCovered,
        phasesList,
        mitreCount,
        mitrePct,
        validatedCount,
        validatedPct,
        ready,
        gaps,
      };
    })
    .sort((a, b) => b.commands - a.commands);
}

function buildPhaseRows(): PhaseRow[] {
  return PHASES.map((phase) => {
    let totalCommands = 0;
    let tagAgnosticCommands = 0;
    let taggedCommands = 0;
    let toolEntries = 0;
    let mitreCount = 0;
    let validatedCount = 0;

    for (const step of phase.steps) {
      for (const cmd of step.commands ?? []) {
        totalCommands++;
        if (cmd.techApplies && cmd.techApplies.length > 0) {
          taggedCommands++;
        } else {
          tagAgnosticCommands++;
        }
        if (cmd.mitreTechniques && cmd.mitreTechniques.length > 0) {
          mitreCount++;
        }
        if (cmd.validated) validatedCount++;
      }
      toolEntries += (step.tools ?? []).length;
    }

    const mitrePct = totalCommands === 0 ? 0 : Math.round((mitreCount / totalCommands) * 100);
    const validatedPct =
      totalCommands === 0 ? 0 : Math.round((validatedCount / totalCommands) * 100);

    return {
      slug: phase.slug,
      short: phase.short,
      totalSteps: phase.steps.length,
      totalCommands,
      tagAgnosticCommands,
      taggedCommands,
      toolEntries,
      mitreCount,
      mitrePct,
      validatedCount,
      validatedPct,
    };
  });
}

/* =================================================== Render */

function renderTable(headers: string[], rows: string[][]): string {
  /* Pure markdown — no padding, GitHub renders it fine. */
  const head = `| ${headers.join(' | ')} |`;
  const align = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return [head, align, body].join('\n');
}

function renderReport(tagRows: TagRow[], phaseRows: PhaseRow[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const totalCommands = phaseRows.reduce((s, p) => s + p.totalCommands, 0);
  const totalSteps = phaseRows.reduce((s, p) => s + p.totalSteps, 0);
  const readyTags = tagRows.filter((t) => t.ready).length;
  const placeholderTags = tagRows.filter((t) => t.commands <= 2).length;
  const overallMitre = phaseRows.reduce((s, p) => s + p.mitreCount, 0);
  const overallMitrePct =
    totalCommands === 0 ? 0 : Math.round((overallMitre / totalCommands) * 100);
  const overallValidated = phaseRows.reduce((s, p) => s + p.validatedCount, 0);
  const overallValidatedPct =
    totalCommands === 0
      ? 0
      : Math.round((overallValidated / totalCommands) * 100);

  const tagTable = renderTable(
    ['tag', 'group', 'cmds', 'tools', 'phases', 'mitre %', 'val %', 'ready', 'gaps'],
    tagRows.map((t) => [
      `\`${t.tag}\``,
      t.group,
      String(t.commands),
      String(t.toolEntries),
      `${t.phasesCovered}/5`,
      `${t.mitrePct}%`,
      `${t.validatedPct}%`,
      t.ready ? '✓' : '✗',
      t.gaps.join('; ') || '—',
    ]),
  );

  const phaseTable = renderTable(
    ['phase', 'steps', 'cmds (total)', 'tag-agnostic', 'tagged', 'tools', 'mitre %', 'val %'],
    phaseRows.map((p) => [
      `**${p.short}** (\`${p.slug}\`)`,
      String(p.totalSteps),
      String(p.totalCommands),
      String(p.tagAgnosticCommands),
      String(p.taggedCommands),
      String(p.toolEntries),
      `${p.mitrePct}%`,
      `${p.validatedPct}%`,
    ]),
  );

  return `# Coverage report — ${today}

Auto-generated by \`scripts/coverage-report.ts\`. Re-run with
\`npm run coverage\` after every catalog change.

## Summary

- **${TECH_TAG_GROUPS.flatMap((g) => g.tags).length} tags** total
- **${readyTags} tags ready** (≥5 cmds, ≥3 phases, ≥1 tagged tool, ≥1 MITRE mapping)
- **${placeholderTags} tags placeholder** (0-2 commands)
- **${totalCommands} commands** across ${totalSteps} steps in ${phaseRows.length} phases
- **${overallMitrePct}% overall MITRE coverage** (${overallMitre} / ${totalCommands} commands carry \`mitreTechniques\`)
- **${overallValidatedPct}% overall validated** (${overallValidated} / ${totalCommands} commands carry the \`validated\` block — human-verified to work on currently-supported versions)

The roadmap targets ≥75% MITRE coverage AND ≥100% validated on
non-recon commands. Currently the bars are **${overallMitrePct}%** /
**${overallValidatedPct}%** site-wide.

## Per-tag

Sorted by command count descending. The "ready" column reflects the
ROADMAP appendix bar; tags marked ✗ have a gap list in the rightmost
column.

${tagTable}

## Per-phase

${phaseTable}

## What to write next

The roadmap's M1 step says: pick the **next 6-10 tags to deepen**.
Candidates (sorted by impact: which gaps would meaningfully help a
real engagement):

${tagRows
  .filter((t) => !t.ready)
  .slice(0, 10)
  .map(
    (t, i) =>
      `${i + 1}. **\`${t.tag}\`** (${t.group}) — ${t.gaps.join('; ')}`,
  )
  .join('\n')}

---

Re-run: \`npm run coverage\`
`;
}

/* =================================================== Main */

function main() {
  const noWrite = process.argv.includes('--no-write');
  const tagRows = buildTagRows();
  const phaseRows = buildPhaseRows();
  const report = renderReport(tagRows, phaseRows);

  if (!noWrite) {
    const today = new Date().toISOString().slice(0, 10);
    const dir = join(REPO_ROOT, 'coverage');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${today}.md`);
    writeFileSync(out, report);
    console.log(`wrote ${out}`);
  }

  /* Always print a compact summary to stdout — useful in CI. */
  const ready = tagRows.filter((t) => t.ready).length;
  const total = tagRows.length;
  const placeholders = tagRows.filter((t) => t.commands <= 2).length;
  const totalCmds = phaseRows.reduce((s, p) => s + p.totalCommands, 0);
  const mitre = phaseRows.reduce((s, p) => s + p.mitreCount, 0);
  const mitrePct = totalCmds === 0 ? 0 : Math.round((mitre / totalCmds) * 100);
  const validated = phaseRows.reduce((s, p) => s + p.validatedCount, 0);
  const validatedPct =
    totalCmds === 0 ? 0 : Math.round((validated / totalCmds) * 100);
  console.log(
    `\nCoverage: ${ready}/${total} tags ready · ${placeholders} placeholders · ${totalCmds} cmds · ${mitrePct}% MITRE · ${validatedPct}% validated`,
  );
}

main();
