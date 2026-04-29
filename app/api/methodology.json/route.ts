import { PHASES, type Phase, type ToolRef } from '@/lib/methodology';
import { ENGAGEMENTS } from '@/lib/engagements';
import { TARGET_OSES } from '@/lib/target-os';
import { TECH_TAG_GROUPS } from '@/lib/tech-tags';

/**
 * Read-only JSON dump of the entire playbook dataset.
 *
 * `dynamic = 'force-static'` makes Next render this at build time
 * under `output: 'export'` — the response body lands as a file at
 * `out/api/methodology.json`. Caddy serves it like any other static
 * asset; no Node runtime needed at request time.
 *
 * Single payload for simplicity (~100 KB). One fetch, no pagination,
 * cacheable for the typical 5-min window. Consumers parse and filter
 * client-side using the documented schema (see /api).
 *
 * Stability: snapshot. Schema may change with site updates. Pin a
 * build hash via `curl` if you need stability across deploys.
 */

export const dynamic = 'force-static';

/**
 * Walk every step's tool refs, dedupe by URL, attach the (phase,
 * step) breadcrumb where each was first seen. Lets consumers answer
 * "what's the universe of tools this playbook recommends?" without
 * walking the phase tree themselves.
 */
function buildToolIndex(): Array<
  ToolRef & { phases: string[]; steps: string[] }
> {
  const byUrl = new Map<
    string,
    ToolRef & { phases: Set<string>; steps: Set<string> }
  >();
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      for (const t of step.tools ?? []) {
        const existing = byUrl.get(t.url);
        if (existing) {
          existing.phases.add(phase.short.toLowerCase());
          existing.steps.add(step.title);
        } else {
          byUrl.set(t.url, {
            ...t,
            phases: new Set([phase.short.toLowerCase()]),
            steps: new Set([step.title]),
          });
        }
      }
    }
  }
  return [...byUrl.values()]
    .map(({ phases, steps, ...tool }) => ({
      ...tool,
      phases: [...phases],
      steps: [...steps],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Per-tag rollup — `{ apache: { commands: 7, tools: 0, total: 7 }, … }`.
 * Lets consumers see at a glance which axes are populated. Built
 * dynamically so adding/removing tagged content keeps the rollup
 * honest without separate maintenance.
 */
function buildTagCoverage(): Record<
  string,
  { commands: number; tools: number; total: number }
> {
  const out: Record<string, { commands: number; tools: number; total: number }> = {};
  for (const group of TECH_TAG_GROUPS) {
    for (const tag of group.tags) {
      out[tag.id] = { commands: 0, tools: 0, total: 0 };
    }
  }
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      for (const c of step.commands ?? []) {
        for (const t of c.techApplies ?? []) {
          if (out[t]) {
            out[t].commands++;
            out[t].total++;
          }
        }
      }
      for (const tool of step.tools ?? []) {
        for (const t of tool.techApplies ?? []) {
          if (out[t]) {
            out[t].tools++;
            out[t].total++;
          }
        }
      }
    }
  }
  return out;
}

/**
 * Annotate each phase with `commands_count` + `tools_count` (and
 * each step the same), so consumers don't have to walk the arrays
 * just to size them. Cheap to compute, useful for dashboards.
 */
function annotatePhasesWithCounts(phases: readonly Phase[]) {
  return phases.map((phase) => {
    let phaseCmds = 0;
    let phaseTools = 0;
    const annotatedSteps = phase.steps.map((step) => {
      const cmds = step.commands?.length ?? 0;
      const tools = step.tools?.length ?? 0;
      phaseCmds += cmds;
      phaseTools += tools;
      return { ...step, commands_count: cmds, tools_count: tools };
    });
    return {
      ...phase,
      label: phase.name,
      commands_count: phaseCmds,
      tools_count: phaseTools,
      steps: annotatedSteps,
    };
  });
}

export async function GET() {
  const SCHEMA_VERSION = '1';
  /* Phase entries carry a `name` field internally (see lib/methodology.ts).
     The other catalogs use `label` (engagements, OSes, tech-tag groups +
     entries). Mirror `name` to `label` on phases at the API boundary so
     consumers can read `label` uniformly. The annotation function also
     adds the per-phase / per-step rollup counts. */
  const phasesAnnotated = annotatePhasesWithCounts(PHASES);

  const payload = {
    /* `version` and `schema_version` are aliases — same string. The
       former is concise, the latter is unambiguous for consumers
       pinning against breaking changes. Bumped together. */
    version: SCHEMA_VERSION,
    schema_version: SCHEMA_VERSION,
    /* Generated once at build time; the static file embeds the
       build moment so consumers know what cut they're looking at. */
    generated: new Date().toISOString(),
    /* Reference catalogs — let consumers render their own pickers
       without re-encoding the engagement / OS / tech enums. */
    engagements: ENGAGEMENTS,
    targetOSes: TARGET_OSES,
    techTagGroups: TECH_TAG_GROUPS,
    /* Per-tag rollup of how many commands + tools reference each
       tag. Lets a consumer see which axes are populated vs which
       are placeholders the catalog is still building toward. Built
       dynamically so it never goes stale. */
    tagCoverage: buildTagCoverage(),
    /* Top-level deduped index of every tool referenced anywhere in
       the playbook, augmented with (phases, steps) breadcrumbs so
       consumers can answer "what tools are referenced?" without
       walking phases[].steps[].tools[]. Sorted by tool name. */
    tools: buildToolIndex(),
    /* The walkthrough itself — five phases, each with preChecks,
       steps (with commands/tools/branches), output, and the various
       filter tags inline on every entry. Annotated with
       commands_count + tools_count rollups at both the phase and
       step level. */
    phases: phasesAnnotated,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
