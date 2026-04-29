import {
  PHASES,
  commandItemId,
  type CommandSnippet,
  type Phase,
  type PhaseStep,
  type ToolRef,
} from '@/lib/methodology';
import { engagementOf, type Engagement } from '@/lib/engagements';
import { isOSVisible, targetOSOf, type TargetOSChoice } from '@/lib/target-os';
import { isTechVisible, isTechVisibleStrict, type TechTag } from '@/lib/tech-tags';
import { interpolate } from '@/lib/playbook/template';

/**
 * Build a Markdown cheat-sheet of the playbook filtered to the
 * user's current axis selection. Used by the shell's "Export"
 * button — packages the same filtering the focus view applies into
 * a portable text artifact the user can stash in a notes app or
 * commit to an engagement folder.
 *
 * Decisions:
 *   - Markdown not JSON. Consumers of the JSON have the API; the
 *     export is for humans copying commands into terminals.
 *   - Skip steps that have neither a visible command nor a visible
 *     tool (the user wouldn't have anything to do in them after
 *     filtering — including them is just noise).
 *   - Interpolate `{target}` + per-tag `{version}` + scratch tokens
 *     before emit, so the file the user saves has their values
 *     baked in, not placeholders.
 */
export function buildCheatsheet(args: {
  engagement: Engagement | null;
  targetOS: TargetOSChoice | null;
  techTags: TechTag[];
  target: string;
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  /** Set of stable item ids the user has marked complete — both
   *  `${slug}:step:${i}` and `${slug}:cmd:${stepIdx}:${cmdIdx}`.
   *  Commands the user has ticked get a `# ran` comment in the
   *  exported sh fence so the artifact reflects what was actually
   *  executed, not just what was suggested. */
  progress: Set<string>;
}): string {
  const { engagement, targetOS, techTags, target, versions, scratchValues, progress } = args;
  const eng = engagementOf(engagement);
  const os = targetOSOf(targetOS);

  const header = buildHeader({
    engLabel: eng?.label ?? 'no engagement',
    osLabel: os?.label ?? 'no os',
    techTags,
    target,
  });

  const phaseBlocks = PHASES.map((phase) =>
    renderPhase({
      phase,
      engagement,
      targetOS,
      techTags,
      target,
      versions,
      scratchValues,
      progress,
    }),
  ).filter((block) => block.length > 0);

  return [header, ...phaseBlocks].join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Default download filename. `engagement-os-YYYYMMDD.md` —
 * predictable, sortable, fits in a folder of engagements without
 * collision.
 */
export function defaultExportFilename(args: {
  engagement: Engagement | null;
  targetOS: TargetOSChoice | null;
}): string {
  const e = args.engagement ?? 'playbook';
  const o = args.targetOS ?? 'any';
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `playbook-${e}-${o}-${yyyy}${mm}${dd}.md`;
}

/* =================================================== internals */

function buildHeader(args: {
  engLabel: string;
  osLabel: string;
  techTags: TechTag[];
  target: string;
}): string {
  const stack =
    args.techTags.length === 0 ? 'no tags' : args.techTags.join(' · ');
  const tgt = args.target.length > 0 ? args.target : '<target>';
  const ts = new Date().toISOString();
  return [
    `# Pentest cheat-sheet`,
    ``,
    `- engagement: **${args.engLabel}**`,
    `- target OS: **${args.osLabel}**`,
    `- stack: ${stack}`,
    `- target: \`${tgt}\``,
    `- generated: ${ts} (playbook)`,
  ].join('\n');
}

function renderPhase(args: {
  phase: Phase;
  engagement: Engagement | null;
  targetOS: TargetOSChoice | null;
  techTags: TechTag[];
  target: string;
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  progress: Set<string>;
}): string {
  /* Walk steps with their original index so we can derive
     command ids for the per-command "ran" markers below. */
  const visibleSteps = args.phase.steps
    .map((step, originalIndex) => ({ step, originalIndex }))
    .filter(({ step }) =>
      stepPasses(step, args.engagement, args.targetOS, args.techTags),
    );

  const stepBlocks: string[] = [];
  for (const { step, originalIndex } of visibleSteps) {
    const block = renderStep({
      step,
      stepIndex: originalIndex,
      phaseSlug: args.phase.slug,
      engagement: args.engagement,
      targetOS: args.targetOS,
      techTags: args.techTags,
      target: args.target,
      versions: args.versions,
      scratchValues: args.scratchValues,
      progress: args.progress,
    });
    if (block.length > 0) stepBlocks.push(block);
  }

  if (stepBlocks.length === 0) return '';

  return [
    `## ${args.phase.name}`,
    args.phase.goal,
    '',
    ...stepBlocks,
  ].join('\n');
}

function renderStep(args: {
  step: PhaseStep;
  stepIndex: number;
  phaseSlug: string;
  engagement: Engagement | null;
  targetOS: TargetOSChoice | null;
  techTags: TechTag[];
  target: string;
  versions: Record<string, string>;
  scratchValues: Record<string, string>;
  progress: Set<string>;
}): string {
  const techCheck = args.step.requiresTechSelection
    ? isTechVisibleStrict
    : isTechVisible;

  /* Preserve original command index so per-command "ran" lookups
     remain stable through the filter. */
  const visibleCommands = (args.step.commands ?? [])
    .map((c, originalIndex) => ({ command: c, originalIndex }))
    .filter(({ command: c }) =>
      cmdPasses(c, args.engagement, args.targetOS, args.techTags, techCheck),
    );
  const visibleTools = (args.step.tools ?? []).filter((t) =>
    toolPasses(t, args.engagement, args.targetOS, args.techTags, techCheck),
  );

  if (visibleCommands.length === 0 && visibleTools.length === 0) return '';

  const out: string[] = [`### ${args.step.title}`, args.step.description, ''];

  if (visibleCommands.length > 0) {
    out.push('**Commands**');
    out.push('');
    for (const { command: c, originalIndex } of visibleCommands) {
      const resolvedVersion = resolveVersion(c, args.versions);
      const rendered = interpolate(
        c.command,
        { target: args.target, version: resolvedVersion },
        args.scratchValues,
      );
      const cmdId = commandItemId(args.phaseSlug, args.stepIndex, originalIndex);
      const ran = args.progress.has(cmdId);
      /* Provenance annotations: "✓ ran" reflects the user\'s
         per-command tick; "validated YYYY-MM-DD" reflects the
         maintainer\'s human-validated provenance from the catalog
         schema. Both surface inline so the cheatsheet user can
         tell apart "I ran this" from "this command is known to
         work on currently-supported versions." */
      const annotations: string[] = [];
      if (ran) annotations.push('**✓ ran**');
      if (c.validated) annotations.push(`*validated ${c.validated.on}*`);
      const annotationLine = annotations.join(' · ');
      if (c.label) {
        out.push(annotationLine ? `*${c.label}* — ${annotationLine}` : `*${c.label}*`);
      } else if (annotationLine) {
        out.push(annotationLine);
      }
      out.push('```sh');
      out.push(rendered);
      out.push('```');
      out.push('');
    }
  }

  if (visibleTools.length > 0) {
    out.push('**Tools**');
    out.push('');
    for (const t of visibleTools) {
      const note = t.note ? ` — ${t.note}` : '';
      out.push(`- [${t.name}](${t.url})${note}`);
    }
    out.push('');
  }

  return out.join('\n');
}

function stepPasses(
  step: PhaseStep,
  engagement: Engagement | null,
  os: TargetOSChoice | null,
  tags: TechTag[],
): boolean {
  const engOk =
    !step.appliesTo ||
    (engagement !== null && step.appliesTo.includes(engagement));
  return engOk && isOSVisible(step.osApplies, os) && isTechVisible(step.techApplies, tags);
}

function cmdPasses(
  c: CommandSnippet,
  engagement: Engagement | null,
  os: TargetOSChoice | null,
  tags: TechTag[],
  techCheck: typeof isTechVisible,
): boolean {
  const engOk =
    !c.appliesTo || (engagement !== null && c.appliesTo.includes(engagement));
  return engOk && isOSVisible(c.osApplies, os) && techCheck(c.techApplies, tags);
}

function toolPasses(
  t: ToolRef,
  engagement: Engagement | null,
  os: TargetOSChoice | null,
  tags: TechTag[],
  techCheck: typeof isTechVisible,
): boolean {
  const engOk =
    !t.appliesTo || (engagement !== null && t.appliesTo.includes(engagement));
  return engOk && isOSVisible(t.osApplies, os) && techCheck(t.techApplies, tags);
}

function resolveVersion(
  c: CommandSnippet,
  versions: Record<string, string>,
): string {
  for (const tag of c.techApplies ?? []) {
    const v = versions[tag];
    if (v && v.length > 0) return v;
  }
  return '';
}
