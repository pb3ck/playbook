'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { PHASES } from '@/lib/methodology';
import { isOSVisible } from '@/lib/target-os';
import {
  isTechVisible,
  isTechVisibleStrict,
  techTagLabel,
  type TechTag,
} from '@/lib/tech-tags';
import type { PlaybookState } from './types';

/**
 * Coverage pulse — a single-line summary at the top of the focus
 * view answering the user's first big question: "what does the
 * catalog have for *me* right now?"
 *
 * Compact form (default): one row of phase chips, each showing
 * a status (✓ covered / ◐ partial / ○ gap) for the user's
 * selected tags. Click anywhere to expand.
 *
 * Expanded form: per-phase rows with command counts, lists of
 * which tags have commands in this phase, and a "→ ai-fill"
 * action that scrolls to the AI Assist surface for users to
 * generate guidance for the gaps.
 *
 * Replaces the vague alpha disclaimer with specific, contextual
 * info: instead of "coverage is uneven," the user sees exactly
 * which phase × tag pairs are missing for *their* engagement.
 *
 * No selected tags → the per-tag math is meaningless. We render
 * a simpler "Total visible commands per phase" line that still
 * gives a sense of catalog depth without inventing gaps.
 */

type PhaseStatus = 'covered' | 'partial' | 'gap' | 'no-tags';

type PhaseCoverage = {
  slug: string;
  name: string;
  short: string;
  /** Total commands visible to the user at the user\'s axis
   *  selection (engagement + OS + tag filters all applied as the
   *  app would render them). */
  visibleCommands: number;
  /** For each selected tag, count of commands in this phase
   *  that include the tag in `techApplies`. */
  perTagCounts: Map<string, number>;
  /** Selected tags with zero per-tag commands in this phase. */
  gaps: string[];
  /** Selected tags with at least one per-tag command in this phase. */
  covered: string[];
  status: PhaseStatus;
};

function computeCoverage(state: PlaybookState): PhaseCoverage[] {
  return PHASES.map((phase) => {
    let visibleCommands = 0;
    const perTagCounts = new Map<string, number>();

    for (const step of phase.steps) {
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (const cmd of step.commands ?? []) {
        /* Engagement filter — same semantics the focus view applies:
           when cmd.appliesTo is set, command only renders for those
           engagements. */
        const engOk =
          !cmd.appliesTo ||
          (state.engagement !== null &&
            cmd.appliesTo.includes(state.engagement));
        if (!engOk) continue;
        if (!isOSVisible(cmd.osApplies, state.targetOS)) continue;
        if (!techCheck(cmd.techApplies, state.selectedTechTags)) continue;
        visibleCommands++;

        /* Per-tag accounting — for each selected tag the command
           is *attributed to*, increment that tag\'s count. Untagged
           commands count toward visibleCommands but not toward any
           specific tag (they\'re universal). */
        if (cmd.techApplies && cmd.techApplies.length > 0) {
          for (const t of cmd.techApplies) {
            if (state.selectedTechTags.includes(t)) {
              perTagCounts.set(t, (perTagCounts.get(t) ?? 0) + 1);
            }
          }
        }
      }
    }

    const covered: string[] = [];
    const gaps: string[] = [];
    for (const t of state.selectedTechTags) {
      if ((perTagCounts.get(t) ?? 0) > 0) covered.push(t);
      else gaps.push(t);
    }

    let status: PhaseStatus;
    if (state.selectedTechTags.length === 0) {
      status = 'no-tags';
    } else if (gaps.length === 0) {
      status = 'covered';
    } else if (covered.length === 0) {
      status = 'gap';
    } else {
      status = 'partial';
    }

    return {
      slug: phase.slug,
      name: phase.name,
      short: phase.short,
      visibleCommands,
      perTagCounts,
      gaps,
      covered,
      status,
    };
  });
}

const STATUS_GLYPH: Record<PhaseStatus, string> = {
  covered: '✓',
  partial: '◐',
  gap: '○',
  'no-tags': '·',
};

const STATUS_COLOR: Record<PhaseStatus, string> = {
  covered: 'text-bone-1',
  partial: 'text-warn',
  gap: 'text-warn',
  'no-tags': 'text-bone-3',
};

/* =================================================== Component */

export function CoveragePulse({ state }: { state: PlaybookState }) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(
    () => computeCoverage(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.engagement, state.targetOS, state.selectedTechTags],
  );

  const totalGaps = useMemo(
    () =>
      rows.reduce(
        (sum, r) => sum + (r.status === 'partial' || r.status === 'gap' ? 1 : 0),
        0,
      ),
    [rows],
  );

  const scrollToAiAssist = () => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('ai-assist-heading');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  /* No-tags case: don\'t pretend per-tag gaps exist. Show a
     compact total-count summary so the user still sees catalog
     depth at a glance. */
  if (state.selectedTechTags.length === 0) {
    const total = rows.reduce((s, r) => s + r.visibleCommands, 0);
    return (
      <div className="border-b border-ink-5/60 px-5 py-2 sm:px-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px]">
          <span className="text-bone-3">
            Coverage:
            <span className="ml-1 text-bone-1">{total} commands</span>
            <span className="ml-1 text-bone-4">
              · pick tech tags below to see per-stack coverage
            </span>
          </span>
          {rows.map((r) => (
            <span
              key={r.slug}
              className="text-bone-3"
              title={`${r.name}: ${r.visibleCommands} command${r.visibleCommands === 1 ? '' : 's'} visible`}
            >
              <span className="text-bone-4">{r.short.toLowerCase()}: </span>
              <span className="text-bone-2">{r.visibleCommands}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-ink-5/60 px-5 py-2 sm:px-8">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="group flex w-full items-baseline gap-3 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3 group-hover:text-bone-1">
          coverage for your stack
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
          {rows.map((r) => (
            <span key={r.slug} className="inline-flex items-baseline gap-0.5">
              <span aria-hidden className={cn(STATUS_COLOR[r.status])}>
                {STATUS_GLYPH[r.status]}
              </span>
              <span className="text-bone-3">{r.short.toLowerCase()}</span>
            </span>
          ))}
        </span>
        {totalGaps > 0 && (
          <span
            className="ml-auto shrink-0 rounded border border-warn/40 bg-warn/[0.08] px-1.5 font-mono text-[9.5px] uppercase tracking-wider text-warn"
            title="Phases where one or more of your selected tags has no commands"
          >
            {totalGaps} gap{totalGaps === 1 ? '' : 's'}
          </span>
        )}
        <span aria-hidden className="shrink-0 text-bone-4">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-1.5">
          {rows.map((r) => (
            <PhaseRow
              key={r.slug}
              row={r}
              selectedTags={state.selectedTechTags}
              onAiFill={scrollToAiAssist}
            />
          ))}
          <div className="mt-2 border-t border-ink-5/60 pt-2 font-mono text-[10.5px] leading-relaxed text-bone-3">
            <span className="text-bone-2">✓</span> all selected tags have
            commands ·{' '}
            <span className="text-warn">◐</span> some tags missing ·{' '}
            <span className="text-warn">○</span> none of your tags have
            commands
            {totalGaps > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={scrollToAiAssist}
                  className="text-warn underline-offset-2 hover:underline"
                >
                  fill gaps with AI Assist ↓
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* =================================================== Phase row */

function PhaseRow({
  row,
  selectedTags,
  onAiFill,
}: {
  row: PhaseCoverage;
  selectedTags: string[];
  onAiFill: () => void;
}) {
  return (
    <div className="grid grid-cols-[3rem_3.5rem_1fr_auto] items-baseline gap-3 font-mono text-[11px]">
      <span aria-hidden className={cn('text-base', STATUS_COLOR[row.status])}>
        {STATUS_GLYPH[row.status]}
      </span>
      <span className="text-bone-2">{row.short}</span>
      <span className="min-w-0 truncate text-bone-3">
        <span className="text-bone-1">{row.visibleCommands}</span> cmd
        {row.visibleCommands === 1 ? '' : 's'}
        {row.gaps.length > 0 && (
          <span>
            <span className="text-bone-4"> · gap: </span>
            <span className="text-warn">
              {row.gaps.map((t) => techTagLabel(t as TechTag)).join(', ')}
            </span>
          </span>
        )}
        {row.covered.length > 0 && row.gaps.length === 0 && selectedTags.length > 0 && (
          <span>
            <span className="text-bone-4"> · all </span>
            <span className="text-bone-2">
              {selectedTags.length} tag{selectedTags.length === 1 ? '' : 's'}
            </span>
          </span>
        )}
      </span>
      {row.gaps.length > 0 ? (
        <button
          type="button"
          onClick={onAiFill}
          className="shrink-0 rounded border border-warn/40 bg-warn/[0.06] px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-warn hover:bg-warn/[0.12]"
        >
          ai-fill ↓
        </button>
      ) : (
        <span className="shrink-0" />
      )}
    </div>
  );
}
