/**
 * Tech-tag axis — third filter alongside engagement + OS.
 *
 * Lets the user narrow the playbook to the actual stack they're
 * looking at: e.g. "this target runs Apache + PHP + MySQL" hides
 * Nginx-, IIS-, .NET-, and Postgres-specific commands and tools.
 *
 * Filtering rules (mirror the OS axis):
 *   - Items with no `techApplies` are always visible.
 *   - With NO tags selected → no filter; everything visible.
 *   - With one or more selected → tagged items show only if any of
 *     their tags is in the selected set.
 *
 * The tag list is intentionally curated, not exhaustive — a starter
 * set covering the common offensive-sec engagement surfaces. Add new
 * tags as steps gain commands that benefit from per-tech variants.
 */

export type TechTag =
  // Web servers
  | 'apache'
  | 'nginx'
  | 'iis'
  // App frameworks
  | 'spring'
  | 'express'
  | 'wordpress'
  // Databases
  | 'postgres'
  | 'mysql'
  | 'mssql'
  // Languages / runtimes — anchored to real per-language tooling
  // (deserialization payloads for java/dotnet, .env / SSR probes
  // for node). Generic language tags (php / python / ruby / go)
  // were dropped after the audit; they were too vague to filter on
  // usefully and the framework + runtime tags carry the real
  // attack-surface signal anyway.
  | 'java'
  | 'dotnet'
  | 'node'
  // Identity / auth — both empty for now; populated next by the
  // AD coverage pack (enum4linux-ng, GetNPUsers, ldapsearch, DC
  // SRV discovery, certipy, Rubeus, etc.).
  | 'kerberos'
  | 'ldap'
  // Cloud / orchestration — only k8s has content today; aws/gcp/
  // azure are kept as deliberate "to populate" placeholders since
  // cloud is universal in modern engagements.
  | 'aws'
  | 'gcp'
  | 'azure'
  | 'k8s';

export type TechTagGroup = {
  /** Section heading in the context panel. */
  label: string;
  tags: { id: TechTag; label: string }[];
};

export const TECH_TAG_GROUPS: TechTagGroup[] = [
  {
    label: 'Web server',
    tags: [
      { id: 'apache', label: 'Apache' },
      { id: 'nginx', label: 'Nginx' },
      { id: 'iis', label: 'IIS' },
    ],
  },
  {
    label: 'Framework / CMS',
    tags: [
      { id: 'spring', label: 'Spring' },
      { id: 'express', label: 'Express' },
      { id: 'wordpress', label: 'WordPress' },
    ],
  },
  {
    label: 'Database',
    tags: [
      { id: 'postgres', label: 'PostgreSQL' },
      { id: 'mysql', label: 'MySQL' },
      { id: 'mssql', label: 'MSSQL' },
    ],
  },
  {
    label: 'Language / runtime',
    tags: [
      { id: 'java', label: 'Java' },
      { id: 'dotnet', label: '.NET' },
      { id: 'node', label: 'Node' },
    ],
  },
  {
    label: 'Identity / auth',
    tags: [
      { id: 'kerberos', label: 'Kerberos' },
      { id: 'ldap', label: 'LDAP' },
    ],
  },
  {
    label: 'Cloud / orchestration',
    tags: [
      { id: 'aws', label: 'AWS' },
      { id: 'gcp', label: 'GCP' },
      { id: 'azure', label: 'Azure' },
      { id: 'k8s', label: 'Kubernetes' },
    ],
  },
];

/** Flat list (id → label) for easy lookup from any tag id. */
const LABEL_BY_ID = new Map<TechTag, string>(
  TECH_TAG_GROUPS.flatMap((g) => g.tags.map((t) => [t.id, t.label])),
);

export function techTagLabel(id: TechTag): string {
  return LABEL_BY_ID.get(id) ?? id;
}

/**
 * Should an item with optional `techApplies` show given the user's
 * current tech-tag selection? Untagged items always show. With an
 * empty selection, no filter is applied (everything visible). With
 * a non-empty selection, the item must overlap with at least one
 * selected tag.
 */
export function isTechVisible(
  techApplies: TechTag[] | undefined,
  selected: TechTag[],
): boolean {
  if (!techApplies || techApplies.length === 0) return true;
  if (selected.length === 0) return true;
  return techApplies.some((t) => selected.includes(t));
}

/**
 * Strict variant: untagged items still always show, but tagged items
 * REQUIRE matching tags — empty selection means tagged items are
 * hidden. Use this for discovery-time steps where the user hasn't
 * committed to a stack yet and would otherwise drown in every
 * per-tech probe at once.
 */
export function isTechVisibleStrict(
  techApplies: TechTag[] | undefined,
  selected: TechTag[],
): boolean {
  if (!techApplies || techApplies.length === 0) return true;
  if (selected.length === 0) return false;
  return techApplies.some((t) => selected.includes(t));
}
