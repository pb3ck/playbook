import {
  offensiveCategories,
  teamOf,
  type ExternalTool,
  type Team,
  type ToolCategory,
} from '@/content/offensive-tools';

/**
 * Pre-computed catalog metadata. Derived once from the static
 * `offensiveCategories` tree and reused everywhere a "total tools /
 * flattened-with-source" lookup is needed.
 */

/** Each tool augmented with its source category for breadcrumbs in the
 *  per-phase tool list (so the user sees "From OSINT" without the tree
 *  being visible). */
export type FlatTool = ExternalTool & {
  category: string;
  categorySlug: string;
  /** Resolved team (default 'offense'). */
  resolvedTeam: Team;
};

function flattenWithCategory(): FlatTool[] {
  const out: FlatTool[] = [];
  const walk = (cats: ToolCategory[]) => {
    for (const c of cats) {
      if (c.tools) {
        for (const t of c.tools) {
          out.push({
            ...t,
            category: c.title,
            categorySlug: c.slug,
            resolvedTeam: teamOf(t),
          });
        }
      }
      if (c.subfolders) walk(c.subfolders);
    }
  };
  walk(offensiveCategories);
  return out;
}

export const FLAT_TOOLS = flattenWithCategory();
export const TOTAL_TOOLS = FLAT_TOOLS.length;
