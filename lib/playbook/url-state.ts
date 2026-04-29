import { PHASES } from '@/lib/methodology';

/**
 * URL ↔ state binding for the playbook. The URL is the source of truth
 * for shareable navigation: copy a link with `?phase=exploit&q=mimikatz`
 * and the recipient lands on the exploit phase with that search.
 * localStorage is fallback for solo navigation; URL params win when
 * present.
 *
 * Writes use `history.replaceState` rather than Next's router so we
 * don't trigger re-renders or pollute the back stack on every keystroke
 * or phase step.
 */

/**
 * Parse `?q=&phase=` from the current URL into a partial state snapshot.
 * Returns null fields when the params aren't present so the caller can
 * decide whether to fall back to localStorage.
 */
export function readStateFromURL(): { query?: string; phase?: number } {
  if (typeof window === 'undefined') return {};
  const sp = new URLSearchParams(window.location.search);
  const out: { query?: string; phase?: number } = {};

  const q = sp.get('q');
  if (q) out.query = q;

  const phaseRaw = sp.get('phase');
  if (phaseRaw) {
    const idx = PHASES.findIndex((p) => p.slug === phaseRaw);
    if (idx >= 0) out.phase = idx;
  }

  return out;
}

/**
 * Serialize state to the URL via `history.replaceState`. Bypasses Next's
 * router so we don't trigger re-renders or poison the back stack.
 *
 * Phase 0 is the default — we omit `?phase=` for it to keep the entry
 * URL clean. Non-zero phases get serialized to their slug for readable
 * links.
 *
 * Skips no-op replaces — each call is a small browser-engine round-trip,
 * and the state effect that drives this fires on every keystroke.
 */
export function writeStateToURL(query: string, phaseIdx: number) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams();
  if (query) sp.set('q', query);
  if (phaseIdx > 0 && phaseIdx < PHASES.length) {
    sp.set('phase', PHASES[phaseIdx].slug);
  }
  const qs = sp.toString();
  const target = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (target !== current) {
    window.history.replaceState(null, '', target);
  }
}
