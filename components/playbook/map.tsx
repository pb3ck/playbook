'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PHASES, itemId, type Phase } from '@/lib/methodology';
import { isOSVisible } from '@/lib/target-os';
import {
  TECH_TAG_GROUPS,
  isTechVisible,
  isTechVisibleStrict,
  techTagLabel,
  type TechTag,
} from '@/lib/tech-tags';
import { extractScratchTokens } from '@/lib/playbook/template';
import { parseSessionSnapshot } from '@/lib/playbook/session';
import { cn } from '@/lib/cn';
import { InfraMap as InfraMapCanvas } from './infra-map';
import type { PlaybookState } from './types';

/**
 * Map view — third top-level section (alongside Playbook and
 * Search). Two parts:
 *
 *   1. **Engagement Builder.** What used to be the right-side
 *      context panel inside the focus view: tag picker, per-tag
 *      versions, scratch-value editor, change-diff toast, reset.
 *      Collapsible so the canvas below can claim the full viewport.
 *
 *   2. **Infrastructure attack graph.** Built by the user, hosts /
 *      services / findings / credentials with ATT&CK pins + SVG
 *      export. The actual centerpiece of this view.
 */
export function PlaybookMap({ state }: { state: PlaybookState }) {
  /* Auto-detect scratch tokens from the focused step\'s commands.
     Computed here (not in StepArea) since the builder lives on
     this tab now and Map needs to render the editor independently
     of which tab is open. Mirrors the same filter the focus view
     applies, so the editor surfaces tokens the user can actually
     see + is about to copy. */
  const scratchTokens = useMemo(
    () => focusedStepScratchTokens(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.currentPhase,
      state.focusedStepIdx,
      state.engagement,
      state.targetOS,
      state.selectedTechTags,
      state.progress,
    ],
  );

  return (
    <div className="px-5 py-6 sm:px-8 sm:py-8">
      <header className="mb-5">
        <h2 className="text-lg font-medium tracking-tight text-bone-0 sm:text-xl">
          Engagement map
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-bone-3">
          Build the infrastructure attack graph below — hosts,
          services, vulns, creds. Pin ATT&amp;CK techniques to the
          node you demonstrated them against. Stack configuration is
          tucked into the builder above (closed by default so the
          canvas gets the full viewport).
        </p>
      </header>

      {/* Builder is collapsible so the infra canvas can claim the
          full viewport. Default closed — the user opens it to
          tweak tags / versions / scratch and closes again to
          maximise canvas space. <details> gives us a native
          disclosure with no extra state. */}
      <details className="mb-6 rounded-xl border border-ink-5/60 surface-gradient elev-1">
        <summary className="cursor-pointer list-none px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-bone-2 transition-colors marker:hidden hover:text-bone-0">
          <span aria-hidden className="mr-2 inline-block transition-transform">▸</span>
          Engagement builder ::{' '}
          <span className="text-bone-4">
            {state.selectedTechTags.length} tag
            {state.selectedTechTags.length === 1 ? '' : 's'} ·{' '}
            {Object.keys(state.versions).length} version
            {Object.keys(state.versions).length === 1 ? '' : 's'} set
          </span>
        </summary>
        <div className="border-t border-ink-5/60 px-4 py-4">
          <EngagementBuilder
            state={state}
            scratchTokens={scratchTokens}
          />
        </div>
      </details>

      {/* Infra canvas — full-width centerpiece. Hidden below `lg`
          since the drag-to-rearrange + node-cluster layout doesn\'t
          fit usefully at phone widths. The placeholder tells mobile
          visitors what they\'re missing without pretending the
          canvas works at 375px. */}
      <div className="hidden lg:block">
        <InfraMapCanvas state={state} />
      </div>
      <div className="lg:hidden rounded-xl border border-dashed border-ink-5/60 surface-gradient elev-1 p-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-bone-3">
          Map · desktop only
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm text-bone-2">
          The infrastructure attack-graph needs more horizontal room
          than a phone affords — drag-to-rearrange nodes and the
          ATT&amp;CK overlays both want a wide viewport. Open this
          tab on a laptop or larger.
        </p>
      </div>
    </div>
  );
}

/* =================================================== Builder */

/** Configurable surface — tag picker, per-tag versions, scratch
 *  editor, reset. Migrated from `<ContextPanel>` inside the focus
 *  view. */
function EngagementBuilder({
  state,
  scratchTokens,
}: {
  state: PlaybookState;
  scratchTokens: string[];
}) {
  const selected = state.selectedTechTags;
  const count = selected.length;
  const phase = PHASES[state.currentPhase];
  const diff = useTagDiff(state, phase);

  return (
    <aside aria-label="Engagement builder" className="min-w-0">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Stack ::{' '}
          <span className="text-bone-4">
            {count === 0 ? 'no filter' : `${count} selected`}
          </span>
        </span>
        {count > 0 && (
          <button
            type="button"
            onClick={state.clearTechTags}
            className="font-mono text-[10px] uppercase tracking-wider text-bone-4 transition-colors hover:text-bone-0"
          >
            clear
          </button>
        )}
      </header>
      <DiffToast diff={diff} />

      <p className="mb-4 max-w-xs font-mono text-[11px] leading-relaxed text-bone-3">
        Pick what&rsquo;s on the target. Commands + tools tagged for
        these stacks surface; others stay hidden until you pick them.
        Empty = show everything.
      </p>

      <div className="space-y-4">
        {TECH_TAG_GROUPS.map((group) => (
          <TagGroup
            key={group.label}
            group={group}
            selected={selected}
            onToggle={state.toggleTechTag}
          />
        ))}
      </div>

      <VersionsBlock
        selected={selected}
        versions={state.versions}
        onSet={state.setVersion}
        onClearAll={state.clearVersions}
      />

      {scratchTokens.length > 0 && (
        <ScratchEditor
          tokens={scratchTokens}
          values={state.scratchValues}
          onSet={state.setScratchValue}
          onClearAll={state.clearScratchValues}
        />
      )}

      <SessionImportInline onLoad={state.loadSnapshot} />
    </aside>
  );
}

/** "Import a session snapshot" affordance. Hidden file input + a
 *  small mono link; clicking the link opens the file picker.
 *  Validation goes through `parseSessionSnapshot` — fatal errors
 *  surface as a toast under the link; warnings (forward-compat
 *  field drops) surface too but don\'t block the load. */
function SessionImportInline({
  onLoad,
}: {
  onLoad: (snapshot: import('@/lib/playbook/session').SessionSnapshot) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<
    | { kind: 'error'; message: string }
    | { kind: 'success'; message: string }
    | null
  >(null);

  React.useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    /* Reset the input so the same file can be re-selected after a
       failed parse without the change-event being suppressed. */
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseSessionSnapshot(text);
      if (!result.ok) {
        setFeedback({ kind: 'error', message: result.reason });
        return;
      }
      onLoad(result.snapshot);
      const warnSuffix =
        result.warnings.length > 0
          ? ` (${result.warnings.length} field${result.warnings.length === 1 ? '' : 's'} skipped)`
          : '';
      setFeedback({
        kind: 'success',
        message: `Loaded snapshot from ${file.name}${warnSuffix}`,
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: `Failed to read file: ${(err as Error).message}`,
      });
    }
  };

  return (
    <section className="mt-6 border-t border-ink-5/60 pt-4">
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        onChange={onPick}
        className="sr-only"
        aria-label="Import session snapshot JSON file"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="font-mono text-[10px] uppercase tracking-wider text-bone-4 transition-colors hover:text-bone-1"
        title="Replace your current session with one from a previously-exported JSON snapshot"
      >
        ↑ import session snapshot
      </button>
      {feedback && (
        <p
          className={cn(
            'mt-2 max-w-xs font-mono text-[10.5px] leading-relaxed',
            feedback.kind === 'error' ? 'text-bone-1' : 'text-bone-3',
          )}
        >
          {feedback.kind === 'error' ? '✗ ' : '✓ '}
          {feedback.message}
        </p>
      )}
    </section>
  );
}

function TagGroup({
  group,
  selected,
  onToggle,
}: {
  group: { label: string; tags: { id: TechTag; label: string }[] };
  selected: TechTag[];
  onToggle: (tag: TechTag) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-bone-4">
        {group.label}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {group.tags.map((tag) => {
          const on = selected.includes(tag.id);
          return (
            <li key={tag.id}>
              <button
                type="button"
                onClick={() => onToggle(tag.id)}
                aria-pressed={on}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] transition-colors',
                  on
                    ? 'border-bone-1 bg-bone-1/10 text-bone-0'
                    : 'border-ink-5 bg-ink-2/40 text-bone-3 hover:border-bone-4 hover:text-bone-1',
                )}
              >
                <CheckGlyph on={on} />
                {tag.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CheckGlyph({ on }: { on: boolean }) {
  return (
    <span
      role="presentation"
      aria-hidden
      style={{
        borderColor: on ? 'var(--color-bone-0)' : 'var(--color-bone-3)',
        background: on ? 'var(--color-bone-0)' : 'transparent',
      }}
      className="inline-flex h-2.5 w-2.5 items-center justify-center rounded-sm border"
    >
      {on && (
        <svg
          width="7"
          height="7"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--color-ink-0)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2 5.5L4 7.5L8 3" />
        </svg>
      )}
    </span>
  );
}

function VersionsBlock({
  selected,
  versions,
  onSet,
  onClearAll,
}: {
  selected: TechTag[];
  versions: Record<string, string>;
  onSet: (tag: string, value: string) => void;
  onClearAll: () => void;
}) {
  const filledCount = selected.filter(
    (t) => (versions[t] ?? '').length > 0,
  ).length;
  if (selected.length === 0) {
    return (
      <section className="mt-6 border-t border-ink-5/60 pt-5">
        <header className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Versions
        </header>
        <p className="max-w-xs font-mono text-[11px] leading-relaxed text-bone-3">
          Pick a tech tag above to add a version. Vuln-phase commands
          like searchsploit + cvemap thread per-tag versions into{' '}
          <code className="text-bone-1">{'{version}'}</code>.
        </p>
      </section>
    );
  }
  return (
    <section className="mt-6 border-t border-ink-5/60 pt-5">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Versions ::{' '}
          <span className="text-bone-4">
            {filledCount}/{selected.length} filled
          </span>
        </span>
        {filledCount > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="font-mono text-[10px] uppercase tracking-wider text-bone-4 transition-colors hover:text-bone-0"
            title="Clear every version (across all tags)"
          >
            clear
          </button>
        )}
      </header>
      <p className="mb-3 max-w-xs font-mono text-[11px] leading-relaxed text-bone-3">
        One per stack you&rsquo;ve picked. Each command resolves{' '}
        <code className="text-bone-1">{'{version}'}</code> against its
        own tag.
      </p>
      <ul className="space-y-1.5">
        {selected.map((tag) => (
          <li key={tag}>
            <label className="flex items-center gap-2">
              <span
                className="w-20 shrink-0 truncate font-mono text-[11px] text-bone-3"
                title={`Replaces \\{version\\} in commands tagged "${tag}"`}
              >
                {techTagLabel(tag)}
              </span>
              <input
                type="text"
                value={versions[tag] ?? ''}
                onChange={(e) => onSet(tag, e.target.value)}
                placeholder="e.g. 2.4.49"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                className="min-w-0 flex-1 rounded border border-ink-5 bg-ink-0 inset-input px-1.5 py-0.5 font-mono text-[11px] text-bone-1 placeholder:text-bone-4 focus:border-bone-4 focus:outline-none"
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScratchEditor({
  tokens,
  values,
  onSet,
  onClearAll,
}: {
  tokens: string[];
  values: Record<string, string>;
  onSet: (key: string, value: string) => void;
  onClearAll: () => void;
}) {
  const filledCount = tokens.filter((t) => (values[t] ?? '').length > 0)
    .length;
  return (
    <section className="mt-6 border-t border-ink-5/60 pt-5">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Scratch ::{' '}
          <span className="text-bone-4">
            {filledCount}/{tokens.length} filled
          </span>
        </span>
        {filledCount > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="font-mono text-[10px] uppercase tracking-wider text-bone-4 transition-colors hover:text-bone-0"
            title="Clear every scratch value (across all steps)"
          >
            clear
          </button>
        )}
      </header>
      <p className="mb-3 max-w-xs font-mono text-[11px] leading-relaxed text-bone-3">
        Tokens this step&rsquo;s commands use. Fill them once and they
        thread through every command + every later step.
      </p>
      <ul className="space-y-1.5">
        {tokens.map((token) => (
          <li key={token}>
            <label className="flex items-center gap-2">
              <span
                className="shrink-0 font-mono text-[11px] text-bone-3"
                title={`Replaces \\{${token}\\} in commands`}
              >
                {token}
              </span>
              <input
                type="text"
                value={values[token] ?? ''}
                onChange={(e) => onSet(token, e.target.value)}
                placeholder={`<${token}>`}
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                className="min-w-0 flex-1 rounded border border-ink-5 bg-ink-0 inset-input px-1.5 py-0.5 font-mono text-[11px] text-bone-1 placeholder:text-bone-4 focus:border-bone-4 focus:outline-none"
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* =================================================== Diff toast */

type TagDiff = { added: number; removed: number; phaseSlug: string } | null;

function useTagDiff(state: PlaybookState, phase: Phase): TagDiff {
  const [diff, setDiff] = useState<TagDiff>(null);
  const prevTagsRef = React.useRef<TechTag[]>(state.selectedTechTags);
  const prevCountRef = React.useRef<number>(
    countVisibleCommands(phase, state, state.selectedTechTags),
  );
  React.useEffect(() => {
    const prevTags = prevTagsRef.current;
    const nextTags = state.selectedTechTags;
    const sameTags =
      prevTags.length === nextTags.length &&
      prevTags.every((t) => nextTags.includes(t));
    if (sameTags) {
      prevCountRef.current = countVisibleCommands(phase, state, nextTags);
      return;
    }
    const before = prevCountRef.current;
    const after = countVisibleCommands(phase, state, nextTags);
    const delta = after - before;
    setDiff({
      added: delta > 0 ? delta : 0,
      removed: delta < 0 ? -delta : 0,
      phaseSlug: phase.slug,
    });
    prevTagsRef.current = nextTags;
    prevCountRef.current = after;
    const t = window.setTimeout(() => setDiff(null), 2400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedTechTags, phase.slug]);
  return diff;
}

function countVisibleCommands(
  phase: Phase,
  state: PlaybookState,
  tags: TechTag[],
): number {
  let n = 0;
  for (const step of phase.steps) {
    const techCheck = step.requiresTechSelection
      ? isTechVisibleStrict
      : isTechVisible;
    const stepEng =
      !step.appliesTo ||
      (state.engagement !== null && step.appliesTo.includes(state.engagement));
    if (!stepEng) continue;
    if (!isOSVisible(step.osApplies, state.targetOS)) continue;
    if (!isTechVisible(step.techApplies, tags)) continue;
    for (const c of step.commands ?? []) {
      const eng =
        !c.appliesTo ||
        (state.engagement !== null && c.appliesTo.includes(state.engagement));
      if (!eng) continue;
      if (!isOSVisible(c.osApplies, state.targetOS)) continue;
      if (!techCheck(c.techApplies, tags)) continue;
      n++;
    }
  }
  return n;
}

function DiffToast({ diff }: { diff: TagDiff }) {
  return (
    <AnimatePresence initial={false}>
      {diff && (diff.added > 0 || diff.removed > 0) && (
        <motion.p
          key={`${diff.phaseSlug}-${diff.added}-${diff.removed}`}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="mb-2 font-mono text-[11px] text-bone-3"
        >
          {diff.added > 0 && (
            <span className="text-bone-1">+{diff.added}</span>
          )}
          {diff.added > 0 && diff.removed > 0 && (
            <span aria-hidden> · </span>
          )}
          {diff.removed > 0 && (
            <span className="text-bone-3">−{diff.removed}</span>
          )}{' '}
          command{diff.added + diff.removed === 1 ? '' : 's'} in this
          phase
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/* =================================================== Helpers */

/** Compute the scratch tokens that the focused step\'s visible
 *  commands reference. Mirrors the focus view\'s filter so the
 *  builder surfaces tokens for whatever step the user is on (or
 *  would auto-spotlight to) right now. */
function focusedStepScratchTokens(state: PlaybookState): string[] {
  const phase = PHASES[state.currentPhase];
  if (!phase) return [];
  const visible = phase.steps.filter((s) => {
    const engOk =
      !s.appliesTo ||
      (state.engagement !== null && s.appliesTo.includes(state.engagement));
    return engOk && isOSVisible(s.osApplies, state.targetOS) && isTechVisible(s.techApplies, state.selectedTechTags);
  });
  if (visible.length === 0) return [];
  const autoIdx = visible.findIndex((step) => {
    const originalIndex = phase.steps.indexOf(step);
    const id = itemId(phase.slug, 'step', originalIndex);
    return !state.progress.has(id);
  });
  const activeIdx =
    state.focusedStepIdx ??
    (autoIdx === -1 ? Math.max(0, visible.length - 1) : autoIdx);
  const focused = visible[activeIdx];
  if (!focused) return [];

  const techCheck = focused.requiresTechSelection
    ? isTechVisibleStrict
    : isTechVisible;
  const visibleCommands = (focused.commands ?? []).filter((c) => {
    const eng =
      !c.appliesTo ||
      (state.engagement !== null && c.appliesTo.includes(state.engagement));
    return (
      eng &&
      isOSVisible(c.osApplies, state.targetOS) &&
      techCheck(c.techApplies, state.selectedTechTags)
    );
  });
  return extractScratchTokens(visibleCommands);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
