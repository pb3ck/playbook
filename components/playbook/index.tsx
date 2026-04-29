'use client';

import { useEffect } from 'react';
import { usePlaybookState } from '@/hooks/use-playbook-state';
import { decodeSnapshotFromUrl } from '@/lib/playbook/session';
import { PlaybookFocusView } from './methodology';
import { ScopeBanner } from './scope-banner';
import { PlaybookShell } from './shell';
import { PlaybookWelcome } from './welcome';

/**
 * Playbook — thin composition layer. State lives in `usePlaybookState`,
 * pure logic in `lib/playbook/*`, presentation in the components below.
 *
 *   - `PlaybookShell`     wordmark + engagement chip + export
 *   - `PlaybookFocusView` the single-step focus view (Playbook + Search
 *                          tabs); the entire app body
 *   - `PlaybookWelcome`   per-visit intro overlay
 *
 * Render strategy:
 *
 *   - Pre-mount: returns null. The body bg is already ink-0, so a blank
 *     moment is invisible.
 *
 *   - Welcome is ALWAYS rendered (post-mount). Its `open` prop drives
 *     visibility; conditionally including/excluding it caused a
 *     remount-on-dismiss bug in earlier iterations.
 *
 *   - Shell + focus view are conditional on the intro having been
 *     dismissed at least once. While the intro is up on initial load,
 *     none of those exist in the DOM, so nothing flashes through behind
 *     the welcome's backdrop. Once dismissed, they mount and stay
 *     mounted — re-opening the welcome via the engagement chip doesn't
 *     unmount the page underneath.
 */
export function Playbook() {
  const state = usePlaybookState();

  /* Auto-import a snapshot from the URL fragment if present
     (`#s=...`). Fires once on mount; clears the fragment so a
     refresh doesn\'t re-load (which would clobber any subsequent
     edits). The decoder rejects malformed payloads silently. */
  useEffect(() => {
    if (!state.mounted) return;
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (!hash.startsWith('#s=')) return;
    const encoded = hash.slice(3);
    const snapshot = decodeSnapshotFromUrl(encoded);
    if (snapshot) {
      state.loadSnapshot(snapshot);
      /* Auto-dismiss the welcome since the snapshot is the
         engagement-frame; making the user click through pickers
         after a snapshot import is friction. */
      state.dismissWelcome();
    }
    /* Strip the fragment regardless — keeps the URL clean +
       avoids re-loading on refresh. */
    history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mounted]);

  if (!state.mounted) return null;

  return (
    <>
      {state.contentMounted && (
        <>
          <PlaybookShell state={state} />
          <ScopeBanner state={state} />
          <PlaybookFocusView state={state} />
        </>
      )}
      <PlaybookWelcome state={state} />
    </>
  );
}
