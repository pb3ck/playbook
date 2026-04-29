'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { interpolate } from '@/lib/playbook/template';
import { lookupTechnique } from '@/lib/mitre';
import {
  generateAssistance,
  type GeneratedAssistance,
  type GeneratedCommand,
} from '@/lib/playbook/ai-generate';
import {
  profileCategory,
  type ByokProfile,
} from '@/lib/playbook/byok';
import type { PlaybookState } from './types';

/**
 * AI Assist surface — the user-facing entry point for on-demand
 * AI generation. Renders a free-text "describe your situation"
 * prompt, fires `generateAssistance` against the user's
 * configured AI BYOK profile, and lists past generations newest
 * first. Each generation is rendered with three layers of
 * disclosure so it never gets confused with curated catalog
 * material:
 *
 *   1. Section heading: "AI-GENERATED · NOT VALIDATED"
 *   2. Per-command badge: "(generated)" pill on every command
 *   3. Surface treatment: dashed warning-amber border + tinted
 *      background so the section reads as a meta-region, not
 *      part of the catalog
 *
 * If the user has no enabled AI profile, this surface tells them
 * explicitly + nudges to the BYOK settings drawer (Ollama as the
 * recommended local default).
 *
 * Generated content is per-session — it sticks across reload via
 * localStorage but is never auto-merged into lib/methodology.ts.
 * The "promote to catalog" path stays manual via the AI authoring
 * CLI (scripts/ai-draft.ts) + lab validation. This UI is for the
 * user *consuming* generation in their own engagement; the
 * authoring CLI is for the maintainer growing the curated baseline.
 */
export function AiAssist({ state }: { state: PlaybookState }) {
  /* Pull just the AI-category profiles, enabled ones first. The
     orchestrator dispatches by kind; the UI just needs to know
     "is there a usable AI profile." */
  const aiProfiles = useMemo(
    () =>
      state.byokProfiles
        .filter((p) => profileCategory(p) === 'ai')
        .sort((a, b) => Number(b.enabled) - Number(a.enabled)),
    [state.byokProfiles],
  );
  const enabledProfile = aiProfiles.find((p) => p.enabled);

  return (
    <section
      aria-labelledby="ai-assist-heading"
      className="mt-8 rounded-xl border border-dashed border-warn/40 bg-warn/[0.04] p-4"
    >
      {/* Disclosure layer 1: section heading marks the whole
          region as AI-generated, distinct from the curated focus
          view above. */}
      <header className="mb-3 flex items-baseline justify-between gap-3 border-b border-warn/30 pb-2">
        <div>
          <h2
            id="ai-assist-heading"
            className="font-mono text-[10px] uppercase tracking-[0.22em] text-warn"
          >
            AI-generated &middot; not validated
          </h2>
          <p className="mt-0.5 text-[12px] text-bone-3">
            Fill gaps when the curated catalog doesn&rsquo;t cover
            your situation. Output is generated per-session, never
            merged into the catalog, and never lab-validated until a
            maintainer runs it.
          </p>
        </div>
        {state.aiGenerations.length > 0 && (
          <button
            type="button"
            onClick={state.clearAiGenerations}
            className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-bone-4 hover:text-bone-2"
            title="Clear all AI generations from this session"
          >
            clear all
          </button>
        )}
      </header>

      {!enabledProfile ? (
        <NoProviderHint
          hasProfiles={aiProfiles.length > 0}
          onOpenSettings={state.replayWelcome /* placeholder; see wiring */}
        />
      ) : (
        <PromptForm
          profile={enabledProfile}
          state={state}
        />
      )}

      {state.aiGenerations.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {state.aiGenerations.map((g) => (
            <GenerationCard
              key={g.id}
              generation={g}
              onRemove={() => state.removeAiGeneration(g.id)}
              scratchValues={state.scratchValues}
              target={state.target}
              versions={state.versions}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* =================================================== empty-state */

function NoProviderHint({
  hasProfiles,
  onOpenSettings: _onOpenSettings,
}: {
  hasProfiles: boolean;
  onOpenSettings: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-ink-5 bg-ink-1/40 p-3 text-[12.5px] leading-relaxed text-bone-2">
      {hasProfiles ? (
        <>
          You have an AI profile configured but it&rsquo;s disabled.
          Open the BYOK settings drawer (gear chip in the shell, top
          right) and toggle it on.
        </>
      ) : (
        <>
          No AI provider configured. Open the BYOK settings drawer
          (gear chip in the shell, top right) and add one. The
          recommended starter is{' '}
          <span className="font-mono text-bone-1">Ollama (local)</span>{' '}
          &mdash; install Ollama, run{' '}
          <code className="font-mono text-bone-1">ollama pull whiterabbitneo</code>{' '}
          (or any model you prefer), and add a profile pointing at{' '}
          <span className="font-mono text-bone-1">http://localhost:11434</span>.
          No data leaves your device.
        </>
      )}
    </div>
  );
}

/* =================================================== prompt form */

function PromptForm({
  profile,
  state,
}: {
  profile: ByokProfile;
  state: PlaybookState;
}) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const text = prompt.trim();
    if (text.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await generateAssistance(profile, {
        engagement: state.engagement,
        targetOS: state.targetOS,
        techTags: state.selectedTechTags,
        target: state.target,
        prompt: text,
      });
      state.addAiGeneration(result);
      if (!result.ok && result.rawError) {
        setError(result.rawError);
      } else {
        /* Clear the input on success so the user can ask follow-ups
           without manually wiping. */
        setPrompt('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="block font-mono text-[10px] uppercase tracking-wider text-bone-3">
        describe a situation &mdash; provider:{' '}
        <span className="text-bone-1">{profile.name}</span>
        {profile.model && (
          <span className="text-bone-3"> &middot; {profile.model}</span>
        )}
      </label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          /* Cmd/Ctrl+Enter submits — common pattern for prompt
             inputs. Plain Enter inserts a newline. */
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder="e.g. The target runs Tomcat 9.0.50 on port 8080. What recon and exploit paths apply?"
        disabled={busy}
        className="w-full resize-y rounded-md border border-ink-5 bg-ink-0 inset-input p-2 font-mono text-[12.5px] text-bone-0 placeholder:text-bone-4 focus:border-bone-4 focus:outline-none disabled:opacity-60"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || prompt.trim().length === 0}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border border-warn/60 px-3 font-mono text-[10px] uppercase tracking-wider transition-colors',
            'bg-warn/10 text-warn hover:bg-warn/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {busy ? 'generating…' : '✦ generate'}
        </button>
        <span className="font-mono text-[10px] text-bone-4">
          ⌘/ctrl + enter
        </span>
        {error && (
          <span
            className="ml-auto truncate font-mono text-[10.5px] text-accent"
            title={error}
          >
            ✗ {error.length > 80 ? error.slice(0, 77) + '…' : error}
          </span>
        )}
      </div>
    </div>
  );
}

/* =================================================== generation card */

function GenerationCard({
  generation,
  onRemove,
  scratchValues,
  target,
  versions,
}: {
  generation: GeneratedAssistance;
  onRemove: () => void;
  scratchValues: Record<string, string>;
  target: string;
  versions: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const date = generation.generatedAt.slice(0, 10);
  const time = generation.generatedAt.slice(11, 16);
  return (
    <article className="rounded-lg border border-warn/30 bg-ink-1/40 p-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span aria-hidden className="text-bone-4">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="truncate font-mono text-[12px] text-bone-0">
            {generation.result.title || '(untitled)'}
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-warn">
            generated
          </span>
        </button>
        <span
          className="shrink-0 font-mono text-[9.5px] text-bone-4"
          title={`${generation.provider.kind}${generation.provider.model ? ` · ${generation.provider.model}` : ''}${
            generation.elapsedMs ? ` · ${(generation.elapsedMs / 1000).toFixed(1)}s` : ''
          }${
            generation.outputTokens
              ? ` · ${generation.outputTokens} out tokens`
              : ''
          }`}
        >
          {date} {time} &middot; {generation.provider.name}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this generation"
          title="Remove"
          className="shrink-0 font-mono text-[12px] text-bone-4 hover:text-bone-2"
        >
          ×
        </button>
      </header>

      {expanded && (
        <div className="mt-2">
          {generation.context.prompt && (
            <p className="mb-2 rounded border border-ink-5 bg-ink-0/60 px-2 py-1 font-mono text-[11px] italic text-bone-3">
              &ldquo;{generation.context.prompt}&rdquo;
            </p>
          )}
          {generation.result.summary && (
            <p className="mb-2 text-[12.5px] leading-relaxed text-bone-1">
              {generation.result.summary}
            </p>
          )}

          {!generation.ok && generation.rawError && (
            <div className="mt-2 rounded border border-accent/40 bg-accent/[0.06] p-2 font-mono text-[11px] text-accent">
              {generation.rawError}
            </div>
          )}

          {generation.result.commands.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {generation.result.commands.map((cmd, i) => (
                <GeneratedCommandRow
                  key={i}
                  command={cmd}
                  scratchValues={scratchValues}
                  target={target}
                  versions={versions}
                />
              ))}
            </ul>
          )}

          {generation.result.cautions &&
            generation.result.cautions.length > 0 && (
              <aside className="mt-3 rounded border border-warn/30 bg-warn/[0.04] p-2">
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-warn">
                  cautions
                </div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-bone-2 marker:text-warn">
                  {generation.result.cautions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </aside>
            )}
        </div>
      )}
    </article>
  );
}

function GeneratedCommandRow({
  command,
  scratchValues,
  target,
  versions,
}: {
  command: GeneratedCommand;
  scratchValues: Record<string, string>;
  target: string;
  versions: Record<string, string>;
}) {
  const [copied, setCopied] = useState(false);
  /* Interpolate the same way the catalog command-snippets do, so
     the generated command picks up the user\'s target / scratch
     values automatically. {version} resolves against the FIRST
     techApplies tag if present (cheap heuristic; the catalog's
     resolveVersion does the same). */
  const versionForTag =
    command.techApplies && command.techApplies.length > 0
      ? versions[command.techApplies[0]] ?? ''
      : '';
  const rendered = interpolate(
    command.command,
    { target, version: versionForTag },
    scratchValues,
  );

  const copy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(rendered).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <li className="rounded-md border border-ink-5 surface-gradient elev-1">
      {/* Disclosure layer 2: every command gets a (generated) badge
          inline with its label. The badge is mandatory — never
          omitted even when the command looks indistinguishable from
          curated content. */}
      <div className="flex items-center justify-between gap-2 border-b border-ink-5 bg-ink-2/40 px-3 py-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded border border-warn/40 bg-warn/[0.08] px-1 font-mono text-[9px] uppercase tracking-wider text-warn">
            generated
          </span>
          {command.label && (
            <span className="truncate font-mono text-[10.5px] text-bone-2">
              {command.label}
            </span>
          )}
        </div>
        {command.mitreTechniques && command.mitreTechniques.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1">
            {command.mitreTechniques.slice(0, 3).map((t) => {
              const meta = lookupTechnique(t);
              return (
                <a
                  key={t}
                  href={
                    meta?.url ??
                    `https://attack.mitre.org/techniques/${t.replace('.', '/')}/`
                  }
                  target="_blank"
                  rel="noreferrer noopener"
                  title={meta ? `${t} — ${meta.name}` : t}
                  className="rounded border border-ink-5 bg-ink-0/60 px-1 font-mono text-[9px] text-bone-3 hover:text-bone-1"
                >
                  {t}
                </a>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-start gap-2 px-3 py-2">
        <span aria-hidden className="select-none font-mono text-xs text-bone-4">
          $
        </span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[12.5px] leading-relaxed text-bone-1">
          {rendered}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy'}
          title={copied ? 'copied' : 'copy'}
          className={cn(
            'shrink-0 rounded border border-ink-5 bg-ink-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
            copied
              ? 'border-bone-1 text-bone-0'
              : 'text-bone-3 hover:border-bone-4 hover:text-bone-0',
          )}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      {(command.source || command.caveats) && (
        <div className="border-t border-ink-5/60 px-3 py-1 font-mono text-[10.5px] text-bone-3">
          {command.source && (
            <div className="truncate" title={command.source}>
              <span className="text-bone-4">source: </span>
              {command.source.startsWith('http') ? (
                <a
                  href={command.source}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-bone-2 underline-offset-2 hover:text-bone-0 hover:underline"
                >
                  {command.source}
                </a>
              ) : (
                <span>{command.source}</span>
              )}
            </div>
          )}
          {command.caveats && (
            <div className="mt-0.5">
              <span className="text-bone-4">note: </span>
              {command.caveats}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
