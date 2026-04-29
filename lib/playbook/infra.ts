/**
 * Infrastructure attack-graph — fully derived from the rest of the
 * session state. The user does not add / edit / delete nodes
 * manually; the catalog of commands the user has ticked, the tags
 * picked, the versions and scratch values set, all collapse into a
 * deterministic graph that updates as those inputs change.
 *
 * The only thing that persists is `positions` — overrides for
 * where each node sits on the canvas. The user can drag to
 * rearrange, and those drag positions ride alongside the rest of
 * the session in localStorage / the snapshot. Anything not in the
 * positions map falls back to a layout-computed default.
 *
 * Why this shape:
 *   - The graph is a *view* of the session, not an independent
 *     document. Auto-derive means the user can\'t leave the graph
 *     stale while their session moves on.
 *   - Stable ids (`host`, `svc:apache`, `find:cmd:recon:cmd:6:21`)
 *     mean drag positions survive across derivations as long as
 *     the source still produces the same node.
 */

import {
  PHASES,
  commandItemId,
  type CommandSnippet,
  type ToolRef,
} from '@/lib/methodology';
import { isOSVisible } from '@/lib/target-os';
import {
  isTechVisible,
  isTechVisibleStrict,
  techTagLabel,
  type TechTag,
} from '@/lib/tech-tags';
import type {
  GeneratedAssistance,
  GeneratedCommand,
} from './ai-generate';

/** Discriminated union over node types.
 *
 *   host        — the asset under test (one per target).
 *   service     — a tech tag the user picked, with its discovered
 *                 version. Sits next to the host.
 *   finding     — a CVE-named ticked command surfaced as its own
 *                 node, attached to the service it relates to.
 *   credential  — a scratch value whose key smells credential-y
 *                 (password, hash, ticket, etc.).
 *   tool        — a tool referenced by any ticked command. Shows
 *                 "what you used" without the user having to look
 *                 back through the catalog.
 *   context     — non-credential scratch values + the engagement
 *                 frame (engagement type, OS, prechecks acked).
 *                 Brings the session\'s mental frame onto the
 *                 canvas instead of leaving it implicit. */
export type InfraNodeKind =
  | 'host'
  | 'service'
  | 'finding'
  | 'credential'
  | 'tool'
  | 'context';

export type InfraNode = {
  /** Stable id derived from the source data — same source always
   *  produces the same id, so position overrides survive
   *  re-derivation. */
  id: string;
  kind: InfraNodeKind;
  /** Human label rendered prominently. */
  label: string;
  /** Optional secondary line — e.g. OS for a host, version for a
   *  service, CVE id for a finding. */
  meta?: string;
  /** Parent node id. null = root (always the host). */
  parentId: string | null;
  /** Layout coordinates — either the persisted user-drag override
   *  or the layout-computed default if the user hasn\'t dragged
   *  this node yet. Position overrides are stored separately in
   *  `InfraMap.positions` and merged here at derivation time. */
  x: number;
  y: number;
  /** ATT&CK technique IDs derived from the commands that produced
   *  this node — host gets the union of all demonstrated, service
   *  gets the subset whose commands carry that service\'s tag,
   *  finding inherits from its originating command. */
  techniques: string[];
  /** Optional phase slug the node was discovered in. Used by
   *  findings to render a phase chip ("recon", "vuln", "post-ex"
   *  etc.) so the user can trace each finding back to where they
   *  surfaced it. Tools also carry this — the phase where they
   *  were first used by a ticked command. */
  phase?: string;
  /** Optional URL — tool nodes carry this so the canvas can
   *  open the tool\'s docs/repo when clicked. */
  url?: string;
  /** True when this node was derived from an AI-generated
   *  command (one the user marked "ran" on the AI Assist
   *  surface) rather than a catalog-curated command. The map
   *  applies amber-tinted treatment to generated nodes + edges
   *  so the user sees provenance at a glance. */
  generated?: boolean;
};

/** Persisted shape — only position overrides. The node list itself
 *  is recomputed on every render from session state. */
export type InfraMap = {
  positions: Record<string, { x: number; y: number }>;
};

export const EMPTY_INFRA_MAP: InfraMap = { positions: {} };

/** Validate a parsed map, salvaging the positions field if present.
 *  Tolerates the old `{ nodes, edges }` shape from earlier builds:
 *  scrapes positions out of any `nodes` array so users with stored
 *  layouts keep them, and silently drops everything else. */
export function normalizeInfraMap(raw: unknown): InfraMap {
  if (!raw || typeof raw !== 'object') return EMPTY_INFRA_MAP;
  const obj = raw as Record<string, unknown>;
  const positions: Record<string, { x: number; y: number }> = {};

  if (obj.positions && typeof obj.positions === 'object' && !Array.isArray(obj.positions)) {
    for (const [k, v] of Object.entries(obj.positions as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const p = v as Record<string, unknown>;
      if (typeof p.x !== 'number' || typeof p.y !== 'number') continue;
      positions[k] = { x: p.x, y: p.y };
    }
  }

  /* Old-shape salvage: if a snapshot from the manual-editing era
     still has a `nodes` array, lift its positions into the new
     positions map keyed by id. The actual node identity won\'t
     match (old ids were UUIDs; new ids are derived) so the
     overrides will be ignored — but we attempt it for free. */
  if (Array.isArray(obj.nodes)) {
    for (const n of obj.nodes) {
      if (!n || typeof n !== 'object') continue;
      const node = n as Record<string, unknown>;
      if (typeof node.id !== 'string') continue;
      if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
      if (!(node.id in positions)) {
        positions[node.id] = { x: node.x, y: node.y };
      }
    }
  }

  return { positions };
}

/* =================================================== Derivation */

/** Inputs the derive function pulls from session state — everything
 *  it needs in one shape so call sites can pass a plain object
 *  rather than threading the whole PlaybookState. */
export type DeriveInput = {
  engagement: string | null;
  targetOS: string | null;
  techTags: TechTag[];
  target: string;
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  /** Set of completed item ids (steps + commands + prechecks).
   *  Per-command attribution drives technique pinning + finding
   *  derivation; step-level completion isn\'t consulted (it\'s a
   *  workflow signal, not an attribution claim). */
  progress: Set<string>;
  /** Optional — on-demand AI generations from the user\'s
   *  session. Only commands the user marked "ran" (ranIndices)
   *  flow into the derived graph; generated-derived nodes get
   *  the `generated: true` flag for amber-tinted rendering. */
  aiGenerations?: GeneratedAssistance[];
};

/* Layout constants — column x-positions + per-row vertical
   spacing. Pulled out so the layout is one easy-to-read map of
   "where each kind goes" rather than scattered magic numbers.

   Approximate node footprint is 200×60 (the rendered border-box
   measures ~160 wide + 20 padding either side; ~40 tall + meta +
   technique row when present). All gaps below leave breathing
   room around that footprint, so adjacent nodes never touch. */

/* Columns flow left-to-right as the *narrative* of an engagement:
   the host gets recon\'d (recon tool), services are surfaced
   (service), per-service vuln tooling probes them (finding tool),
   and the resulting CVEs / weaknesses (finding) hang off that
   tool. A tool that discovered a service plays the recon role and
   sits in COL_RECON_TOOL between host and service; a tool that
   only surfaced findings plays the finding role and sits in
   COL_FIND_TOOL between service and finding. Same tool can play
   both — service-discovery wins, so the tool sits left and the
   findings line back to it through the service. */
const COL_LEFT = -260; // context + scratch + creds (left of host)
const COL_HOST = 80; // host
const COL_RECON_TOOL = 360; // tools that discovered a service
const COL_SERVICE = 660; // services
const COL_FIND_TOOL = 960; // tools that surfaced findings (without discovering the service)
const COL_FINDING = 1260; // findings (right of finding tools)

const ROW_GAP = 95; // vertical gap between non-band siblings (left-cluster + standalone tools)
const FINDING_ROW = 95; // findings stack inside a service band — needs room for technique chips
const TOOL_ROW = 80; // tools stack inside a service band
const BAND_PAD = 60; // padding between adjacent service bands

/** Pure: derive the infrastructure node tree from session inputs.
 *  Always emits the same nodes for the same inputs (modulo
 *  position overrides, which are layered in by `applyPositions`).
 *
 *  Layout reads left-to-right as the engagement narrative:
 *
 *    [host] ── [recon tool] ── [service] ── [finding tool] ── [finding]
 *
 *  A tool that discovered a service is the recon tool for that
 *  service\'s band — it sits left of the service and the service
 *  edge connects back to it. A tool that only surfaced findings
 *  (didn\'t discover its host service) sits between service and
 *  finding. The same tool playing both roles takes the recon
 *  position; its findings still attribute to it through the
 *  service edge.
 *
 *  Bands are still per-service so that growing one band\'s
 *  finding tree never collides with another\'s. yCursor advances
 *  by the per-band height (max of all column heights inside the
 *  band) + BAND_PAD before the next band starts.
 */
export function deriveNodes(input: DeriveInput): InfraNode[] {
  const out: InfraNode[] = [];

  /* Root: host node. Always emitted, even if the target is
     unset, so the canvas is never empty when the user lands on
     the Map tab. */
  const targetLabel = input.target.length > 0 ? input.target : '<no target>';
  const hostMeta = [input.targetOS, input.engagement]
    .filter(Boolean)
    .join(' · ');
  const allTechniques = collectAllDemonstrated(input);
  out.push({
    id: 'host',
    kind: 'host',
    label: targetLabel,
    meta: hostMeta || undefined,
    parentId: null,
    x: COL_HOST,
    y: 80,
    techniques: allTechniques,
  });

  /* Per-tag discoverer: the first ticked command for this tag
     whose text invokes a step tool. That tool is what "found"
     this service, so the service node parents to it (and the
     tool itself parents to the host — promoted out of its
     normal service-attached position to break the would-be
     cycle). Build the discovererSet first so collectTools can
     re-parent recon tools to host. */
  const tagDiscoverer = new Map<TechTag, string | null>();
  for (const tag of input.techTags) {
    tagDiscoverer.set(tag, discovererForTag(input, tag));
  }
  const reconToolIds = new Set<string>();
  for (const v of tagDiscoverer.values()) {
    if (v) reconToolIds.add(v);
  }

  /* Pre-compute groupings so each band knows its own contents.
     Tools are split: recon tools (discoverer of any service) get
     parentId=host; the rest keep their service-by-tag attachment.
     Findings parent to the tool that surfaced them when the
     command names a step tool, else fall back to service / host. */
  const rawCatalogTools = collectTools(input, reconToolIds);
  const rawCatalogFindings = collectFindings(input);

  /* Generated additions — only ticked-ran AI commands flow through.
     Tools/findings that already exist via the catalog walk are
     skipped so we don\'t produce duplicate ids. Generated nodes
     get the `generated: true` flag for the canvas\'s amber-tinted
     rendering. */
  const catalogToolInventory = collectAllCatalogTools();
  const catalogToolIdSet = new Set(rawCatalogTools.map((t) => t.id));
  const rawGenTools = collectToolsFromGenerations(
    input,
    catalogToolInventory,
    reconToolIds,
    catalogToolIdSet,
  );
  /* Findings need the union of catalog + generated tool IDs so a
     generated finding can hang off a generated tool. */
  const allToolIdSet = new Set([
    ...catalogToolIdSet,
    ...rawGenTools.map((t) => t.id),
  ]);
  const rawGenFindings = collectFindingsFromGenerations(
    input,
    catalogToolInventory,
    allToolIdSet,
  );

  const rawTools = [...rawCatalogTools, ...rawGenTools];
  const rawFindings = [...rawCatalogFindings, ...rawGenFindings];
  const toolsByParent = groupBy(rawTools, (t) => t.parentId);
  const findingsByParent = groupBy(rawFindings, (f) => f.parentId);
  const toolById = new Map(rawTools.map((t) => [t.id, t] as const));

  /* Group services by their discoverer so all services that
     share a recon tool sit in adjacent bands and the recon tool
     is emitted once at the top of the group. Services without a
     discoverer go in their own group keyed by null. */
  const groupOrder: (string | null)[] = [];
  const groupedTags = new Map<string | null, TechTag[]>();
  for (const tag of input.techTags) {
    const key = tagDiscoverer.get(tag) ?? null;
    if (!groupedTags.has(key)) {
      groupOrder.push(key);
      groupedTags.set(key, []);
    }
    groupedTags.get(key)!.push(tag);
  }

  let yCursor = 80;

  for (const reconId of groupOrder) {
    const tagsInGroup = groupedTags.get(reconId)!;

    /* Emit the recon tool once at the top of its group. The
       tool node sits in COL_RECON_TOOL with parentId = host. */
    if (reconId) {
      const reconTool = toolById.get(reconId);
      if (reconTool) {
        out.push({
          id: reconTool.id,
          kind: 'tool',
          label: reconTool.label,
          meta: reconTool.meta,
          parentId: 'host',
          x: COL_RECON_TOOL,
          y: yCursor,
          techniques: [],
          url: reconTool.url,
          phase: reconTool.phase,
          generated: reconTool.generated,
        });
      }
    }

    /* Each tag in the group gets a band. Bands within a group
       stack vertically; between groups we add BAND_PAD too so
       the recon tool of the next group isn\'t flush against the
       last band\'s tail. */
    for (const tag of tagsInGroup) {
      const bandTop = yCursor;
      const techsForService = collectDemonstratedForTag(input, tag);
      const ranForService = countRanForTag(input, tag);
      const versionPart = input.versions[tag] ? `v${input.versions[tag]}` : '';
      const activityPart = ranForService > 0 ? `${ranForService} ran` : '';
      const meta = [versionPart, activityPart].filter(Boolean).join(' · ');
      const serviceId = serviceIdFor(tag);
      out.push({
        id: serviceId,
        kind: 'service',
        label: techTagLabel(tag),
        meta: meta || undefined,
        parentId: reconId ?? 'host',
        x: COL_SERVICE,
        y: bandTop,
        techniques: techsForService,
      });

      /* Per-service finding-tools and their findings. Each
         tool reserves max(1, n_findings) FINDING_ROWs of
         vertical space and sits at the top of that segment;
         findings stack to the right of it. */
      const toolsHere = toolsByParent.get(serviceId) ?? [];
      let segY = bandTop;
      for (const tool of toolsHere) {
        const tFindings = findingsByParent.get(tool.id) ?? [];
        const rows = Math.max(1, tFindings.length);
        out.push({
          id: tool.id,
          kind: 'tool',
          label: tool.label,
          meta: tool.meta,
          parentId: serviceId,
          x: COL_FIND_TOOL,
          y: segY,
          techniques: [],
          url: tool.url,
          phase: tool.phase,
          generated: tool.generated,
        });
        tFindings.forEach((f, i) => {
          out.push({
            id: f.id,
            kind: 'finding',
            label: f.label,
            meta: f.meta,
            parentId: tool.id,
            x: COL_FINDING,
            y: segY + i * FINDING_ROW,
            techniques: f.techniques,
            phase: f.phase,
            generated: f.generated,
          });
        });
        segY += rows * FINDING_ROW;
      }

      /* Findings without a tool discoverer (no step tool was
         named in the command text) hang directly off the
         service in COL_FINDING below the per-tool segments. */
      const directFindings = findingsByParent.get(serviceId) ?? [];
      directFindings.forEach((f, i) => {
        out.push({
          id: f.id,
          kind: 'finding',
          label: f.label,
          meta: f.meta,
          parentId: serviceId,
          x: COL_FINDING,
          y: segY + i * FINDING_ROW,
          techniques: f.techniques,
          phase: f.phase,
          generated: f.generated,
        });
      });

      const bandHeight = Math.max(
        100,
        segY - bandTop + directFindings.length * FINDING_ROW,
      );
      yCursor = bandTop + bandHeight + BAND_PAD;
    }
  }

  /* Host-attached findings (commands without a matching tag) get
     their own band BELOW the service bands. Tool discoverer is
     respected here too: findings whose source command names a
     host-attached tool parent to that tool. */
  const hostTools = toolsByParent.get('host') ?? [];
  /* Filter out recon tools — they\'ve already been emitted
     above as parents of services in their groups. */
  const hostNonReconTools = hostTools.filter((t) => !reconToolIds.has(t.id));
  if (hostNonReconTools.length > 0) {
    let segY = yCursor;
    for (const tool of hostNonReconTools) {
      const tFindings = findingsByParent.get(tool.id) ?? [];
      const rows = Math.max(1, tFindings.length);
      out.push({
        id: tool.id,
        kind: 'tool',
        label: tool.label,
        meta: tool.meta,
        parentId: 'host',
        x: COL_FIND_TOOL,
        y: segY,
        techniques: [],
        url: tool.url,
        phase: tool.phase,
        generated: tool.generated,
      });
      tFindings.forEach((f, i) => {
        out.push({
          id: f.id,
          kind: 'finding',
          label: f.label,
          meta: f.meta,
          parentId: tool.id,
          x: COL_FINDING,
          y: segY + i * FINDING_ROW,
          techniques: f.techniques,
          phase: f.phase,
          generated: f.generated,
        });
      });
      segY += rows * FINDING_ROW;
    }
    yCursor = segY + BAND_PAD;
  }

  const hostDirectFindings = findingsByParent.get('host') ?? [];
  if (hostDirectFindings.length > 0) {
    hostDirectFindings.forEach((f, i) => {
      out.push({
        id: f.id,
        kind: 'finding',
        label: f.label,
        meta: f.meta,
        parentId: 'host',
        x: COL_FINDING,
        y: yCursor + i * FINDING_ROW,
        techniques: f.techniques,
        phase: f.phase,
        generated: f.generated,
      });
    });
    yCursor +=
      Math.max(100, hostDirectFindings.length * FINDING_ROW) + BAND_PAD;
  }

  /* Left cluster: engagement context first (if set), then
     credentials + non-credential scratch values stacked top-to-
     bottom with consistent ROW_GAP. Single yCursor so nothing
     stacks on anything else. */
  let leftY = 80;
  if (input.engagement || input.targetOS) {
    const engParts: string[] = [];
    if (input.engagement) engParts.push(input.engagement);
    if (input.targetOS) engParts.push(input.targetOS);
    out.push({
      id: 'ctx:engagement',
      kind: 'context',
      label: 'engagement',
      meta: engParts.join(' · '),
      parentId: 'host',
      x: COL_LEFT,
      y: leftY,
      techniques: [],
    });
    leftY += ROW_GAP;
  }
  for (const [k, v] of Object.entries(input.scratchValues)) {
    if (!v || v.length === 0) continue;
    const isCred = isCredentialKey(k);
    out.push({
      id: isCred ? `cred:${k}` : `ctx:scratch:${k}`,
      kind: isCred ? 'credential' : 'context',
      label: k,
      meta: v.length > 32 ? v.slice(0, 31) + '…' : v,
      parentId: 'host',
      x: COL_LEFT,
      y: leftY,
      techniques: [],
    });
    leftY += ROW_GAP;
  }

  return out;
}

/** Group an array by a key extractor — small Map-returning helper
 *  used by the layout to pre-bin findings + tools by their parent
 *  node id. */
function groupBy<T>(
  items: T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Layer position overrides onto a freshly-derived node list.
 *  Pure — returns a new array; doesn\'t mutate either input. */
export function applyPositions(
  nodes: InfraNode[],
  positions: Record<string, { x: number; y: number }>,
): InfraNode[] {
  return nodes.map((n) => {
    const p = positions[n.id];
    return p ? { ...n, x: p.x, y: p.y } : n;
  });
}

/** Walk the parent pointer transitively to collect every
 *  descendant of `nodeId`. Used by subtree drag to know which
 *  nodes to move in lockstep with the dragged one. */
export function descendantIdsOf(
  nodes: InfraNode[],
  nodeId: string,
): Set<string> {
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const n of nodes) {
      if (n.parentId === cur && !out.has(n.id)) {
        out.add(n.id);
        stack.push(n.id);
      }
    }
  }
  return out;
}

/* =================================================== Internals */

type DerivedFinding = {
  id: string;
  parentId: string;
  label: string;
  meta?: string;
  techniques: string[];
  /** Phase slug the finding was discovered in (recon / vuln /
   *  exploit / post-ex / defense). Renders as a small chip on
   *  the finding node so the user can trace it back. AI-generated
   *  findings have no phase chip — the `generated` flag carries
   *  the provenance signal instead. */
  phase: string;
  /** True for AI-generated derivations. Propagates to InfraNode. */
  generated?: boolean;
};

type DerivedTool = {
  id: string;
  parentId: string;
  label: string;
  meta?: string;
  url: string;
  phase: string;
  /** True for AI-generated derivations. Propagates to InfraNode. */
  generated?: boolean;
};

function serviceIdFor(tag: string): string {
  return `svc:${tag}`;
}

const CRED_KEY_PATTERN = /(?:password|hash|ticket|cred|key|nthash|secret|token|tgt|tgs)/i;
function isCredentialKey(key: string): boolean {
  return CRED_KEY_PATTERN.test(key);
}

const CVE_PATTERN = /CVE-\d{4}-\d{4,7}/i;

function collectFindings(input: DeriveInput): DerivedFinding[] {
  const out: DerivedFinding[] = [];
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!input.progress.has(commandItemId(phase.slug, i, cIdx))) continue;
        if (!commandPasses(cmd, input, techCheck)) continue;
        const finding = commandToFinding(cmd, input);
        if (!finding) continue;
        const id = `find:${phase.slug}:${i}:${cIdx}`;
        /* Discoverer: first step tool whose name appears in the
           command\'s text. The finding hangs off that tool so the
           map can read "Nuclei found CVE-X" rather than collapsing
           every tool + every finding into the service hub.
           Falls back to the service-by-tag, then host. */
        let parentId: string | null = null;
        for (const t of step.tools ?? []) {
          if (commandMentionsTool(cmd, t.name)) {
            parentId = `tool:${t.url}`;
            break;
          }
        }
        if (!parentId) parentId = parentForCommand(cmd, input);
        out.push({
          id,
          parentId,
          label: finding.label,
          meta: finding.meta,
          techniques: cmd.mitreTechniques ?? [],
          phase: phase.slug,
        });
      }
    }
  }
  return out;
}

/** Find the tool that "discovered" a tech-tag service: the first
 *  ticked command (in catalog walk order — recon phase wins) whose
 *  techApplies includes this tag AND whose text invokes a step
 *  tool. The returned id matches a node emitted by collectTools.
 *  Returns null if no such command exists — the service then
 *  parents to host like before. */
function discovererForTag(input: DeriveInput, tag: TechTag): string | null {
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!input.progress.has(commandItemId(phase.slug, i, cIdx))) continue;
        if (!commandPasses(cmd, input, techCheck)) continue;
        if (!(cmd.techApplies ?? []).includes(tag)) continue;
        for (const t of step.tools ?? []) {
          if (commandMentionsTool(cmd, t.name)) {
            return `tool:${t.url}`;
          }
        }
      }
    }
  }
  return null;
}

/** Walk every ticked command and collect the unique tools they
 *  actually reference. Each tool becomes one node, attached to
 *  the service-by-tag if a tag overlap exists, else to the host.
 *  Captures the phase where the user first ticked a command that
 *  used the tool — useful for rendering the phase chip.
 *
 *  Attribution is per-command, NOT per-step. The earlier "blame
 *  every step-tool on every ticked command" rule was wrong: e.g.
 *  the recon step lists Nmap + Naabu + Masscan as tools, so
 *  ticking the Nmap command alone painted Naabu and Masscan onto
 *  the map too — implying the user ran tools they hadn\'t. We
 *  now only attribute a tool when its name appears as a word in
 *  the command\'s text (command + label, case-insensitive, word
 *  boundaries). Tools with no textual match are skipped — if the
 *  command genuinely doesn\'t invoke any of the step\'s tools,
 *  it shouldn\'t claim any. */
function collectTools(
  input: DeriveInput,
  reconToolIds: Set<string>,
): DerivedTool[] {
  const seen = new Map<string, DerivedTool>();
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!input.progress.has(commandItemId(phase.slug, i, cIdx))) continue;
        if (!commandPasses(cmd, input, techCheck)) continue;
        for (const t of step.tools ?? []) {
          if (seen.has(t.url)) continue;
          if (!commandMentionsTool(cmd, t.name)) continue;
          const toolId = `tool:${t.url}`;
          /* Recon tools (tools that discovered any service) are
             promoted to host so the service can parent to them
             without forming a cycle. Otherwise pick parent from
             the tool\'s own techApplies first, else the
             originating command\'s, else host. */
          let parentId: string;
          if (reconToolIds.has(toolId)) {
            parentId = 'host';
          } else {
            parentId = 'host';
            for (const tag of t.techApplies ?? cmd.techApplies ?? []) {
              if (input.techTags.includes(tag)) {
                parentId = serviceIdFor(tag);
                break;
              }
            }
          }
          seen.set(t.url, {
            id: toolId,
            parentId,
            label: t.name,
            meta: t.kind,
            url: t.url,
            phase: phase.slug,
          });
        }
      }
    }
  }
  return [...seen.values()];
}

/** Flatten every tool entry across the catalog into a single array.
 *  AI-generated commands don\'t live inside any specific step, so we
 *  match their text against the *whole* tool inventory rather than
 *  the per-step lists used for catalog commands. Deduped by URL. */
function collectAllCatalogTools(): ToolRef[] {
  const seen = new Map<string, ToolRef>();
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      for (const tool of step.tools ?? []) {
        if (!seen.has(tool.url)) seen.set(tool.url, tool);
      }
    }
  }
  return [...seen.values()];
}

/** Walk every ticked-ran AI-generated command and emit findings
 *  derived from CVE-bearing labels. Mirrors collectFindings\'
 *  parent-picking logic (tool-by-text-match → service-by-tag →
 *  host) but searches the whole catalog tool inventory rather
 *  than a single step\'s tools array. Generated findings get
 *  unique ids prefixed with `find:gen:` so they don\'t collide
 *  with catalog ids when the layout walk groups by parent. */
function collectFindingsFromGenerations(
  input: DeriveInput,
  catalogTools: ToolRef[],
  alreadyEmittedToolIds: Set<string>,
): DerivedFinding[] {
  const out: DerivedFinding[] = [];
  for (const gen of input.aiGenerations ?? []) {
    const ticked = new Set(gen.ranIndices ?? []);
    for (const i of ticked) {
      const cmd = gen.result.commands[i];
      if (!cmd) continue;
      const finding = generatedCommandToFinding(cmd);
      if (!finding) continue;

      /* Parent picking — same priority as the catalog finding
         walker: tool whose name appears in the command, then
         service-by-tag, then host. Only pick a tool that\'s
         actually in the live graph (`alreadyEmittedToolIds`)
         so we don\'t hang findings off a phantom parent. */
      let parentId: string | null = null;
      const text = `${cmd.command} ${cmd.label ?? ''}`;
      for (const tool of catalogTools) {
        if (!textMentionsTool(text, tool.name)) continue;
        const candidate = `tool:${tool.url}`;
        if (alreadyEmittedToolIds.has(candidate)) {
          parentId = candidate;
          break;
        }
      }
      if (!parentId) {
        for (const tag of cmd.techApplies ?? []) {
          if (input.techTags.includes(tag as TechTag)) {
            parentId = serviceIdFor(tag);
            break;
          }
        }
      }
      if (!parentId) parentId = 'host';

      out.push({
        id: `find:gen:${gen.id}:${i}`,
        parentId,
        label: finding.label,
        meta: finding.meta,
        techniques: cmd.mitreTechniques ?? [],
        /* Empty phase string suppresses the phase chip on the
           finding node — the `generated` flag carries the
           provenance signal instead. */
        phase: '',
        generated: true,
      });
    }
  }
  return out;
}

/** Walk every ticked-ran AI-generated command and emit tool
 *  nodes for catalog tools the commands invoke. Skips tools
 *  already covered by the catalog walk so we don\'t produce
 *  duplicate ids — generated-only tools fill in the gaps. */
function collectToolsFromGenerations(
  input: DeriveInput,
  catalogTools: ToolRef[],
  reconToolIds: Set<string>,
  alreadyEmittedToolIds: Set<string>,
): DerivedTool[] {
  const seen = new Map<string, DerivedTool>();
  for (const gen of input.aiGenerations ?? []) {
    const ticked = new Set(gen.ranIndices ?? []);
    for (const i of ticked) {
      const cmd = gen.result.commands[i];
      if (!cmd) continue;
      const text = `${cmd.command} ${cmd.label ?? ''}`;

      for (const tool of catalogTools) {
        const toolId = `tool:${tool.url}`;
        if (alreadyEmittedToolIds.has(toolId)) continue;
        if (seen.has(toolId)) continue;
        if (!textMentionsTool(text, tool.name)) continue;

        /* Same parent rules as catalog tool walker. */
        let parentId: string;
        if (reconToolIds.has(toolId)) {
          parentId = 'host';
        } else {
          parentId = 'host';
          for (const tag of tool.techApplies ?? cmd.techApplies ?? []) {
            if (input.techTags.includes(tag as TechTag)) {
              parentId = serviceIdFor(tag);
              break;
            }
          }
        }
        seen.set(toolId, {
          id: toolId,
          parentId,
          label: tool.name,
          meta: tool.kind,
          url: tool.url,
          /* Empty phase suppresses the phase chip; generated
             flag is the provenance signal. */
          phase: '',
          generated: true,
        });
      }
    }
  }
  return [...seen.values()];
}

/** Same shape as commandToFinding but for GeneratedCommand —
 *  GeneratedCommand has `label` only (no separate `command`
 *  vs `description` distinction we care about), so the
 *  extraction is simpler. */
function generatedCommandToFinding(
  cmd: GeneratedCommand,
): { label: string; meta?: string } | null {
  const label = cmd.label ?? '';
  const cveMatch = label.match(CVE_PATTERN);
  if (cveMatch) {
    return {
      label: extractFindingLabel(label, cveMatch[0]),
      meta: cveMatch[0],
    };
  }
  return null;
}

/** Decide whether a command\'s text invokes a particular tool by
 *  checking if the tool\'s name (or any significant word of a
 *  multi-word name) appears as a standalone word in the command\'s
 *  shell text or label.
 *
 *  Word-boundary matching avoids substring false positives
 *  ("nmap" mistakenly matching "nmapsx" or similar). Generic
 *  decorations like "suite" / "pro" / "framework" are dropped so
 *  "Burp Suite" matches a command that just says `burp`, and
 *  "Metasploit Framework" matches `msfconsole` patterns where the
 *  word "metasploit" appears in the label. */
const TOOL_NAME_STOPWORDS = new Set([
  'suite', 'pro', 'framework', 'cli', 'gui', 'web', 'tool', 'tools',
  'the', 'and', 'for', 'with', 'reference', 'modules', 'templates',
  'edition', 'project', 'api', 'scan', 'guide', 'feed', 'json',
]);

function commandMentionsTool(cmd: CommandSnippet, toolName: string): boolean {
  return textMentionsTool(`${cmd.command} ${cmd.label ?? ''}`, toolName);
}

/** Underlying word-boundary match. Same logic shared by both the
 *  catalog\'s commandMentionsTool and the generated-content path. */
function textMentionsTool(text: string, toolName: string): boolean {
  const haystack = text.toLowerCase();
  const words = toolName
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => w.length >= 3 && !TOOL_NAME_STOPWORDS.has(w));
  if (words.length === 0) return false;
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`).test(haystack)) return true;
  }
  return false;
}

/** Count ticked commands tagged with a given tech tag. Drives the
 *  per-service activity meta line ("3 ran"). */
function countRanForTag(input: DeriveInput, tag: TechTag): number {
  let n = 0;
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!input.progress.has(commandItemId(phase.slug, i, cIdx))) continue;
        if (!commandPasses(cmd, input, techCheck)) continue;
        if (!(cmd.techApplies ?? []).includes(tag)) continue;
        n++;
      }
    }
  }
  return n;
}

function commandToFinding(
  cmd: CommandSnippet,
  input: DeriveInput,
): { label: string; meta?: string } | null {
  const label = cmd.label ?? '';
  /* Direct CVE in the label → finding. */
  const cveMatch = label.match(CVE_PATTERN);
  if (cveMatch) {
    return {
      label: extractFindingLabel(label, cveMatch[0]),
      meta: cveMatch[0],
    };
  }
  /* CVE present in a relevant scratch value → use that. */
  const scratchCve = input.scratchValues.cve;
  if (scratchCve && CVE_PATTERN.test(scratchCve)) {
    /* Avoid duplicating the same scratch-CVE finding for every
       ticked command — only the first vuln-named command in the
       walk produces it. We handle the duplicate by id-equality
       in the caller (same id never repeats), but here we still
       want every plausible source to nominate a finding. Keep
       it. */
    return null;
  }
  return null;
}

function extractFindingLabel(commandLabel: string, cve: string): string {
  /* Strip the cvemap prefix and the trailing "(CVE-...)" so the
     finding reads cleanly. */
  return commandLabel
    .replace(/^cvemap\s*[—-]\s*/i, '')
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(cve, '')
    .trim() || cve;
}

/** Pick the right parent for a finding-producing command —
 *  matching service-by-tag if the command has a tag we picked,
 *  else the host. */
function parentForCommand(cmd: CommandSnippet, input: DeriveInput): string {
  for (const t of cmd.techApplies ?? []) {
    if (input.techTags.includes(t)) {
      return serviceIdFor(t);
    }
  }
  return 'host';
}

function commandPasses(
  cmd: CommandSnippet,
  input: DeriveInput,
  techCheck: typeof isTechVisible,
): boolean {
  const eng =
    !cmd.appliesTo ||
    (input.engagement !== null &&
      cmd.appliesTo.includes(input.engagement as never));
  if (!eng) return false;
  if (!isOSVisible(cmd.osApplies, input.targetOS as never)) return false;
  if (!techCheck(cmd.techApplies, input.techTags)) return false;
  return true;
}

function collectAllDemonstrated(input: DeriveInput): string[] {
  const set = new Set<string>();
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!cmd.mitreTechniques) continue;
        if (!input.progress.has(commandItemId(phase.slug, i, cIdx))) continue;
        if (!commandPasses(cmd, input, techCheck)) continue;
        for (const t of cmd.mitreTechniques) set.add(t);
      }
    }
  }
  return [...set].sort();
}

function collectDemonstratedForTag(
  input: DeriveInput,
  tag: TechTag,
): string[] {
  const set = new Set<string>();
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      const techCheck = step.requiresTechSelection
        ? isTechVisibleStrict
        : isTechVisible;
      for (let cIdx = 0; cIdx < (step.commands?.length ?? 0); cIdx++) {
        const cmd = step.commands![cIdx];
        if (!cmd.mitreTechniques) continue;
        if (!input.progress.has(commandItemId(phase.slug, i, cIdx))) continue;
        if (!commandPasses(cmd, input, techCheck)) continue;
        if (!(cmd.techApplies ?? []).includes(tag)) continue;
        for (const t of cmd.mitreTechniques) set.add(t);
      }
    }
  }
  return [...set].sort();
}
