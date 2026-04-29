'use client';

import { useMemo } from 'react';
import { PHASES, commandItemId, type CommandSnippet } from '@/lib/methodology';
import { lookupTechnique } from '@/lib/mitre';
import { isOSVisible } from '@/lib/target-os';
import { isTechVisible, isTechVisibleStrict } from '@/lib/tech-tags';
import type { PlaybookState } from './types';

/**
 * Defense thread-back view — only renders inside the Defense phase
 * (slug: `defense`). Reads `state.progress`, walks every completed
 * step in earlier phases, and surfaces the union of MITRE ATT&CK
 * technique IDs that the user actually demonstrated. The result is
 * an at-a-glance "what should have been detected if blue were
 * watching" panel, with technique IDs linked to MITRE for the full
 * write-up + detection guidance.
 *
 * This is the qualitative move from red-team checklist → purple-
 * team tool, made possible by the `mitreTechniques` field on
 * commands. Coverage is partial today (high-value AD post-ex
 * commands tagged first); as more commands gain technique IDs
 * the panel grows automatically.
 *
 * Visual: same dashed-border / quiet-mono treatment as the rest of
 * the panel system (scope banner, scratch editor, versions block) —
 * reads as metadata, not as a load-bearing feature.
 */
export function DefenseThreadback({ state }: { state: PlaybookState }) {
  const techniqueRows = useMemo(
    () => collectCompletedTechniques(state),
    /* Deps narrowed to the four state slices that actually affect
       the result. `state` itself changes on every render, so passing
       it would defeat the memo. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.progress,
      state.engagement,
      state.targetOS,
      state.selectedTechTags,
    ],
  );

  if (techniqueRows.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-ink-5 surface-gradient elev-1 px-4 py-4">
        <header className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Detection coverage
        </header>
        <p className="font-mono text-[11.5px] leading-relaxed text-bone-2">
          Tick the commands you actually run in earlier phases — only
          ticked commands count toward the technique mapping. Each
          MITRE link below opens the official write-up + detection
          guidance.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-dashed border-ink-5 bg-ink-2/40 px-4 py-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-bone-3">
          Detection coverage ::{' '}
          <span className="text-bone-4">
            {techniqueRows.length} technique
            {techniqueRows.length === 1 ? '' : 's'} demonstrated
          </span>
        </span>
      </header>

      <p className="mb-3 max-w-3xl font-mono text-[11px] leading-relaxed text-bone-3">
        Each technique below was triggered by a command you marked
        complete. Open the MITRE link for the full detection guidance
        — log sources, sigma rules, common controls.
      </p>

      <ul className="space-y-1.5">
        {techniqueRows.map((row) => {
          /* Pull name + tactic from the locally-bundled MITRE data
             (data/mitre-techniques.json, synced from the canonical
             STIX repo). When the id isn\'t in the bundle — sync
             hasn\'t been re-run since the catalog added it, or it\'s
             a typo — we fall back to rendering the bare id. */
          const meta = lookupTechnique(row.id);
          return (
            <li
              key={row.id}
              className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3"
            >
              <a
                href={
                  meta?.url ??
                  `https://attack.mitre.org/techniques/${row.id.replace('.', '/')}/`
                }
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 font-mono text-[12px] text-bone-1 underline-offset-2 hover:text-bone-0 hover:underline"
                title={
                  meta
                    ? `${meta.shortDescription || meta.name} — open MITRE write-up`
                    : 'Open MITRE ATT&CK write-up'
                }
              >
                {row.id}
                {meta && (
                  <span className="text-bone-3"> — {meta.name}</span>
                )}
              </a>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-bone-3">
                {meta && meta.tactics.length > 0 && (
                  <span className="mr-2 rounded border border-ink-5 bg-ink-0/60 px-1 text-[9.5px] uppercase tracking-wider text-bone-3">
                    {meta.tactics[0]}
                  </span>
                )}
                {row.commands
                  .slice(0, 3)
                  .map((c) => c.label ?? '(unlabeled)')
                  .join(' · ')}
                {row.commands.length > 3 ? ` (+${row.commands.length - 3} more)` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* =================================================== internals */

type TechniqueRow = {
  id: string;
  commands: CommandSnippet[];
};

/** Walk every phase, find COMMANDS the user has individually
 *  ticked as "ran," and collect (technique → commands) entries.
 *  Step-level completion is intentionally NOT used — that's a
 *  workflow signal ("I'm done with this section"), not an
 *  attribution claim. Only commands the user explicitly ticked
 *  count toward the demonstrated-techniques view, otherwise
 *  marking a step done would over-claim every command in it.
 *
 *  Tag/OS/engagement filters still apply on top so a command that
 *  was ran-then-filtered-out doesn't pretend to be active. */
function collectCompletedTechniques(state: PlaybookState): TechniqueRow[] {
  const byTechnique = new Map<string, CommandSnippet[]>();
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!cmd.mitreTechniques || cmd.mitreTechniques.length === 0) continue;
        if (!state.progress.has(commandItemId(phase.slug, i, cIdx))) continue;
        const engOk =
          !cmd.appliesTo ||
          (state.engagement !== null &&
            cmd.appliesTo.includes(state.engagement));
        if (!engOk) continue;
        if (!isOSVisible(cmd.osApplies, state.targetOS)) continue;
        if (!techCheck(cmd.techApplies, state.selectedTechTags)) continue;
        for (const t of cmd.mitreTechniques) {
          const list = byTechnique.get(t);
          if (list) list.push(cmd);
          else byTechnique.set(t, [cmd]);
        }
      }
    }
  }
  return [...byTechnique.entries()]
    .map(([id, commands]) => ({ id, commands }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
