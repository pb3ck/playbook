import { TAG_GROUPS, type Tag } from '@/content/offensive-tools';
import { FLAT_TOOLS, type FlatTool } from './constants';
import type { Phase } from '@/lib/methodology';

/**
 * Phase-scope filter for the noscript fallback (`components/playbook/
 * static-tree.tsx`). The live JS app does its own engagement-aware
 * filtering and uses `lib/playbook/search.ts` for text search; this
 * file is now down to a single legacy function plus the tech-tag set
 * exposed for completeness.
 */

export const TECH_TAGS: Set<Tag> = new Set(TAG_GROUPS[0].tags);

/**
 * Tools belonging to a phase, by tag intersection + optional team
 * scope. A tool qualifies when:
 *   - if the phase has a team scope (and it isn't `'all'`), the tool's
 *     resolved team matches it, AND
 *   - if the phase has tag scopes, at least one of the tool's tags is
 *     in the phase's tag list.
 *
 * Phases with no tags match every tool (subject to team scope).
 */
export function toolsForPhase(phase: Phase): FlatTool[] {
  return FLAT_TOOLS.filter((t) => {
    if (phase.team && phase.team !== 'all' && t.resolvedTeam !== phase.team) {
      return false;
    }
    if (phase.tags.length === 0) return true;
    const tags = t.tags ?? [];
    return phase.tags.some((p) => tags.includes(p));
  });
}
