'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { faviconUrl } from '@/lib/favicon';
import {
  PHASES,
  commandItemId,
  itemId,
  type Branch,
  type CommandSnippet,
  type Phase,
  type PhaseStep,
  type PreCheck,
  type ToolKind,
  type ToolRef,
} from '@/lib/methodology';
import { interpolate } from '@/lib/playbook/template';
import { isOSVisible } from '@/lib/target-os';
import { isTechVisible, isTechVisibleStrict } from '@/lib/tech-tags';
import {
  buildSearchIndex,
  cveShortcut,
  searchPlaybook,
  type SearchableItem,
} from '@/lib/playbook/search';
import { AiAssist } from './ai-assist';
import { CoveragePulse } from './coverage-pulse';
import { DefenseThreadback } from './defense-threadback';
import { PlaybookMap } from './map';
import { cn } from '@/lib/cn';
import type { PlaybookState } from './types';

/**
 * `PlaybookFocusView` — the playbook's only working surface.
 *
 * Top-level switcher: **Playbook** | **Search**.
 *
 *   Playbook tab
 *   ─────────────
 *   - Context strip: 5 phase rings + phase name + target input
 *   - Pre-checks (collapsible, auto-collapsed once all done)
 *   - Step strip: numbered dots for each visible step in this phase
 *   - Active step:
 *       - Title + skip control
 *       - Sub-tabs: Step / Commands / Tools (one piece of content at
 *         a time; no scroll under normal load)
 *       - Mark-complete button
 *
 *   Search tab
 *   ──────────
 *   - Search input + inline results from the FLAT_TOOLS catalog.
 *     CVE-shaped queries get a synthesized "Open CVE-X-Y in NVD"
 *     shortcut.
 *
 * No keyboard shortcuts. The playbook is a hand-held checklist; every
 * navigation is a click. No notes, no export — just the walkthrough.
 */

type TopSection = 'playbook' | 'search' | 'map';

export function PlaybookFocusView({ state }: { state: PlaybookState }) {
  const reduce = useReducedMotion();
  const phase = PHASES[state.currentPhase];
  const [topSection, setTopSection] = useState<TopSection>('playbook');

  /* Per-phase activity rollup — visited step count + ran command
     count, recomputed when the inputs change. Replaces the old
     "completion" computation; drives the timeline + per-phase
     activity readouts. */
  const phaseActivity = useMemo(
    () =>
      computePhaseActivity(
        state.engagement,
        state.targetOS,
        state.selectedTechTags,
        state.progress,
        state.visitedSteps,
      ),
    [
      state.engagement,
      state.targetOS,
      state.selectedTechTags,
      state.progress,
      state.visitedSteps,
    ],
  );

  return (
    <motion.section
      aria-label="Pentesting playbook focus view"
      className={cn(
        'overflow-hidden rounded-2xl border border-ink-5 surface-gradient',
        'elev-1',
      )}
    >
      <SectionTabs
        value={topSection}
        onChange={setTopSection}
        searchActive={state.query.trim().length > 0}
      />
      {/* Coverage pulse — single-line "what does the catalog have
          for your stack right now?" summary. Compact by default,
          click to expand into per-phase rows with gap callouts that
          scroll to AI Assist. Replaces the alpha disclaimer\'s
          vague "coverage is uneven" with specific contextual info. */}
      <CoveragePulse state={state} />
      <AnimatePresence mode="wait" initial={false}>
        {topSection === 'playbook' && (
          <motion.div
            key="playbook"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <PlaybookCard
              state={state}
              phase={phase}
              phaseActivity={phaseActivity}
              reduce={reduce}
            />
          </motion.div>
        )}
        {topSection === 'search' && (
          <motion.div
            key="search"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <SearchCard
              state={state}
              onJumpToPlaybook={() => setTopSection('playbook')}
            />
          </motion.div>
        )}
        {topSection === 'map' && (
          <motion.div
            key="map"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <PlaybookMap state={state} />
          </motion.div>
        )}
      </AnimatePresence>
      {/* AI Assist surface — sits beneath the curated focus view
          regardless of active section (Playbook / Search / Map),
          so the user can describe a situation the curated catalog
          doesn\'t cover and get on-demand AI guidance. Generated
          content is per-session, clearly labeled, never auto-merged
          into lib/methodology.ts. Hidden inside this <section> so
          it inherits the same surface-gradient as the focus view
          but is visually distinguished by its own warning-amber
          treatment inside ai-assist.tsx. */}
      <div className="border-t border-ink-5/60 px-5 pt-1 pb-5 sm:px-8 sm:pt-2 sm:pb-7">
        <AiAssist state={state} />
      </div>
    </motion.section>
  );
}

/* =================================================== Section tabs */

function SectionTabs({
  value,
  onChange,
  searchActive,
}: {
  value: TopSection;
  onChange: (v: TopSection) => void;
  searchActive: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Playbook section"
      className="flex border-b border-ink-5/60"
    >
      <TabButton
        active={value === 'playbook'}
        onClick={() => onChange('playbook')}
      >
        Playbook
      </TabButton>
      <TabButton
        active={value === 'search'}
        onClick={() => onChange('search')}
      >
        Search
        {searchActive && (
          <span
            aria-hidden
            className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-bone-1"
          />
        )}
      </TabButton>
      <TabButton
        active={value === 'map'}
        onClick={() => onChange('map')}
      >
        Map
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center gap-1 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-colors',
        active ? 'text-bone-0' : 'text-bone-3 hover:text-bone-1',
      )}
    >
      {children}
      {active && (
        <motion.span
          layoutId="section-tab-underline"
          className="absolute inset-x-3 -bottom-px h-px bg-bone-0"
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
    </button>
  );
}

/* =================================================== Per-phase activity

   Replaces the old "completion" model. Pentesting isn\'t linear —
   "complete" was a fiction, and the per-phase CTA + auto-advance
   wired off it told the user they were on a Gantt chart. The
   honest signals are:

     visited / total  — how many of this phase\'s steps the user has
                        navigated to (auto-tracked, not a manual
                        gesture)
     ran              — how many commands they\'ve ticked as
                        actually executed (drives ATT&CK
                        attribution)

   Both are activity counts, always-true, never claim "done." */

type PhaseActivity = {
  totalSteps: number;
  visitedSteps: number;
  ranCommands: number;
};

function computePhaseActivity(
  engagementId: PlaybookState['engagement'],
  os: PlaybookState['targetOS'],
  techTags: PlaybookState['selectedTechTags'],
  progress: Set<string>,
  visited: Set<string>,
): PhaseActivity[] {
  return PHASES.map((p) => {
    let totalSteps = 0;
    let visitedSteps = 0;
    let ranCommands = 0;
    p.steps.forEach((s, i) => {
      const engOk =
        !s.appliesTo ||
        (engagementId && s.appliesTo.includes(engagementId));
      const osOk = isOSVisible(s.osApplies, os);
      const techOk = isTechVisible(s.techApplies, techTags);
      if (!(engOk && osOk && techOk)) return;
      totalSteps++;
      if (visited.has(`${p.slug}:step:${i}`)) visitedSteps++;
      /* Tick-count for commands inside this step that the user
         marked ran. */
      (s.commands ?? []).forEach((_c, cIdx) => {
        if (progress.has(`${p.slug}:cmd:${i}:${cIdx}`)) ranCommands++;
      });
    });
    return { totalSteps, visitedSteps, ranCommands };
  });
}

/* =================================================== Playbook card */

function PlaybookCard({
  state,
  phase,
  phaseActivity,
  reduce,
}: {
  state: PlaybookState;
  phase: Phase;
  phaseActivity: PhaseActivity[];
  reduce: boolean | null;
}) {
  return (
    <>
      <ContextStrip
        state={state}
        phase={phase}
        activity={phaseActivity}
        reduce={reduce}
      />
      <PreChecksToggle
        phaseSlug={phase.slug}
        preChecks={phase.preChecks}
        engagementId={state.engagement}
        os={state.targetOS}
        techTags={state.selectedTechTags}
        isComplete={state.isComplete}
        onToggle={state.toggleProgress}
      />
      {/* Defense-only thread-back: union of demonstrated ATT&CK
          techniques (from ticked commands). Bridges offense (what
          you did) to defense (what should have caught you). */}
      {phase.slug === 'defense' && (
        <div className="px-5 pt-5 pb-2 sm:px-8 sm:pt-7 sm:pb-3">
          <DefenseThreadback state={state} />
        </div>
      )}
      <StepArea state={state} phase={phase} />
    </>
  );
}

/* =================================================== Context strip */

/** Top of the Playbook card — phase rings + phase name + target input,
 *  in one fused row. Replaces what used to be three separate sections
 *  (timeline / phase header / target bar) so the user has more vertical
 *  budget for the actual step content. */
function ContextStrip({
  state,
  phase,
  activity,
  reduce: _reduce,
}: {
  state: PlaybookState;
  phase: Phase;
  activity: PhaseActivity[];
  reduce: boolean | null;
}) {
  /* Single row: phase circles + phase name + target + activity
     readout. The activity readout (`N visited · M ran`) replaces
     the previous "X / Y complete" — pentesting isn\'t linear,
     "complete" was a fiction. */
  const here = activity[state.currentPhase];
  return (
    <div className="px-5 py-5 sm:px-8 sm:py-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <CompactTimeline
          current={state.currentPhase}
          activity={activity}
          onSelect={state.setPhase}
        />
        <div className="min-w-0 flex-shrink truncate text-base font-medium tracking-tight text-bone-0 sm:text-lg">
          {phase.name}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          <span className="text-bone-2">{here.visitedSteps}</span>
          <span className="text-bone-4"> / {here.totalSteps} visited</span>
          {here.ranCommands > 0 && (
            <>
              {' · '}
              <span className="text-bone-2">{here.ranCommands}</span>
              <span className="text-bone-4"> ran</span>
            </>
          )}
        </div>
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <CompactTargetInput state={state} />
        </div>
      </div>
    </div>
  );
}

function CompactTimeline({
  current,
  activity,
  onSelect,
}: {
  current: number;
  activity: PhaseActivity[];
  onSelect: (i: number) => void;
}) {
  /* Numbered circles in a tight row, connected by a constant
     ink-5 line. The line no longer "fills" between phases on
     completion — there\'s no completion to fill toward. The
     current phase is highlighted; visited phases get a soft
     bone-3 border to show "you\'ve been here." */
  const segmentCount = Math.max(PHASES.length - 1, 1);
  return (
    <ol
      className="relative flex items-center gap-2"
      aria-label="Phase navigator"
    >
      {Array.from({ length: segmentCount }).map((_, i) => (
        <div
          key={`seg-${i}`}
          aria-hidden
          className="absolute top-[14px] h-px bg-ink-5"
          style={{
            left: `calc(14px + (100% - 28px) / ${segmentCount} * ${i})`,
            width: `calc((100% - 28px) / ${segmentCount})`,
          }}
        />
      ))}
      {PHASES.map((p, i) => (
        <CompactCircle
          key={p.slug}
          p={p}
          i={i}
          current={current}
          activity={activity[i]}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

function CompactCircle({
  p,
  i,
  current,
  activity,
  onSelect,
}: {
  p: Phase;
  i: number;
  current: number;
  activity: PhaseActivity;
  onSelect: (i: number) => void;
}) {
  const active = i === current;
  /* "Visited" — the user has navigated to at least one step in
     this phase. Soft border so it\'s a "you\'ve been here" cue,
     not a "this is done" claim. */
  const visited = activity.visitedSteps > 0;
  return (
    <li className="relative z-10">
      <button
        type="button"
        onClick={() => onSelect(i)}
        aria-current={active ? 'step' : undefined}
        aria-label={`${p.name} (phase ${p.index} of ${PHASES.length})${
          activity.visitedSteps > 0
            ? `, ${activity.visitedSteps} of ${activity.totalSteps} steps visited`
            : ''
        }`}
        title={p.name}
        className={cn(
          'relative flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200',
          active
            ? 'border-transparent bg-bone-0 text-ink-0 glow-active'
            : visited
              ? 'border-bone-3/50 bg-ink-2 text-bone-1 hover:text-bone-0'
              : 'border-ink-5 bg-ink-2 text-bone-3 hover:text-bone-1',
        )}
      >
        <span className="font-mono text-[9px]">
          {String(p.index).padStart(2, '0')}
        </span>
      </button>
    </li>
  );
}

function CompactTargetInput({ state }: { state: PlaybookState }) {
  if (!state.engagement) return null;
  const placeholder =
    state.engagement === 'lab'
      ? 'lab IP / hostname'
      : state.engagement === 'private'
        ? 'CIDR / hostname'
        : 'domain / endpoint';
  /* Target is the one input that sits in the always-visible top
     strip — every phase's commands interpolate `{target}`, so it
     belongs where you can always reach it. The discovered-version
     input (used only by vuln-phase commands like searchsploit /
     cvemap) lives in the right-side stack panel, where it's
     co-located with the tech-stack tags it pairs with. */
  return (
    <>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
        Target
      </span>
      <input
        id="playbook-target"
        type="text"
        value={state.target}
        onChange={(e) => state.setTarget(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          'min-w-0 flex-1 border-b border-ink-5/60 bg-transparent px-1 py-1 font-mono text-[13px] text-bone-0 placeholder:text-bone-4',
          'focus:border-bone-1 focus:outline-none',
        )}
      />
    </>
  );
}

/* =================================================== Pre-checks */

function PreChecksToggle({
  phaseSlug,
  preChecks,
  engagementId,
  os,
  techTags,
  isComplete,
  onToggle,
}: {
  phaseSlug: string;
  preChecks: PreCheck[] | undefined;
  engagementId: PlaybookState['engagement'];
  os: PlaybookState['targetOS'];
  techTags: PlaybookState['selectedTechTags'];
  isComplete: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const visible = useMemo(() => {
    if (!preChecks?.length) return [];
    return preChecks
      .map((c, originalIndex) => ({ check: c, originalIndex }))
      .filter(({ check }) => {
        const engOk =
          !check.appliesTo ||
          (engagementId && check.appliesTo.includes(engagementId));
        const osOk = isOSVisible(check.osApplies, os);
        const techOk = isTechVisible(check.techApplies, techTags);
        return engOk && osOk && techOk;
      });
  }, [preChecks, engagementId, os, techTags]);

  const completeCount = visible.filter(({ originalIndex }) =>
    isComplete(itemId(phaseSlug, 'precheck', originalIndex)),
  ).length;
  const allDone = visible.length > 0 && completeCount === visible.length;
  const [expanded, setExpanded] = useState(!allDone);
  const lastSlug = useRef(phaseSlug);
  useEffect(() => {
    if (lastSlug.current !== phaseSlug) {
      setExpanded(!allDone);
      lastSlug.current = phaseSlug;
    }
  }, [phaseSlug, allDone]);

  if (visible.length === 0) return null;

  return (
    <div className="border-t border-ink-5/60 px-5 py-3 sm:px-8">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Pre-checks
          <span className="ml-2 text-bone-4">
            {completeCount} / {visible.length}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            'font-mono text-xs text-bone-4 transition-transform',
            expanded && 'rotate-90',
          )}
        >
          ›
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
            className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1"
          >
            {visible.map(({ check, originalIndex }) => {
              const id = itemId(phaseSlug, 'precheck', originalIndex);
              const done = isComplete(id);
              return (
                <li key={originalIndex}>
                  <CheckboxRow
                    done={done}
                    onToggle={() => onToggle(id)}
                    label={check.text}
                  />
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/* =================================================== Step area */

function StepArea({
  state,
  phase,
}: {
  state: PlaybookState;
  phase: Phase;
}) {
  const visible = useMemo(() => {
    return phase.steps
      .map((s, i) => ({ step: s, originalIndex: i }))
      .filter(({ step }) => {
        const engOk =
          !step.appliesTo ||
          (state.engagement && step.appliesTo.includes(state.engagement));
        const osOk = isOSVisible(step.osApplies, state.targetOS);
        const techOk = isTechVisible(
          step.techApplies,
          state.selectedTechTags,
        );
        return engOk && osOk && techOk;
      });
  }, [phase.steps, state.engagement, state.targetOS, state.selectedTechTags]);

  /* Active step is whatever the user picked; default to the first
     visible step. No more "auto-spotlight on next-uncompleted" —
     completion is gone, so the cue would be meaningless, and the
     auto-jump was confusing the moment a user toggled a tag mid-
     read. Manual navigation only. */
  const activeIdx = Math.min(
    Math.max(state.focusedStepIdx ?? 0, 0),
    Math.max(0, visible.length - 1),
  );
  const focused = visible[activeIdx];

  /* Auto-track "I\'ve been here." Fires on every focused-step
     change; markVisited is a no-op for ids already in the set so
     this is cheap. */
  const focusedStepId = focused
    ? itemId(phase.slug, 'step', focused.originalIndex)
    : null;
  useEffect(() => {
    if (focusedStepId) state.markVisited(focusedStepId);
  }, [focusedStepId, state]);

  if (!focused) {
    return (
      <div className="border-t border-ink-5/60 px-5 py-6 text-sm text-bone-3 sm:px-8">
        No steps for this engagement in this phase.
      </div>
    );
  }

  const id = itemId(phase.slug, 'step', focused.originalIndex);

  return (
    <div className="border-t border-ink-5/60 px-5 py-5 sm:px-8 sm:py-7">
      <StepStrip
        visible={visible}
        activeIdx={activeIdx}
        phaseSlug={phase.slug}
        isVisited={state.isVisited}
        onSelect={(i) => state.setFocusedStepIdx(i)}
      />
      <div className="mx-auto max-w-3xl">
        <StepCard
          key={id}
          step={focused.step}
          id={id}
          phaseSlug={phase.slug}
          stepIndex={focused.originalIndex}
          target={state.target}
          versions={state.versions}
          scratchValues={state.scratchValues}
          engagement={state.engagement}
          os={state.targetOS}
          techTags={state.selectedTechTags}
          isComplete={state.isComplete}
          onToggleProgress={state.toggleProgress}
          onJumpToPhase={(slug) => {
            const idx = PHASES.findIndex((p) => p.slug === slug);
            if (idx >= 0) state.setPhase(idx);
          }}
        />
      </div>
    </div>
  );
}

/* =================================================== Step strip */

function StepStrip({
  visible,
  activeIdx,
  phaseSlug,
  isVisited,
  onSelect,
}: {
  visible: Array<{ step: PhaseStep; originalIndex: number }>;
  activeIdx: number;
  phaseSlug: string;
  /** Per-step "have I been here at least once" lookup. Drives the
   *  visited / unvisited dot styling. */
  isVisited: (stepId: string) => boolean;
  onSelect: (i: number) => void;
}) {
  /* Numbered dots connected by a constant ink-5 line. The dots
     style by visited / current / unvisited — there\'s no
     "complete" anymore (steps don\'t have completion). The
     reset-phase button is gone (per-phase reset doesn\'t apply
     when there\'s no per-phase completion to reset); use the
     global reset in the welcome modal. */
  const segmentCount = Math.max(visible.length - 1, 1);

  return (
    <div className="mb-3">
      <ol className="relative flex items-center gap-1.5">
        {visible.length > 1 &&
          Array.from({ length: segmentCount }).map((_, i) => (
            <div
              key={`seg-${i}`}
              aria-hidden
              className="absolute top-[12px] h-px bg-ink-5"
              style={{
                left: `calc(12px + (100% - 24px) / ${segmentCount} * ${i})`,
                width: `calc((100% - 24px) / ${segmentCount})`,
              }}
            />
          ))}
        {visible.map(({ step, originalIndex }, i) => {
          const id = itemId(phaseSlug, 'step', originalIndex);
          const visited = isVisited(id);
          const active = i === activeIdx;
          const num = String(i + 1).padStart(2, '0');
          return (
            <li key={originalIndex} className="relative z-10">
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={active ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${step.title}${visited ? ' (visited)' : ''}`}
                title={step.title}
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[9px] transition-all',
                  active
                    ? 'border-transparent bg-bone-0 text-ink-0 glow-active'
                    : visited
                      ? 'border-bone-3/50 bg-ink-2 text-bone-1 hover:text-bone-0'
                      : 'border-ink-5 bg-ink-2 text-bone-3 hover:text-bone-1',
                )}
              >
                {num}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* =================================================== Step card */

type StepSubTab = 'step' | 'commands' | 'tools';

/** The active step's body. No card chrome — the content flows in the
 *  parent surface so it doesn't read as "card within a card". Sub-tabs
 *  show one piece of content at a time (Step / Commands / Tools); the
 *  default is Step (description + branches). The findings textarea was
 *  removed — this is a hand-holding checklist, not a notebook. */
function StepCard({
  step,
  phaseSlug,
  stepIndex,
  target,
  versions,
  scratchValues,
  engagement,
  os,
  techTags,
  isComplete,
  onToggleProgress,
  onJumpToPhase,
}: {
  step: PhaseStep;
  id: string;
  /** Used to derive per-command ids for the per-command checkboxes —
   *  `commandItemId(phaseSlug, stepIndex, originalIndex)`. The
   *  originalIndex is the command\'s position in the unfiltered
   *  `step.commands` array (preserved through the visibleCommands
   *  filter). */
  phaseSlug: string;
  stepIndex: number;
  target: string;
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  engagement: PlaybookState['engagement'];
  os: PlaybookState['targetOS'];
  techTags: PlaybookState['selectedTechTags'];
  /** Generic completion lookup — used by per-command checkboxes. */
  isComplete: (id: string) => boolean;
  /** Per-id completion toggle for the per-command "ran" checkbox.
   *  Flips `${phaseSlug}:cmd:${stepIdx}:${cmdIdx}` in progress. */
  onToggleProgress: (id: string) => void;
  onJumpToPhase: (slug: string) => void;
}) {
  /* Filter the step's commands + tools by all three axes
     (engagement, OS, tech). If a filter eliminates ALL commands
     (or all tools), the corresponding sub-tab disappears.

     `requiresTechSelection` flips tech filtering into strict mode
     for this step — tagged items hide unless tags are picked. Use
     for discovery-time steps where the user hasn\'t committed to a
     stack yet (otherwise they\'d see every per-tech probe at once). */
  const matchesEngagement = (
    appliesTo: PhaseStep['appliesTo'],
  ): boolean =>
    !appliesTo ||
    appliesTo.length === 0 ||
    (engagement !== null && appliesTo.includes(engagement));
  const techCheck = step.requiresTechSelection
    ? isTechVisibleStrict
    : isTechVisible;
  /* Preserve the ORIGINAL command index after filtering — that\'s
     what `commandItemId(...)` keys off, so toggling per-command
     completion always points at the same underlying command even
     after the user changes their tag/OS filter mid-stream. */
  const visibleCommands = useMemo(
    () =>
      (step.commands ?? [])
        .map((c, originalIndex) => ({ command: c, originalIndex }))
        .filter(
          ({ command: c }) =>
            matchesEngagement(c.appliesTo) &&
            isOSVisible(c.osApplies, os) &&
            techCheck(c.techApplies, techTags),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step.commands, engagement, os, techTags, step.requiresTechSelection],
  );
  const visibleTools = useMemo(
    () =>
      (step.tools ?? []).filter(
        (t) =>
          matchesEngagement(t.appliesTo) &&
          isOSVisible(t.osApplies, os) &&
          techCheck(t.techApplies, techTags),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step.tools, engagement, os, techTags, step.requiresTechSelection],
  );
  /* Tab-visibility uses the *raw* counts (not the filtered counts) so
     a step with commands stays addressable even when the user's
     current filter set hides every one of them — they need to see the
     "X hidden" / "pick a stack" message rather than wonder why the
     Commands tab vanished. The empty-state copy lives inside the tab
     itself. */
  const totalCommands = step.commands?.length ?? 0;
  const totalTools = step.tools?.length ?? 0;
  const hiddenCommands = totalCommands - visibleCommands.length;
  const hiddenTools = totalTools - visibleTools.length;
  const hasCommands = totalCommands > 0;
  const hasTools = totalTools > 0;
  const noTagsPicked = techTags.length === 0;
  /* Strict-mode hint applies when the step opted into strict tech
     filtering, the user has no tags picked, and at least one of the
     hidden commands is in fact tag-gated. */
  const showStrictHint =
    !!step.requiresTechSelection && noTagsPicked && hiddenCommands > 0;

  const tabs = useMemo<StepSubTab[]>(() => {
    const t: StepSubTab[] = ['step'];
    if (hasCommands) t.push('commands');
    if (hasTools) t.push('tools');
    return t;
  }, [hasCommands, hasTools]);

  const [tab, setTab] = useState<StepSubTab>('step');
  useEffect(() => {
    if (!tabs.includes(tab)) setTab('step');
  }, [tabs, tab]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <StepCardHeader title={step.title} />

      {tabs.length > 1 && (
        <SubTabs value={tab} tabs={tabs} onChange={setTab} />
      )}

      <div className="mt-4">
        {tab === 'step' && (
          <SubTabStep step={step} onJumpToPhase={onJumpToPhase} />
        )}
        {tab === 'commands' && hasCommands && (
          <SubTabCommands
            commands={visibleCommands}
            phaseSlug={phaseSlug}
            stepIndex={stepIndex}
            target={target}
            versions={versions}
            scratchValues={scratchValues}
            isComplete={isComplete}
            onToggleProgress={onToggleProgress}
            hiddenCount={hiddenCommands}
            showStrictHint={showStrictHint}
          />
        )}
        {tab === 'tools' && hasTools && (
          <SubTabTools tools={visibleTools} hiddenCount={hiddenTools} />
        )}
      </div>
    </motion.div>
  );
}

function StepCardHeader({ title }: { title: string }) {
  /* Just the title. Done/not-done is already conveyed by the strip dot
     color and the mark-complete button below. */
  return (
    <h3 className="text-2xl font-medium tracking-tight text-bone-0 sm:text-3xl">
      {title}
    </h3>
  );
}

function SubTabs({
  value,
  tabs,
  onChange,
}: {
  value: StepSubTab;
  tabs: StepSubTab[];
  onChange: (t: StepSubTab) => void;
}) {
  const labels: Record<StepSubTab, string> = {
    step: 'Step',
    commands: 'Commands',
    tools: 'Tools',
  };
  return (
    <div className="mt-5 flex flex-wrap items-center gap-1 border-b border-ink-5/60">
      {tabs.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t)}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
              active ? 'text-bone-0' : 'text-bone-3 hover:text-bone-1',
            )}
          >
            {labels[t]}
            {active && (
              <motion.span
                layoutId="step-subtab-underline"
                className="absolute inset-x-2 -bottom-px h-px bg-bone-0"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* =================================================== Sub-tab contents */

function SubTabStep({
  step,
  onJumpToPhase,
}: {
  step: PhaseStep;
  onJumpToPhase: (slug: string) => void;
}) {
  return (
    <div>
      <p className="text-base text-bone-1">
        {step.description}
      </p>
      {step.branches && step.branches.length > 0 && (
        <BranchChips
          branches={step.branches}
          onJumpToPhase={onJumpToPhase}
        />
      )}
    </div>
  );
}

function SubTabCommands({
  commands,
  phaseSlug,
  stepIndex,
  target,
  versions,
  scratchValues,
  isComplete,
  onToggleProgress,
  hiddenCount,
  showStrictHint,
}: {
  /** Each entry pairs a command with its ORIGINAL index in the
   *  unfiltered `step.commands` array, so per-command checkbox ids
   *  remain stable across filter changes. */
  commands: Array<{ command: CommandSnippet; originalIndex: number }>;
  phaseSlug: string;
  stepIndex: number;
  target: string;
  /** Per-tag versions map. Each `CommandBlock` resolves `{version}`
   *  against its own `techApplies` tag(s); commands with no tag
   *  context fall back to the placeholder. */
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  isComplete: (id: string) => boolean;
  onToggleProgress: (id: string) => void;
  /** Count of step-commands that the current filter set is hiding.
   *  Used to render an unobtrusive "X hidden by your filters" line so
   *  the user knows there's more behind the curtain. */
  hiddenCount: number;
  /** When true and `commands.length === 0`, render the strict-mode
   *  hint instead of an empty list. The Commands tab is intentionally
   *  kept addressable in that state so this hint has somewhere to live. */
  showStrictHint: boolean;
}) {
  if (commands.length === 0) {
    return (
      <FilterEmptyState
        hiddenCount={hiddenCount}
        showStrictHint={showStrictHint}
        kind="commands"
      />
    );
  }
  const ranCount = commands.filter(({ originalIndex }) =>
    isComplete(commandItemId(phaseSlug, stepIndex, originalIndex)),
  ).length;
  return (
    <div className="space-y-3">
      {hiddenCount > 0 && (
        <FilterHiddenNote count={hiddenCount} kind="commands" />
      )}
      <p className="font-mono text-[10.5px] text-bone-3">
        Tick a command after you actually run it. Only ticked
        commands count toward the ATT&amp;CK technique mapping in
        the Map view + the defense thread-back.{' '}
        <span className="text-bone-2">
          {ranCount}/{commands.length} ticked
        </span>
      </p>
      <ul className="space-y-2">
        {commands.map(({ command, originalIndex }) => {
          const cmdId = commandItemId(phaseSlug, stepIndex, originalIndex);
          return (
            <li key={originalIndex}>
              <CommandBlock
                snippet={command}
                target={target}
                versions={versions}
                scratchValues={scratchValues}
                ran={isComplete(cmdId)}
                onToggleRan={() => onToggleProgress(cmdId)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SubTabTools({
  tools,
  hiddenCount,
}: {
  tools: ToolRef[];
  hiddenCount: number;
}) {
  if (tools.length === 0) {
    return (
      <FilterEmptyState
        hiddenCount={hiddenCount}
        showStrictHint={false}
        kind="tools"
      />
    );
  }
  return (
    <div className="space-y-3">
      {hiddenCount > 0 && (
        <FilterHiddenNote count={hiddenCount} kind="tools" />
      )}
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {tools.map((t) => (
          <li key={`${t.url}:${t.name}`}>
            <ToolRow tool={t} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One-line note above the sub-tab body when the current filter set
 *  is hiding entries. Deliberately quiet — bone-3 mono — so it reads
 *  as metadata, not as an error. */
function FilterHiddenNote({
  count,
  kind,
}: {
  count: number;
  kind: 'commands' | 'tools';
}) {
  return (
    <p className="font-mono text-[11px] text-bone-3">
      <span aria-hidden className="text-bone-4">
        ·{' '}
      </span>
      {count} more {kind} {count === 1 ? 'is' : 'are'} hidden by your
      current filters. Adjust the stack panel to surface them.
    </p>
  );
}

/** Sub-tab body when the current filter eliminates every entry. Two
 *  variants: strict-mode (gentle nudge to pick a stack) and the
 *  general "filtered out" case (every command exists but is gated by
 *  some axis you've narrowed). */
function FilterEmptyState({
  hiddenCount,
  showStrictHint,
  kind,
}: {
  hiddenCount: number;
  showStrictHint: boolean;
  kind: 'commands' | 'tools';
}) {
  if (showStrictHint) {
    return (
      <div className="rounded-md border border-dashed border-ink-5 bg-ink-2/40 px-4 py-3">
        <p className="font-mono text-[11.5px] leading-relaxed text-bone-2">
          Pick a tech stack on the right to surface per-stack {kind}.
        </p>
        <p className="mt-1 font-mono text-[10.5px] text-bone-3">
          {hiddenCount} {kind === 'commands' ? 'command' : 'tool'}
          {hiddenCount === 1 ? '' : 's'} {hiddenCount === 1 ? 'is' : 'are'}{' '}
          gated until you choose what&rsquo;s on the target.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-ink-5 bg-ink-2/40 px-4 py-3">
      <p className="font-mono text-[11.5px] leading-relaxed text-bone-2">
        No {kind} match your current filters.
      </p>
      <p className="mt-1 font-mono text-[10.5px] text-bone-3">
        {hiddenCount} {hiddenCount === 1 ? 'is' : 'are'} hidden — adjust
        engagement, OS, or tech tags to surface them.
      </p>
    </div>
  );
}

/* =================================================== Branch chips */

function BranchChips({
  branches,
  onJumpToPhase,
}: {
  branches: Branch[];
  onJumpToPhase: (slug: string) => void;
}) {
  return (
    <ul className="mt-4 flex flex-wrap items-center gap-2">
      <li>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Branches ::
        </span>
      </li>
      {branches.map((b, i) => {
        const target = PHASES.find((p) => p.slug === b.goto);
        if (!target) return null;
        return (
          <li key={`${b.if}-${i}`}>
            <button
              type="button"
              onClick={() => onJumpToPhase(b.goto)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border border-ink-5 bg-ink-2/40 px-2.5 py-1 text-xs text-bone-2 transition-colors',
                'hover:border-bone-4 hover:bg-ink-2 hover:text-bone-0',
              )}
              title={`Jump to phase ${target.index} — ${target.name}`}
            >
              <span className="text-bone-3">if</span>
              <span>{b.if}</span>
              <span aria-hidden className="text-bone-4">→</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-bone-1">
                {target.short}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* =================================================== Commands + tools shared */

function CommandBlock({
  snippet,
  target,
  versions,
  scratchValues,
  ran,
  onToggleRan,
}: {
  snippet: CommandSnippet;
  target: string;
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  /** Has the user actually run this specific command? Drives the
   *  per-command checkbox + the muted-strikethrough visual when
   *  ticked, and (via state.progress) feeds the ATT&CK attribution
   *  in the Map view + DefenseThreadback. */
  ran: boolean;
  onToggleRan: () => void;
}) {
  /* Resolve `{version}` per-command: walk the snippet's techApplies
     tags in order, return the first one that has a version set. A
     command tagged `["wordpress"]` resolves to `versions.wordpress`
     even if the user has also entered an apache version. Commands
     without a tag context (`techApplies` is empty/null) get the
     empty string — interpolate() falls back to the `<version>`
     placeholder so the user sees there's no version to thread in. */
  const resolvedVersion = useMemo(() => {
    for (const tag of snippet.techApplies ?? []) {
      const v = versions[tag];
      if (v && v.length > 0) return v;
    }
    return '';
  }, [snippet.techApplies, versions]);
  const rendered = useMemo(
    () =>
      interpolate(
        snippet.command,
        { target, version: resolvedVersion },
        scratchValues,
      ),
    [snippet.command, target, resolvedVersion, scratchValues],
  );
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(rendered).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border surface-gradient elev-1 transition-shadow',
        ran ? 'border-bone-1/50' : 'border-ink-5',
      )}
    >
      {(snippet.label || ran !== undefined) && (
        <div className="flex items-center justify-between gap-2 border-b border-ink-5 bg-ink-2/40 px-3 py-1">
          <RanCheckbox ran={ran} label={snippet.label} onToggle={onToggleRan} />
          {snippet.validated && <ValidatedBadge validated={snippet.validated} />}
        </div>
      )}
      <div
        className={cn(
          'flex items-start gap-2 px-3 py-2',
          ran && 'opacity-70',
        )}
      >
        <span aria-hidden className="select-none font-mono text-xs text-bone-4">
          $
        </span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[12.5px] leading-relaxed text-bone-1">
          {rendered}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy command to clipboard'}
          title={copied ? 'copied' : 'copy'}
          className={cn(
            'shrink-0 rounded border border-ink-5 bg-ink-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
            copied
              ? 'border-bone-1 text-bone-0'
              : 'text-bone-3 hover:border-bone-4 hover:text-bone-0',
          )}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}

/** Per-command "I ran this" checkbox in the command-block header.
 *  Lives next to the snippet label (or alone if the snippet has
 *  none). Bone-1 outline + filled glyph when ticked; ink-5 dashed
 *  outline when not. The label text takes most of the row so the
 *  checkbox feels secondary — the action is still "copy and run,"
 *  ticking is a reporting affordance. */
function RanCheckbox({
  ran,
  label,
  onToggle,
}: {
  ran: boolean;
  label?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={ran}
      title={ran ? 'Marked as run — click to un-mark' : 'Click after you run this command'}
      className="group flex min-w-0 flex-1 items-center gap-2 text-left"
    >
      <span
        aria-hidden
        style={{
          borderColor: ran ? 'var(--color-bone-0)' : 'var(--color-bone-4)',
          background: ran ? 'var(--color-bone-0)' : 'transparent',
          borderStyle: ran ? 'solid' : 'dashed',
        }}
        className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border"
      >
        {ran && (
          <svg
            width="8"
            height="8"
            viewBox="0 0 10 10"
            fill="none"
            stroke="var(--color-ink-0)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 5.5L4 7.5L8 3" />
          </svg>
        )}
      </span>
      <span
        className={cn(
          'truncate font-mono text-[10px] uppercase tracking-wider transition-colors',
          ran
            ? 'text-bone-2'
            : 'text-bone-3 group-hover:text-bone-1',
        )}
      >
        {label ?? 'mark as run'}
      </span>
    </button>
  );
}

/** Small "✓ validated YYYY-MM-DD" chip rendered next to the
 *  RanCheckbox when a command\'s schema carries the `validated`
 *  block (see CommandSnippet in lib/methodology.ts). Surfaces
 *  human-verified provenance to the user — distinguishes "this
 *  has been run on a real target by a maintainer" from
 *  "AI-drafted or legacy, unmarked." Hover shows the date + any
 *  caveat notes; the chip itself is decorative-only (no
 *  interaction). */
function ValidatedBadge({
  validated,
}: {
  validated: NonNullable<CommandSnippet['validated']>;
}) {
  /* Staleness: 180 days = roughly two release cycles for most
     security tools. Past that, surface a softer treatment so the
     user knows to spot-check. */
  const ageDays = Math.floor(
    (Date.now() - new Date(validated.on).getTime()) / 86_400_000,
  );
  const stale = ageDays > 180;
  const title = `validated ${validated.on}${
    validated.notes ? ` — ${validated.notes}` : ''
  }${stale ? ` (${ageDays} days ago — re-check)` : ''}`;
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded border px-1 font-mono text-[9px] uppercase tracking-wider',
        stale
          ? 'border-bone-4/50 text-bone-4'
          : 'border-bone-1/40 text-bone-2',
      )}
    >
      <span aria-hidden>✓</span>
      <span>{stale ? 'val · stale' : 'val'}</span>
    </span>
  );
}

function ToolRow({ tool }: { tool: ToolRef }) {
  const fav = faviconUrl(tool.url);
  return (
    <a
      href={tool.url}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex items-center gap-2.5 rounded-md border border-ink-5 bg-ink-2/40 px-2.5 py-1.5 transition-colors hover:border-bone-4 hover:bg-ink-2"
    >
      {fav ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={fav}
          alt=""
          aria-hidden
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          className="h-[14px] w-[14px] shrink-0 rounded-sm bg-ink-2/60 ring-1 ring-inset ring-ink-5"
        />
      ) : (
        <span className="h-[14px] w-[14px] shrink-0" aria-hidden />
      )}
      <KindBadge kind={tool.kind} />
      <span className="text-sm text-bone-1 group-hover:text-bone-0">{tool.name}</span>
      {tool.note && (
        <span className="hidden truncate text-[12px] text-bone-3 sm:inline">
          — {tool.note}
        </span>
      )}
      <span
        aria-hidden
        className="ml-auto text-bone-3 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
      >
        ↗
      </span>
    </a>
  );
}

function KindBadge({ kind }: { kind: ToolKind }) {
  const label =
    kind === 'web' ? 'WEB' : kind === 'cli' ? 'CLI' : 'GUI';
  return (
    <span className="rounded border border-ink-5 bg-ink-2 px-1 py-0.5 font-mono text-[9px] tracking-wider text-bone-3">
      {label}
    </span>
  );
}

/* =================================================== Phase complete CTA */

function PhaseCompleteCTA({
  current,
  onNext,
}: {
  current: number;
  onNext: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const isLast = current >= PHASES.length - 1;
  const next = isLast ? null : PHASES[current + 1];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -2, height: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      style={{ overflow: 'hidden' }}
    >
      <div className="flex flex-col items-start gap-3 border-t border-bone-0/30 bg-gradient-to-b from-ink-2/50 to-transparent px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-2">
            Phase complete
          </div>
          <p className="mt-1 text-base text-bone-1 sm:text-lg">
            {isLast
              ? 'Walkthrough complete — every phase done.'
              : 'Every item in this phase is checked.'}
          </p>
        </div>
        {next && (
          <button
            ref={ref}
            type="button"
            onClick={onNext}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-bone-0 bg-bone-0 px-5 font-mono text-[11px] uppercase tracking-wider text-ink-0 transition-all hover:bg-transparent hover:text-bone-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone-0"
          >
            Continue → {next.short}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/* =================================================== Search card */

/**
 * The Search top-level section. Now a full search surface over the
 * playbook itself: phases, steps (with their tool refs and command
 * labels in the haystack), and the legacy FLAT_TOOLS catalog. Each
 * result knows what kind of thing it is and where it goes — phase /
 * step results jump in-app (and switch back to the Playbook tab),
 * tool results open the URL.
 *
 * CVE-shaped queries (`cve-2024-1234`) get a synthesized "Open in NVD"
 * shortcut prepended ahead of regular matches. Auto-focuses the input
 * on mount so switching to this tab puts the cursor where it belongs.
 */
function SearchCard({
  state,
  onJumpToPlaybook,
}: {
  state: PlaybookState;
  onJumpToPlaybook: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  /* Index rebuilds when engagement changes — engagement-filtered steps
     change which items are reachable. */
  const index = useMemo(
    () => buildSearchIndex(state.engagement),
    [state.engagement],
  );

  const trimmed = state.query.trim();
  const cve = useMemo(() => cveShortcut(trimmed), [trimmed]);
  const matched = useMemo(
    () => searchPlaybook(index, trimmed),
    [index, trimmed],
  );

  const total = (cve ? 1 : 0) + matched.length;
  const showResults = trimmed.length >= 2 || cve !== null;

  /* Dispatch a search-result click. Phase / step results update state
     and bounce back to the Playbook tab; URL results open externally
     and remember the open in `state.recents`. */
  const dispatch = (item: SearchableItem) => {
    switch (item.action.type) {
      case 'phase':
        state.setPhase(item.action.phaseIndex);
        state.setFocusedStepIdx(null);
        onJumpToPlaybook();
        break;
      case 'step':
        state.setPhase(item.action.phaseIndex);
        state.setFocusedStepIdx(item.action.visibleStepIdx);
        onJumpToPlaybook();
        break;
      case 'url':
        state.commitOpen(item.action.url);
        window.open(item.action.url, '_blank', 'noopener,noreferrer');
        break;
    }
  };

  return (
    <div className="px-5 py-5 sm:px-8 sm:py-6">
      <div className="flex items-center gap-3 rounded-lg border border-ink-5 bg-ink-2/30 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Search ::
        </span>
        <input
          ref={inputRef}
          type="text"
          value={state.query}
          onChange={(e) => state.setQuery(e.target.value)}
          placeholder="search phases, steps, tools — or a cve id"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className={cn(
            'min-w-0 flex-1 bg-transparent font-mono text-sm text-bone-0 placeholder:text-bone-4',
            'focus:outline-none',
          )}
        />
        {state.query && (
          <button
            type="button"
            onClick={() => state.setQuery('')}
            aria-label="Clear search"
            className="font-mono text-[10px] uppercase tracking-wider text-bone-4 transition-colors hover:text-bone-0"
          >
            clear
          </button>
        )}
      </div>

      {showResults ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-bone-4">
            <span>
              {total} {total === 1 ? 'match' : 'matches'}
            </span>
          </div>
          <ul className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
            {cve && (
              <li>
                <SearchResultRow item={cve} onSelect={dispatch} />
              </li>
            )}
            {matched.map(({ item }) => (
              <li key={item.id}>
                <SearchResultRow item={item} onSelect={dispatch} />
              </li>
            ))}
            {total === 0 && (
              <li className="font-mono text-[11px] text-bone-3">
                No matches. Try a different word, or a phase / tool name.
              </li>
            )}
          </ul>
        </div>
      ) : (
        <p className="mt-4 max-w-md font-mono text-[11px] text-bone-3">
          Type at least 2 characters. Search runs across phases, steps,
          and the tool catalog. CVE ids (e.g.{' '}
          <span className="px-1 text-bone-1">cve-2024-1234</span>) jump
          straight to NVD.
        </p>
      )}

      {state.recents.length > 0 && !showResults && (
        <div className="mt-6">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-bone-4">
            Recent
          </div>
          <ul className="space-y-1">
            {state.recents
              .map((u) => findUrlItem(index, u))
              .filter((i): i is SearchableItem => i !== null)
              .slice(0, 6)
              .map((item) => (
                <li key={item.id}>
                  <SearchResultRow item={item} onSelect={dispatch} />
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<SearchableItem['kind'], string> = {
  phase: 'PHASE',
  step: 'STEP',
  tool: 'TOOL',
  command: 'CMD',
  attack: 'ATT&CK',
};

/** Find a URL-action item in the search index. Used by the Recent
 *  panel to look up entries by URL — recents track URLs (set by
 *  `state.commitOpen`), and the index already deduped tool entries
 *  across step-tools + FLAT_TOOLS, so this is the right place to
 *  resolve them. */
function findUrlItem(
  index: SearchableItem[],
  url: string,
): SearchableItem | null {
  for (const item of index) {
    if (item.action.type === 'url' && item.action.url === url) return item;
  }
  return null;
}

function SearchResultRow({
  item,
  onSelect,
}: {
  item: SearchableItem;
  onSelect: (item: SearchableItem) => void;
}) {
  const isUrl = item.action.type === 'url';
  const fav = isUrl
    ? faviconUrl((item.action as { type: 'url'; url: string }).url)
    : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group flex w-full items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-ink-5 hover:bg-ink-2/40"
    >
      {/* Kind badge — small mono pill, distinct per item kind so a glance
          tells the user what each result is and where it goes. */}
      <span
        className={cn(
          'shrink-0 rounded border px-1 py-0.5 font-mono text-[9px] tracking-wider',
          item.kind === 'tool' || item.kind === 'attack'
            ? 'border-ink-5 bg-ink-2 text-bone-3'
            : 'border-bone-3/50 bg-ink-2 text-bone-1',
        )}
      >
        {KIND_LABEL[item.kind]}
      </span>
      {/* Favicon only for URL items — phase/step results have no remote
          icon to show. */}
      {fav ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={fav}
          alt=""
          aria-hidden
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          className="h-[14px] w-[14px] shrink-0 rounded-sm bg-ink-2/60 ring-1 ring-inset ring-ink-5"
        />
      ) : (
        <span className="h-[14px] w-[14px] shrink-0" aria-hidden />
      )}
      <span className="truncate text-sm text-bone-1 group-hover:text-bone-0">
        {item.title}
      </span>
      {item.subtitle && (
        <span className="hidden truncate text-[12px] text-bone-3 sm:inline">
          — {item.subtitle}
        </span>
      )}
      <span
        aria-hidden
        className="ml-auto text-bone-3 opacity-0 transition-opacity group-hover:opacity-100"
      >
        {isUrl ? '↗' : '→'}
      </span>
    </button>
  );
}

/* =================================================== Helpers
   `itemId(...)` is imported at the top of the file from
   lib/methodology.ts so other components (defense thread-back,
   future cheat-sheet variants) can derive the same id format
   without duplicating the convention. */

function CheckboxRow({
  done,
  onToggle,
  label,
}: {
  done: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      className={cn(
        'group flex w-full items-start gap-3 rounded-md py-1 text-left transition-colors',
        done ? 'text-bone-3' : 'text-bone-1 hover:text-bone-0',
      )}
    >
      <span className="mt-0.5 shrink-0">
        <CheckboxGlyph done={done} />
      </span>
      <span className="text-sm">{label}</span>
    </button>
  );
}

function CheckboxGlyph({ done }: { done: boolean }) {
  return (
    <motion.span
      role="presentation"
      aria-hidden
      initial={false}
      animate={done ? { scale: [0.85, 1.18, 1] } : { scale: 1 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{
        width: 16,
        height: 16,
        borderColor: done ? 'var(--color-bone-0)' : 'var(--color-bone-3)',
        background: done ? 'var(--color-bone-0)' : 'transparent',
      }}
      className="inline-flex shrink-0 items-center justify-center rounded-sm border transition-colors"
    >
      {done && (
        <svg
          width="11"
          height="11"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--color-ink-0)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <motion.path
            d="M2 5.5L4 7.5L8 3"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
      )}
    </motion.span>
  );
}
