/**
 * autofill-next — pick the most-needed (tag, phase) gap, draft
 * candidates with AI, and apply them to the catalog. Designed to
 * run unattended in the GitHub Actions continuous-fill workflow,
 * but works locally too.
 *
 * The workflow then opens a PR with the resulting diff for the
 * maintainer to review. Trust boundary preserved (human reviews
 * the PR), automation pushed to the limit (the maintainer never
 * has to type TypeScript or run scripts unless they want to).
 *
 * Selection logic — picks the (tag, phase) with the strongest
 * case for being filled next:
 *   1. The tag has fewer than 5 commands OR fewer than 3 phases
 *      OR < 50% MITRE coverage (i.e. not "ready" per the ROADMAP
 *      appendix bar)
 *   2. The chosen phase has zero commands tagged for the tag
 *      (so we add NEW content, not duplicate existing)
 *   3. Tags are ordered by impact: existing-but-thin tags
 *      (closest to ready) get priority over zero-cmd tags, since
 *      flipping ✗ → ✓ is a single visible win
 *
 * Usage:
 *   npm run autofill:next                  # auto-pick + draft + apply
 *   npm run autofill:next -- --dry-run     # report the pick, don\'t draft
 *   npm run autofill:next -- --tag tomcat  # override the tag pick
 *   npm run autofill:next -- --tag tomcat --phase recon
 *
 * Outputs a single JSON line at the end (machine-readable for the
 * workflow):
 *   { "ok": true, "tag": "...", "phase": "...", "added": 4, "skipped": 0,
 *     "draftPath": "...", "summary": "..." }
 *
 * Or on the no-op path (no gap found):
 *   { "ok": true, "noop": true, "reason": "..." }
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES } from '../lib/methodology';
import { TECH_TAG_GROUPS, type TechTag } from '../lib/tech-tags';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/* =================================================== Env */

function loadEnvLocal() {
  const path = join(REPO_ROOT, '.env.local');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}

/* =================================================== Coverage analysis */

type TagCoverage = {
  tag: TechTag;
  label: string;
  commandsTotal: number;
  phasesCovered: Set<string>;
  mitrePct: number;
  taggedTools: number;
  /** Phases with zero commands attributed to this tag — candidates
   *  for autofill targeting. */
  emptyPhases: string[];
  /** "Ready" per the ROADMAP appendix bar. */
  ready: boolean;
};

function computeTagCoverage(): TagCoverage[] {
  const flat: TechTag[] = TECH_TAG_GROUPS.flatMap((g) =>
    g.tags.map((t) => t.id),
  );

  return flat.map((tag) => {
    let commandsTotal = 0;
    let mitreCount = 0;
    let taggedTools = 0;
    const phasesCovered = new Set<string>();
    const phasesWithCmds = new Set<string>();

    for (const phase of PHASES) {
      for (const step of phase.steps) {
        for (const cmd of step.commands ?? []) {
          if (!cmd.techApplies?.includes(tag)) continue;
          commandsTotal++;
          phasesCovered.add(phase.slug);
          phasesWithCmds.add(phase.slug);
          if (cmd.mitreTechniques && cmd.mitreTechniques.length > 0) {
            mitreCount++;
          }
        }
        for (const tool of step.tools ?? []) {
          if (tool.techApplies?.includes(tag)) taggedTools++;
        }
      }
    }
    const emptyPhases = PHASES.map((p) => p.slug).filter(
      (slug) => !phasesWithCmds.has(slug),
    );
    const mitrePct =
      commandsTotal === 0 ? 0 : Math.round((mitreCount / commandsTotal) * 100);
    const ready =
      commandsTotal >= 5 &&
      phasesCovered.size >= 3 &&
      taggedTools >= 1 &&
      mitreCount >= 1;
    const label = TECH_TAG_GROUPS.flatMap((g) => g.tags).find(
      (t) => t.id === tag,
    )!.label;
    return {
      tag,
      label,
      commandsTotal,
      phasesCovered,
      mitrePct,
      taggedTools,
      emptyPhases,
      ready,
    };
  });
}

/** Pick the (tag, phase) we should fill next. Strategy:
 *
 *    Tier 1: tags that are 1 phase away from passing the bar
 *      (have ≥5 commands, MITRE coverage, but only 2 phases)
 *      → fill any of their empty phases
 *    Tier 2: tags with low command count
 *      → fill an empty phase to add cmds + a phase
 *    Tier 3: zero-content tags (true placeholders)
 *      → fill recon as the natural starting point
 *
 *  Phase pick within a tag: prefer phases listed earlier in PHASES
 *  (recon → vuln → exploit → post-ex → defense) so coverage grows
 *  in narrative order. */
function pickGap(): { tag: TechTag; phase: string; tier: number; reason: string } | null {
  const coverage = computeTagCoverage();
  const phaseOrder = PHASES.map((p) => p.slug);

  /* Tier 1 — closest-to-ready non-ready tags. */
  const tier1 = coverage.filter(
    (c) => !c.ready && c.commandsTotal >= 5 && c.emptyPhases.length > 0,
  );
  if (tier1.length > 0) {
    /* Prefer the one with the highest existing MITRE coverage —
       suggests the tag\'s commands have been MITRE-mapped, so
       the new ones probably will too. */
    tier1.sort((a, b) => b.mitrePct - a.mitrePct);
    const winner = tier1[0];
    const phase = winner.emptyPhases.sort(
      (a, b) => phaseOrder.indexOf(a) - phaseOrder.indexOf(b),
    )[0];
    return {
      tag: winner.tag,
      phase,
      tier: 1,
      reason: `${winner.tag} has ${winner.commandsTotal} cmds + ${winner.mitrePct}% MITRE but is missing the ${phase} phase — closest tag to passing the readiness bar`,
    };
  }

  /* Tier 2 — tags with 1-4 commands, an empty phase to add to. */
  const tier2 = coverage.filter(
    (c) => !c.ready && c.commandsTotal >= 1 && c.commandsTotal < 5 && c.emptyPhases.length > 0,
  );
  if (tier2.length > 0) {
    /* Prefer ones with more existing commands (closer to the
       ≥5 bar); ties broken by more tagged tools. */
    tier2.sort((a, b) => b.commandsTotal - a.commandsTotal || b.taggedTools - a.taggedTools);
    const winner = tier2[0];
    const phase = winner.emptyPhases.sort(
      (a, b) => phaseOrder.indexOf(a) - phaseOrder.indexOf(b),
    )[0];
    return {
      tag: winner.tag,
      phase,
      tier: 2,
      reason: `${winner.tag} has only ${winner.commandsTotal} cmd${winner.commandsTotal === 1 ? '' : 's'} — fill the ${phase} phase to add depth`,
    };
  }

  /* Tier 3 — zero-content tags. Recon is the natural entry point. */
  const tier3 = coverage.filter((c) => c.commandsTotal === 0);
  if (tier3.length > 0) {
    const winner = tier3[0];
    return {
      tag: winner.tag,
      phase: 'recon',
      tier: 3,
      reason: `${winner.tag} is a placeholder (0 commands) — start with recon`,
    };
  }

  return null;
}

/* =================================================== Subprocess helpers */

function run(
  cmd: string,
  args: string[],
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    /* Inherit env so ANTHROPIC_API_KEY (loaded from .env.local OR
       provided by the GH Action) reaches subprocesses. */
    env: process.env,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/* =================================================== Main */

type Args = {
  dryRun: boolean;
  tag: string | null;
  phase: string | null;
  count: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    tag: get('tag'),
    phase: get('phase'),
    count: parseInt(get('count') ?? '4', 10),
  };
}

async function main() {
  loadEnvLocal();
  const args = parseArgs();

  /* Pick the gap. */
  let pick: { tag: TechTag; phase: string; tier: number; reason: string } | null;
  if (args.tag && args.phase) {
    pick = {
      tag: args.tag as TechTag,
      phase: args.phase,
      tier: 0,
      reason: `manual override via --tag ${args.tag} --phase ${args.phase}`,
    };
  } else {
    pick = pickGap();
  }

  if (!pick) {
    console.log(
      JSON.stringify({
        ok: true,
        noop: true,
        reason: 'no gaps found — every tag passes the readiness bar',
      }),
    );
    return;
  }

  console.error(`pick: tag=${pick.tag} phase=${pick.phase} (tier ${pick.tier})`);
  console.error(`reason: ${pick.reason}`);

  if (args.dryRun) {
    console.log(
      JSON.stringify({
        ok: true,
        dryRun: true,
        tag: pick.tag,
        phase: pick.phase,
        tier: pick.tier,
        reason: pick.reason,
      }),
    );
    return;
  }

  /* Stage 1: draft. */
  console.error(`drafting ${args.count} candidates...`);
  const draft = run('npm', [
    'run',
    'ai:draft',
    '--',
    '--tag',
    pick.tag,
    '--phase',
    pick.phase,
    '--count',
    String(args.count),
  ]);
  if (!draft.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        stage: 'draft',
        tag: pick.tag,
        phase: pick.phase,
        error: (draft.stderr || draft.stdout).slice(-500),
      }),
    );
    process.exit(1);
  }
  const draftPath = join(
    REPO_ROOT,
    'scripts',
    'drafts',
    `${pick.tag}-${pick.phase}.yaml`,
  );

  /* Stage 2: apply. */
  console.error(`applying...`);
  const apply = run('npm', ['run', 'ai:apply', '--', draftPath]);
  if (!apply.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        stage: 'apply',
        tag: pick.tag,
        phase: pick.phase,
        draftPath,
        error: (apply.stderr || apply.stdout).slice(-500),
      }),
    );
    process.exit(1);
  }

  /* Parse the apply stdout for telemetry — it prints lines like
     "Applied N insertions, M skipped". */
  const applyMatch = apply.stdout.match(/Applied (\d+) insertion/);
  const skipMatch = apply.stdout.match(/(\d+) skipped/);
  const added = applyMatch ? parseInt(applyMatch[1], 10) : 0;
  const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;

  /* Pull the placement plan + tool recommendations out of the
     stdout so the workflow can include them in the PR body. */
  const planLines = apply.stdout
    .split('\n')
    .filter((l) => l.match(/^\s*[→✗]/))
    .map((l) => l.trim());
  const toolLines = apply.stdout
    .split('\n')
    .filter((l) => l.match(/^\s+[a-z\-]+\/\d+:/))
    .map((l) => l.trim());

  console.log(
    JSON.stringify({
      ok: true,
      tag: pick.tag,
      phase: pick.phase,
      tier: pick.tier,
      reason: pick.reason,
      added,
      skipped,
      draftPath,
      placementPlan: planLines,
      toolRecommendations: toolLines,
    }),
  );
}

main().catch((err) => {
  console.log(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
