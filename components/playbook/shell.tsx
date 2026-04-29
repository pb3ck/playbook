'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { engagementOf } from '@/lib/engagements';
import { targetOSOf } from '@/lib/target-os';
import { techTagLabel } from '@/lib/tech-tags';
import { buildCheatsheet, defaultExportFilename } from '@/lib/playbook/export';
import {
  buildSessionSnapshot,
  defaultSessionFilename,
  encodeSnapshotForUrl,
} from '@/lib/playbook/session';
import { ByokSettings } from './byok-settings';
import type { PlaybookState } from './types';

/**
 * The app's top bar — wordmark + a context chip showing all three
 * filter axes (engagement · OS · tech tags). Clicking the chip
 * re-opens the welcome modal so engagement + OS can be changed; the
 * tech-tag count is informational, with adjustment via the right-side
 * stack panel inside the focus view.
 *
 * The chip is the canonical display of "what filters are currently
 * applied" — keeping all three axes here removes the asymmetry where
 * tech tags lived only in the side panel and could silently filter
 * the playbook without any top-level signal.
 */
export function PlaybookShell({ state }: { state: PlaybookState }) {
  const eng = engagementOf(state.engagement);
  const os = targetOSOf(state.targetOS);
  const tagCount = state.selectedTechTags.length;

  /* Build a `PRIV · WIN · 3 tags` style label from whichever pieces
     are set. If everything is missing (post-reset, just before the
     welcome covers the body), no chip renders. */
  const parts = [eng?.short, os?.short].filter(Boolean) as string[];
  if (tagCount > 0) parts.push(`${tagCount} tag${tagCount === 1 ? '' : 's'}`);
  const label = parts.join(' · ');

  /* Tooltip is exhaustive — list every selected tag (capped) so the
     user can verify their stack without expanding the side panel. */
  const tagsForTitle = state.selectedTechTags
    .slice(0, 6)
    .map((t) => techTagLabel(t))
    .join(', ');
  const tagsTitle =
    tagCount === 0
      ? null
      : `tags: ${tagsForTitle}${tagCount > 6 ? ` (+${tagCount - 6} more)` : ''}`;
  const titleParts = [
    eng && `engagement: ${eng.label.toLowerCase()}`,
    os && `target os: ${os.label.toLowerCase()}`,
    tagsTitle,
  ].filter(Boolean);
  const title = titleParts.join(' · ') + ' · click to change';

  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <h1 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em]">
        <span className="text-bone-1">playbook</span>
        {/* Alpha badge — persistent reminder that the catalog is
            uneven. Mirrors the dashed banner inside the welcome
            modal so the expectation never disappears once the
            modal is dismissed. Clicking re-opens the welcome
            (where the full disclaimer lives). */}
        <button
          type="button"
          onClick={state.replayWelcome}
          aria-label="Alpha — catalog coverage is uneven. Click to re-open the welcome with the full disclaimer."
          title="Alpha — the catalog goes deep on a focused slice (AD, common web, some cloud/CVE) and is shallow or empty elsewhere. Click for the full notice."
          className={cn(
            'ml-1 inline-flex h-[18px] items-center rounded-full border border-ink-5 chip px-1.5 text-[9px] tracking-wider text-bone-3',
            'transition-colors hover:border-bone-4 hover:text-bone-1',
          )}
        >
          alpha
        </button>
      </h1>

      <div className="flex items-center gap-2">
        <ApiLink />
        <ByokChip state={state} />
        {label && <ShareButton state={state} />}
        {label && <SessionExportButton state={state} />}
        {label && <ExportButton state={state} />}
        {label && (
          <button
            type="button"
            onClick={state.replayWelcome}
            aria-label={`Context: ${label}. Click to change engagement or target OS.`}
            title={title}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[10px] uppercase tracking-wider',
              'border border-ink-5 chip text-bone-2',
              'transition-colors hover:border-bone-4 hover:text-bone-0',
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-bone-1" aria-hidden />
            {label}
          </button>
        )}
      </div>
    </header>
  );
}

/** Encode the live session into a URL fragment (`#s=...`) and
 *  copy that URL to the clipboard. Pasting it anywhere reopens
 *  the session in a fresh browser — the bridge for collaboration
 *  + "look at this stuck point" sharing. Pure client-side: the
 *  fragment never reaches the static-export server. */
function ShareButton({ state }: { state: PlaybookState }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);

  const onClick = async () => {
    if (typeof window === 'undefined') return;
    const snapshot = buildSessionSnapshot({
      catalogVersion: null,
      engagement: state.engagement,
      targetOS: state.targetOS,
      techTags: state.selectedTechTags,
      target: state.target,
      versions: state.versions,
      scratchValues: state.scratchValues,
      progress: state.progress,
      visitedSteps: state.visitedSteps,
      infraMap: state.infraMap,
      aiGenerations: state.aiGenerations,
    });
    const encoded = encodeSnapshotForUrl(snapshot);
    /* Use a fresh URL based on the current origin + pathname so
       this works on dev, prod, and previews. */
    const base = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${base}#s=${encoded}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      /* clipboard blocked — fall back to writing to the address
         bar so the user can copy manually. */
      window.location.hash = `s=${encoded}`;
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title="Copy a shareable URL — pasting it anywhere reopens the entire session"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[10px] uppercase tracking-wider',
        'border border-ink-5 chip text-bone-3',
        'transition-colors hover:border-bone-4 hover:text-bone-0',
      )}
    >
      <span aria-hidden>↗</span>
      {copied ? 'copied' : 'share'}
    </button>
  );
}

/** Link to the JSON API docs page (`/api`). The docs are an
 *  unlinked island otherwise — a single chip in the shell makes
 *  them discoverable without intruding on flow. Visible on every
 *  tab so the link is always reachable. */
function ApiLink() {
  return (
    <a
      href="/api/"
      title="Open the JSON API docs (catalog + session schema, jq recipes)"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[10px] uppercase tracking-wider',
        'border border-ink-5 chip text-bone-3',
        'transition-colors hover:border-bone-4 hover:text-bone-0',
      )}
    >
      <span aria-hidden>{'{ }'}</span>
      api
    </a>
  );
}

/** Download a JSON snapshot of the entire session — every persisted
 *  bit of state. Distinct from the Markdown cheatsheet (which is a
 *  human-facing "what to run") — the snapshot is the machine-facing
 *  "what was configured + done" record, intended to pair with
 *  `/api/methodology.json`. Re-importable via the Map builder. */
function SessionExportButton({ state }: { state: PlaybookState }) {
  const onClick = () => {
    if (typeof window === 'undefined') return;
    /* The catalog version is whatever the live API exposes. We
       don\'t fetch it here (that would be a network round-trip on
       every export click); we record `null` and the consumer can
       diff against the API\'s `version` field themselves. */
    const snapshot = buildSessionSnapshot({
      catalogVersion: null,
      engagement: state.engagement,
      targetOS: state.targetOS,
      techTags: state.selectedTechTags,
      target: state.target,
      versions: state.versions,
      scratchValues: state.scratchValues,
      progress: state.progress,
      visitedSteps: state.visitedSteps,
      infraMap: state.infraMap,
      aiGenerations: state.aiGenerations,
    });
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultSessionFilename({
      engagement: state.engagement,
      targetOS: state.targetOS,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Download a JSON snapshot of your entire playbook session — pairs with the API for full picture"
      title="Download session snapshot (JSON) — re-importable in the Map view"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[10px] uppercase tracking-wider',
        'border border-ink-5 chip text-bone-3',
        'transition-colors hover:border-bone-4 hover:text-bone-0',
      )}
    >
      <span aria-hidden>↓</span>
      session
    </button>
  );
}

/** Download a Markdown cheat-sheet of the playbook filtered to the
 *  user\'s current axes. Lives next to the context chip in the
 *  shell — both are "what filters are active" surfaces, so the
 *  export naturally reads as "save what I\'m looking at." Quiet
 *  visual treatment to match the chip. */
function ExportButton({ state }: { state: PlaybookState }) {
  const onClick = () => {
    if (typeof window === 'undefined') return;
    const md = buildCheatsheet({
      engagement: state.engagement,
      targetOS: state.targetOS,
      techTags: state.selectedTechTags,
      target: state.target,
      versions: state.versions,
      scratchValues: state.scratchValues,
      progress: state.progress,
    });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = defaultExportFilename({
      engagement: state.engagement,
      targetOS: state.targetOS,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Download a Markdown cheat-sheet of the playbook filtered to your current context"
      title="Download Markdown cheat-sheet of your current filtered view"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[10px] uppercase tracking-wider',
        'border border-ink-5 chip text-bone-3',
        'transition-colors hover:border-bone-4 hover:text-bone-0',
      )}
    >
      <span aria-hidden>↓</span>
      export
    </button>
  );
}

/** Gear chip → opens the BYOK settings drawer. Sits next to the
 *  `api` link because both chips are about "how this app talks to
 *  the outside world." Carries a count badge when profiles are
 *  configured so users see at a glance whether enrichment is
 *  on. */
function ByokChip({ state }: { state: PlaybookState }) {
  const [open, setOpen] = useState(false);
  const enabledCount = state.byokProfiles.filter((p) => p.enabled).length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          enabledCount > 0
            ? `BYOK profiles — ${enabledCount} enabled. Click to manage.`
            : 'Configure CVE / threat-intel API profiles. Keys stay on this device.'
        }
        aria-label="Open BYOK profile settings"
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[10px] uppercase tracking-wider',
          'border border-ink-5 chip text-bone-3',
          'transition-colors hover:border-bone-4 hover:text-bone-0',
        )}
      >
        <span aria-hidden>⚙</span>
        byok
        {enabledCount > 0 && (
          <span className="rounded-full bg-bone-1 px-1 text-[8.5px] text-ink-0">
            {enabledCount}
          </span>
        )}
      </button>
      <ByokSettings
        open={open}
        onClose={() => setOpen(false)}
        profiles={state.byokProfiles}
        setProfiles={state.setByokProfiles}
      />
    </>
  );
}
