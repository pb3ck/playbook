/**
 * Playbook search engine.
 *
 * The previous search scanned `FLAT_TOOLS` only — the legacy 90-web-tools
 * catalog from `content/offensive-tools.ts`. That dataset is independent
 * from the playbook itself, so typing "nmap" or "ffuf" returned nothing
 * (those live as tool refs inside step entries in `lib/methodology.ts`,
 * not in the catalog).
 *
 * This module fixes that by indexing what the user actually expects to
 * find: phases, steps (with their tools, descriptions, and command
 * labels in the haystack), and the legacy catalog. Each searchable
 * item carries an action — jump to a phase, focus a step, or open a
 * URL — so the search becomes a navigation surface, not just a tool
 * launcher.
 *
 * Scoring (per token; query is split on whitespace, AND-semantics):
 *   exact title match           +100
 *   title starts with token      +30
 *   token as a whole word in title  +20
 *   token as substring in title  +10
 *   token in haystack only        +1
 * Plus small kind boosts: step +3, phase +2, tool 0.
 *
 * The kind boosts make "recon" surface phase 1 above its constituent
 * steps, but make "burp" surface the Burp Suite tool above the steps
 * that mention it (because the step boost can't overcome the tool's
 * title-prefix bonus).
 */

import {
  PHASES,
  visibleStepsForPhase,
  type Phase,
  type PhaseStep,
} from '@/lib/methodology';
import type { Engagement } from '@/lib/engagements';
import { FLAT_TOOLS, type FlatTool } from './constants';

export type SearchItemKind = 'phase' | 'step' | 'tool' | 'command' | 'attack';

export type SearchAction =
  | { type: 'phase'; phaseIndex: number }
  | { type: 'step'; phaseIndex: number; visibleStepIdx: number }
  | { type: 'url'; url: string };

export type SearchableItem = {
  /** Stable id — used as React key and dedup key. URL for tools, phase
   *  slug for phases, `${phaseSlug}:step:${originalIndex}` for steps. */
  id: string;
  kind: SearchItemKind;
  title: string;
  /** Right-aligned context snippet in result rows. */
  subtitle?: string;
  /** Pre-lowercased haystack used by `searchPlaybook`. */
  haystack: string;
  action: SearchAction;
};

/* =================================================== Index builder */

/**
 * Builds the search index for the current engagement. Engagement
 * affects which steps and pre-checks are visible (filtered by
 * `appliesTo`), so the index must be rebuilt when it changes.
 *
 * Step-tool entries are deduped by URL — a tool that appears across
 * many steps surfaces once, with the FIRST step that uses it as the
 * subtitle. The step's own entry is still indexed separately, so
 * searching by step title still works.
 */
export function buildSearchIndex(
  engagement: Engagement | null,
): SearchableItem[] {
  const items: SearchableItem[] = [];
  const seenUrls = new Set<string>();

  for (let phaseIndex = 0; phaseIndex < PHASES.length; phaseIndex++) {
    const phase = PHASES[phaseIndex];

    /* Phase entry — top-level navigation result. */
    items.push({
      id: `phase:${phase.slug}`,
      kind: 'phase',
      title: phase.name,
      subtitle: `phase ${pad2(phase.index)}`,
      haystack: lowerJoin(
        phase.name,
        phase.short,
        phase.blurb,
        phase.goal,
      ),
      action: { type: 'phase', phaseIndex },
    });

    /* Steps + their inner tools. visibleStepIdx is the engagement-
       filtered position; that's what `state.setFocusedStepIdx`
       expects. */
    const visible = visibleStepsForPhase(phase, engagement);
    visible.forEach(({ step, originalIndex }, visibleStepIdx) => {
      items.push({
        id: `step:${phase.slug}:${originalIndex}`,
        kind: 'step',
        title: step.title,
        subtitle: `${phase.short.toLowerCase()} · ${pad2(visibleStepIdx + 1)} / ${pad2(visible.length)}`,
        haystack: stepHaystack(step, phase),
        action: { type: 'step', phaseIndex, visibleStepIdx },
      });

      /* Each tool referenced by the step, deduped by URL. */
      for (const t of step.tools ?? []) {
        if (seenUrls.has(t.url)) continue;
        seenUrls.add(t.url);
        items.push({
          id: `tool:${t.url}`,
          kind: 'tool',
          title: t.name,
          subtitle: `${t.kind.toUpperCase()} · used in ${phase.short.toLowerCase()}`,
          haystack: lowerJoin(t.name, t.note ?? '', t.kind),
          action: { type: 'url', url: t.url },
        });
      }

      /* Each command as its own searchable row. The step entry
         covers the title + description, but commands have
         distinct labels (cvemap variants, sqlmap variants, etc.)
         that the user types looking for "kerberoast" or
         "secretsdump" specifically. Action jumps to the step so
         the command lives in context. */
      const cmds = step.commands ?? [];
      cmds.forEach((cmd, cmdIdx) => {
        const label = cmd.label ?? cmd.command.slice(0, 60);
        items.push({
          id: `cmd:${phase.slug}:${originalIndex}:${cmdIdx}`,
          kind: 'command',
          title: label,
          subtitle: `${phase.short.toLowerCase()} · ${step.title}`,
          haystack: lowerJoin(
            label,
            cmd.command,
            (cmd.techApplies ?? []).join(' '),
            (cmd.mitreTechniques ?? []).join(' '),
          ),
          action: { type: 'step', phaseIndex, visibleStepIdx },
        });
      });
    });
  }

  /* ATT&CK technique entries — one per unique technique referenced
     anywhere in the catalog. Subtitle counts how many commands
     demonstrate it; action opens the MITRE write-up. */
  const techCounts = new Map<string, number>();
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      for (const cmd of step.commands ?? []) {
        for (const t of cmd.mitreTechniques ?? []) {
          techCounts.set(t, (techCounts.get(t) ?? 0) + 1);
        }
      }
    }
  }
  for (const [tech, count] of techCounts) {
    items.push({
      id: `attack:${tech}`,
      kind: 'attack',
      title: tech,
      subtitle: `MITRE ATT&CK · ${count} command${count === 1 ? '' : 's'}`,
      haystack: lowerJoin(tech, 'mitre', 'attack', 'technique'),
      action: {
        type: 'url',
        url: `https://attack.mitre.org/techniques/${tech.replace('.', '/')}/`,
      },
    });
  }

  /* Legacy FLAT_TOOLS catalog — only the entries not already indexed
     above (Burp Suite, Nuclei, etc. that appear in step.tools take
     precedence with their step-context subtitle). */
  for (const t of FLAT_TOOLS) {
    if (seenUrls.has(t.url)) continue;
    seenUrls.add(t.url);
    items.push({
      id: `tool:${t.url}`,
      kind: 'tool',
      title: t.name,
      subtitle: `from ${t.category.toLowerCase()}`,
      haystack: lowerJoin(
        t.name,
        t.description,
        t.category,
        ...(t.tags ?? []),
      ),
      action: { type: 'url', url: t.url },
    });
  }

  return items;
}

/* =================================================== Search + scoring */

const CVE_RE = /^cve[-\s]?(\d{4})[-\s]?(\d{2,7})$/i;

export type ScoredItem = { item: SearchableItem; score: number };

/**
 * Tokenize the query, AND-match against haystacks, score each match,
 * sort by score descending. Returns up to `limit` results.
 *
 * Below 2 chars: no results (avoid noise like single-letter substring
 * scans).
 */
export function searchPlaybook(
  index: SearchableItem[],
  query: string,
  limit = 30,
): ScoredItem[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const scored: ScoredItem[] = [];
  for (const item of index) {
    if (!tokens.every((t) => item.haystack.includes(t))) continue;

    let score = 0;
    const titleLower = item.title.toLowerCase();

    for (const t of tokens) {
      if (titleLower === t) score += 100;
      else if (titleLower.startsWith(t)) score += 30;
      else if (wordBoundary(t).test(titleLower)) score += 20;
      else if (titleLower.includes(t)) score += 10;
      else score += 1;
    }

    /* Kind boost — reflects "what\'s most likely to be the user\'s
       intent." Steps are the actionable unit of the playbook;
       commands are the runnable atom; phases are coarser; tools +
       attack techniques are leaves. Boosts are small enough that
       a title-position win on any kind beats a kind-only boost. */
    if (item.kind === 'step') score += 3;
    else if (item.kind === 'command') score += 2;
    else if (item.kind === 'phase') score += 2;
    else if (item.kind === 'attack') score += 1;

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * If the query parses as a CVE id, returns a synthesized "Open in NVD"
 * search item — to be merged into the result list ahead of regular
 * matches. Returns null otherwise.
 */
export function cveShortcut(query: string): SearchableItem | null {
  const m = query.trim().match(CVE_RE);
  if (!m) return null;
  const id = `CVE-${m[1]}-${m[2]}`;
  const url = `https://nvd.nist.gov/vuln/detail/${id}`;
  return {
    id: `cve:${id}`,
    kind: 'tool',
    title: `Open ${id} in NVD`,
    subtitle: 'NIST National Vulnerability Database',
    haystack: id.toLowerCase(),
    action: { type: 'url', url },
  };
}

/* =================================================== Helpers */

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function lowerJoin(...parts: string[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/** Pull a step's full searchable text — title, description, tool
 *  names + notes, command labels (the user-facing parts; not the
 *  command body since it's already noisy with shell flags), branch
 *  conditions, and the parent phase's name/short for context. */
function stepHaystack(step: PhaseStep, phase: Phase): string {
  const tools = (step.tools ?? [])
    .map((t) => `${t.name} ${t.note ?? ''} ${t.kind}`)
    .join(' ');
  const cmds = (step.commands ?? []).map((c) => c.label ?? '').join(' ');
  const branches = (step.branches ?? []).map((b) => b.if).join(' ');
  return lowerJoin(
    step.title,
    step.description,
    tools,
    cmds,
    branches,
    phase.name,
    phase.short,
  );
}

/* Cache regex compiles per token — `searchPlaybook` is called on every
   keystroke, and each token would otherwise compile fresh per item. */
const WORD_BOUNDARY_CACHE = new Map<string, RegExp>();
function wordBoundary(token: string): RegExp {
  let re = WORD_BOUNDARY_CACHE.get(token);
  if (!re) {
    re = new RegExp(`\\b${escapeRegex(token)}\\b`);
    WORD_BOUNDARY_CACHE.set(token, re);
  }
  return re;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
