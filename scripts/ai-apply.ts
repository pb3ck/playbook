/**
 * ai:apply — automated catalog merge for AI-drafted candidates.
 *
 * Takes a YAML draft (output of `npm run ai:draft`), asks Claude
 * which step in lib/methodology.ts each candidate should land in,
 * generates TypeScript snippets, patches the catalog file, and
 * runs typecheck. On typecheck failure, restores the original.
 *
 * Why this exists: hand-merging AI drafts has been the bottleneck.
 * Each merge is "find the right step, write valid TS, format it
 * to match the file, get the indentation right, run coverage."
 * The AI is already doing the hardest part (writing correct
 * commands with sources + MITRE); placement is mechanical
 * judgment the model can also do well. This script collapses
 * the per-merge friction without removing human review — you
 * still get a `git diff` to look at before committing.
 *
 * Usage:
 *   npm run ai:apply -- scripts/drafts/wordpress-vuln.yaml
 *   npm run ai:apply -- scripts/drafts/wordpress-vuln.yaml --dry-run
 *   npm run ai:apply -- scripts/drafts/wordpress-vuln.yaml --model claude-opus-4-5
 *
 * What you get:
 *   - lib/methodology.ts modified in place (run `git diff` to review)
 *   - typecheck runs automatically; revert-on-failure
 *   - any tool entries the model recommends are PRINTED (not
 *     applied) — adding tools is a one-line edit you can do by
 *     hand once you\'ve seen the diff
 *   - per-placement reasoning + confidence printed so you can
 *     spot-check the model\'s judgment before `git commit`
 *
 * What it deliberately doesn\'t do:
 *   - never marks anything `validated:` (you do that after a
 *     lab pass)
 *   - never modifies tech-tags.ts (adding a new tag is a
 *     deliberate type-union extension that warrants human eyes)
 *   - never commits or pushes
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { PHASES } from '../lib/methodology';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const METHODOLOGY_PATH = join(REPO_ROOT, 'lib', 'methodology.ts');

/* =================================================== Types */

type DraftEntry = {
  label?: string;
  command: string;
  appliesTo?: string[];
  osApplies?: string[];
  techApplies?: string[];
  mitreTechniques?: string[];
  source?: string;
  confidence?: 'low' | 'medium' | 'high';
  notes?: string;
};

type DraftFile = {
  drafts: DraftEntry[];
};

type Placement = {
  draftIndex: number;
  /** Phase slug to insert into; null = AI says skip this candidate. */
  phase: string | null;
  /** Step index within the phase. */
  stepIndex: number | null;
  reasoning: string;
  confidence: 'low' | 'medium' | 'high';
};

type ToolRecommendation = {
  phase: string;
  stepIndex: number;
  name: string;
  url: string;
  kind: string;
  techApplies?: string[];
  reasoning: string;
};

type AiResponse = {
  placements: Placement[];
  toolRecommendations: ToolRecommendation[];
};

/* =================================================== Env loader */

function loadEnvLocal() {
  const path = join(REPO_ROOT, '.env.local');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, '');
  }
}

/* =================================================== CLI */

type Args = {
  draftPath: string;
  model: string;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const draftPath = argv.find((a) => !a.startsWith('--')) ?? '';
  const modelIdx = argv.indexOf('--model');
  const model = modelIdx === -1 ? 'claude-sonnet-4-5' : argv[modelIdx + 1];
  const dryRun = argv.includes('--dry-run');

  if (!draftPath || !existsSync(draftPath)) {
    console.error(
      'Usage: npm run ai:apply -- <draft-file.yaml> [--model <id>] [--dry-run]\n\n' +
        'Reads the draft, asks Claude to place each candidate, patches\n' +
        'lib/methodology.ts, runs typecheck. Prints diff summary +\n' +
        'recommended tool additions for you to review with `git diff`.',
    );
    process.exit(2);
  }
  return { draftPath, model, dryRun };
}

/* =================================================== Step extraction */

/** Extract a description of every step in the catalog so the
 *  model can pick where each candidate fits. We pass titles +
 *  descriptions + the existing command count so the model has
 *  enough context to make a good placement decision without us
 *  having to dump the entire 1700-line catalog into the prompt. */
function extractStepIndex(): {
  phase: string;
  stepIndex: number;
  title: string;
  description: string;
  existingCommands: number;
}[] {
  const out: {
    phase: string;
    stepIndex: number;
    title: string;
    description: string;
    existingCommands: number;
  }[] = [];
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      out.push({
        phase: phase.slug,
        stepIndex: i,
        title: step.title,
        /* Trim long descriptions — we just need enough for the
           model to identify themes. The full text would balloon
           the prompt. */
        description:
          step.description.length > 240
            ? step.description.slice(0, 237) + '...'
            : step.description,
        existingCommands: (step.commands ?? []).length,
      });
    }
  }
  return out;
}

/* =================================================== Prompt */

function buildPrompt(
  drafts: DraftEntry[],
  steps: ReturnType<typeof extractStepIndex>,
): string {
  const stepsText = steps
    .map(
      (s, i) =>
        `${i}. [${s.phase}/${s.stepIndex}] "${s.title}" (${s.existingCommands} existing cmds)\n   ${s.description}`,
    )
    .join('\n');

  const draftsText = drafts
    .map((d, i) => {
      const parts = [`### draft ${i}`];
      if (d.label) parts.push(`- label: ${d.label}`);
      parts.push(`- command: ${d.command.replace(/\n/g, ' ')}`);
      if (d.techApplies)
        parts.push(`- techApplies: ${d.techApplies.join(', ')}`);
      if (d.osApplies) parts.push(`- osApplies: ${d.osApplies.join(', ')}`);
      if (d.mitreTechniques)
        parts.push(`- mitre: ${d.mitreTechniques.join(', ')}`);
      if (d.source) parts.push(`- source: ${d.source}`);
      if (d.confidence) parts.push(`- confidence: ${d.confidence}`);
      if (d.notes) parts.push(`- notes: ${d.notes}`);
      return parts.join('\n');
    })
    .join('\n\n');

  return `You're placing AI-drafted command candidates into the right step of an offensive-security playbook catalog. Output a JSON object with placement decisions and tool recommendations.

## The catalog's steps

Each line is "[phase-slug/step-index] title (cmd-count): description". Pick the step whose theme best matches each draft. Same-phase placement is strongly preferred (recon-flavored draft → recon step); cross-phase is acceptable when the draft genuinely belongs elsewhere.

${stepsText}

## The candidates to place

${draftsText}

## Your task

For each draft, return ONE of:
- A specific phase + stepIndex where the command best fits
- \`phase: null\` if you recommend skipping (duplicate, low confidence, doesn't fit any step well)

For each draft you decide to place, also recommend any tool entries that would help. Tools live on \`step.tools\`; if a draft uses a tool that isn't yet in the target step's tools array, recommend adding it. The maintainer will add tools by hand based on your output.

## Hard rules

1. Output JSON only. No prose, no fences, begin with \`{\`.
2. Every draft must appear exactly once in \`placements\`.
3. \`stepIndex\` must be an integer that exists in the named phase. Pick from the list above.
4. \`reasoning\` is one sentence — the maintainer reads it during \`git diff\` review.
5. \`confidence\`: high = "obvious fit," medium = "best of available," low = "I'm guessing."
6. Tool recommendations must include \`name\`, \`url\`, \`kind\` ('cli' | 'web' | 'gui'), and the step (phase + stepIndex) it should be added to. Don't recommend a tool that's already in that step's tools array (you can't see the tool list directly, so use your judgment based on the catalog's tool naming conventions you've seen).
7. Skip rather than placing badly. A skip is better than a wrong placement.

## Output schema

\`\`\`json
{
  "placements": [
    {
      "draftIndex": 0,
      "phase": "exploit",
      "stepIndex": 2,
      "reasoning": "Direct exploit-phase fit; targets initial access via WebDAV upload.",
      "confidence": "high"
    }
  ],
  "toolRecommendations": [
    {
      "phase": "exploit",
      "stepIndex": 2,
      "name": "Gixy",
      "url": "https://github.com/yandex/gixy",
      "kind": "cli",
      "techApplies": ["nginx"],
      "reasoning": "Used by draft 5; not yet a step.tools entry."
    }
  ]
}
\`\`\`

Begin output now.`;
}

/* =================================================== Anthropic call */

async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/* =================================================== TS formatter */

/** Format a draft as a TypeScript CommandSnippet literal that
 *  matches the existing catalog style. The catalog uses single
 *  quotes for short strings and template literals for multi-line
 *  shell commands; we mirror that with JSON.stringify which
 *  produces double-quoted strings (TypeScript accepts both, and
 *  it sidesteps escape-quote landmines with apostrophes inside
 *  commands). */
function formatCommand(d: DraftEntry, indentPrefix: string): string {
  const indent = indentPrefix;
  const inner = indentPrefix + '  ';
  const lines: string[] = [`${indent}{`];
  if (d.label) lines.push(`${inner}label: ${JSON.stringify(d.label)},`);
  lines.push(`${inner}command: ${JSON.stringify(d.command.trimEnd())},`);
  if (d.appliesTo) lines.push(`${inner}appliesTo: ${JSON.stringify(d.appliesTo)},`);
  if (d.osApplies) lines.push(`${inner}osApplies: ${JSON.stringify(d.osApplies)},`);
  if (d.techApplies)
    lines.push(`${inner}techApplies: ${JSON.stringify(d.techApplies)},`);
  if (d.mitreTechniques)
    lines.push(`${inner}mitreTechniques: ${JSON.stringify(d.mitreTechniques)},`);
  lines.push(`${indent}},`);
  return lines.join('\n');
}

/* =================================================== Source surgery
   We patch the catalog file by:
     1. Finding the phase block (by `slug: 'X'` line)
     2. Finding the step within (by title text)
     3. Locating that step\'s `commands: [` opening
     4. Bracket-counting forward to find the matching `]`
     5. Inserting the new commands before that `]`
   The catalog\'s formatting is consistent enough that bracket
   counting (ignoring brackets in single-quoted strings) works
   reliably. We pre-validate and revert via typecheck if it
   doesn\'t. */

/** Strip a single line of comments + string literals so the
 *  brackets we count are actually structural. Tolerates the
 *  catalog's quoting style: single-quoted strings, no template
 *  literals (yet). */
function stripStringsAndComments(line: string): string {
  let out = '';
  let i = 0;
  let inStr: string | null = null;
  while (i < line.length) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === '/' && line[i + 1] === '/') break; // line comment
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end === -1) return out; // multiline comment runs to EOL
      i = end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function findPhaseBlockBounds(
  lines: string[],
  phaseSlug: string,
): { start: number; end: number } | null {
  /* Each phase is an object literal in the PHASES array.
     The phase boundary is "the line containing slug: 'X'" through
     "the close of that object literal." We anchor on the slug
     line and walk forward tracking brace depth from the phase\'s
     enclosing `{`. */
  const slugRe = new RegExp(`slug:\\s*['"]${phaseSlug}['"]`);
  const slugLine = lines.findIndex((l) => slugRe.test(l));
  if (slugLine === -1) return null;
  /* Walk backward from slugLine to the opening `{` at the
     phase\'s indent — typically just before the slug line or
     within a few lines (after the leading comment). */
  let openLine = slugLine;
  while (openLine > 0 && !lines[openLine].trim().startsWith('{')) openLine--;
  /* Walk forward tracking brace depth to find the matching `}`. */
  let depth = 0;
  let endLine = openLine;
  for (let i = openLine; i < lines.length; i++) {
    const stripped = stripStringsAndComments(lines[i]);
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i >= openLine) {
      endLine = i;
      break;
    }
  }
  return { start: openLine, end: endLine };
}

function findStepBlockBounds(
  lines: string[],
  phaseStart: number,
  phaseEnd: number,
  stepTitle: string,
): { start: number; end: number } | null {
  /* Step titles aren\'t guaranteed unique catalog-wide; bound
     the search to the phase block. Anchor on the title text
     in the `title: '...'` line, then walk backward to the step\'s
     opening `{`. */
  const escTitle = stepTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titleRe = new RegExp(`title:\\s*['"]${escTitle}['"]`);
  let titleLine = -1;
  for (let i = phaseStart; i <= phaseEnd; i++) {
    if (titleRe.test(lines[i])) {
      titleLine = i;
      break;
    }
  }
  if (titleLine === -1) return null;
  let openLine = titleLine;
  while (openLine > phaseStart && !lines[openLine].trim().startsWith('{'))
    openLine--;
  let depth = 0;
  let endLine = openLine;
  for (let i = openLine; i <= phaseEnd; i++) {
    const stripped = stripStringsAndComments(lines[i]);
    for (const ch of stripped) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth === 0 && i >= openLine) {
      endLine = i;
      break;
    }
  }
  return { start: openLine, end: endLine };
}

function findCommandsArrayClose(
  lines: string[],
  stepStart: number,
  stepEnd: number,
): { closingLine: number; indent: string } | null {
  /* Find the line containing `commands: [` inside the step,
     then walk forward tracking [ ] depth to the matching ]. */
  let openLine = -1;
  for (let i = stepStart; i <= stepEnd; i++) {
    if (/commands:\s*\[/.test(lines[i])) {
      openLine = i;
      break;
    }
  }
  if (openLine === -1) return null;
  let depth = 0;
  for (let i = openLine; i <= stepEnd; i++) {
    const stripped = stripStringsAndComments(lines[i]);
    for (const ch of stripped) {
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
    }
    if (depth === 0 && i >= openLine) {
      const indentMatch = lines[i].match(/^(\s*)/);
      return {
        closingLine: i,
        indent: (indentMatch?.[1] ?? '') + '  ',
      };
    }
  }
  return null;
}

/** Apply a list of placements to the source text, returning the
 *  modified text. Inserts each command at the end of its target
 *  step\'s `commands` array (right before the closing `]`).
 *  Multiple commands targeting the same step are inserted in
 *  reverse-of-arrival order at the same position so the relative
 *  draft order is preserved. */
function applyPlacements(
  source: string,
  drafts: DraftEntry[],
  placements: Placement[],
  steps: ReturnType<typeof extractStepIndex>,
): { result: string; applied: number; skipped: number } {
  const lines = source.split('\n');

  /* Group placements by (phase, stepIndex) so we can do one
     surgery per step (multiple commands → one insert point). */
  const byStep = new Map<string, { drafts: DraftEntry[]; phase: string; stepIndex: number }>();
  let applied = 0;
  let skipped = 0;
  for (const p of placements) {
    if (p.phase === null || p.stepIndex === null) {
      skipped++;
      continue;
    }
    const key = `${p.phase}/${p.stepIndex}`;
    const list = byStep.get(key);
    const draft = drafts[p.draftIndex];
    if (!draft) continue;
    if (list) {
      list.drafts.push(draft);
    } else {
      byStep.set(key, { drafts: [draft], phase: p.phase, stepIndex: p.stepIndex });
    }
    applied++;
  }

  /* Apply in reverse line order so earlier inserts don\'t shift
     later anchor positions. We compute all insertion sites first
     against the ORIGINAL line numbers, then apply bottom-up. */
  type Insert = { line: number; text: string };
  const inserts: Insert[] = [];
  for (const { drafts: dList, phase, stepIndex } of byStep.values()) {
    const stepInfo = steps.find(
      (s) => s.phase === phase && s.stepIndex === stepIndex,
    );
    if (!stepInfo) {
      console.warn(`  ⚠ step ${phase}/${stepIndex} not found in PHASES`);
      continue;
    }
    const phaseBounds = findPhaseBlockBounds(lines, phase);
    if (!phaseBounds) {
      console.warn(`  ⚠ phase ${phase} block not found in source`);
      continue;
    }
    const stepBounds = findStepBlockBounds(
      lines,
      phaseBounds.start,
      phaseBounds.end,
      stepInfo.title,
    );
    if (!stepBounds) {
      console.warn(
        `  ⚠ step "${stepInfo.title}" not found in phase ${phase}`,
      );
      continue;
    }
    const cmdsClose = findCommandsArrayClose(
      lines,
      stepBounds.start,
      stepBounds.end,
    );
    if (!cmdsClose) {
      console.warn(
        `  ⚠ commands array close not found in step "${stepInfo.title}"`,
      );
      continue;
    }
    const formatted = dList
      .map((d) => formatCommand(d, cmdsClose.indent))
      .join('\n');
    inserts.push({ line: cmdsClose.closingLine, text: formatted });
  }

  inserts.sort((a, b) => b.line - a.line);
  for (const ins of inserts) {
    lines.splice(ins.line, 0, ins.text);
  }

  return { result: lines.join('\n'), applied, skipped };
}

/* =================================================== Main */

async function main() {
  loadEnvLocal();
  const args = parseArgs();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY in .env.local');
    process.exit(1);
  }

  /* Load + parse draft. */
  const draftRaw = readFileSync(args.draftPath, 'utf8');
  let draft: DraftFile;
  try {
    draft = parseYaml(draftRaw) as DraftFile;
  } catch (err) {
    console.error(`Failed to parse draft YAML: ${err}`);
    process.exit(1);
  }
  if (!draft?.drafts || !Array.isArray(draft.drafts)) {
    console.error('Draft file must have a `drafts:` array');
    process.exit(1);
  }
  console.log(
    `Loaded ${draft.drafts.length} candidate${draft.drafts.length === 1 ? '' : 's'} from ${args.draftPath}`,
  );

  /* Catalog snapshot. */
  const steps = extractStepIndex();
  console.log(`Catalog has ${steps.length} steps across ${PHASES.length} phases`);

  /* Ask Claude for placements. */
  const prompt = buildPrompt(draft.drafts, steps);
  console.log(`Calling ${args.model}...`);
  const t0 = Date.now();
  const { text, inputTokens, outputTokens } = await callClaude(
    apiKey,
    args.model,
    prompt,
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `Got response in ${elapsed}s · ${inputTokens} in / ${outputTokens} out tokens`,
  );

  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  let aiResponse: AiResponse;
  try {
    aiResponse = JSON.parse(cleaned);
  } catch (err) {
    console.error(`Failed to parse AI response as JSON: ${err}`);
    console.error(`First 500 chars: ${cleaned.slice(0, 500)}`);
    process.exit(1);
  }

  /* Print the placement plan + reasoning before any surgery —
     gives the maintainer transparency on the model\'s judgment. */
  console.log('\n──── placement plan ────');
  for (const p of aiResponse.placements) {
    const entry = draft.drafts[p.draftIndex];
    const label = entry?.label ?? `(unlabeled #${p.draftIndex})`;
    if (p.phase === null) {
      console.log(`  ✗ skip · ${label} — ${p.reasoning}`);
    } else {
      console.log(
        `  → ${p.phase}/${p.stepIndex} · ${label} [${p.confidence}] — ${p.reasoning}`,
      );
    }
  }

  /* Patch source. */
  const sourceText = readFileSync(METHODOLOGY_PATH, 'utf8');
  const { result, applied, skipped } = applyPlacements(
    sourceText,
    draft.drafts,
    aiResponse.placements,
    steps,
  );
  console.log(`\nApplied ${applied} insertion${applied === 1 ? '' : 's'}, ${skipped} skipped`);

  if (args.dryRun) {
    console.log('\n--dry-run — no file written. Diff preview:');
    /* Print a unified-ish diff snippet so the maintainer can
       eyeball without writing. We don\'t do full diff, just the
       new lines. */
    console.log(`(would modify ${METHODOLOGY_PATH}, ${result.split('\n').length - sourceText.split('\n').length} new lines)`);
    return;
  }

  writeFileSync(METHODOLOGY_PATH, result);
  console.log(`\nWrote ${METHODOLOGY_PATH}`);

  /* Typecheck — if it fails, restore the original. */
  console.log('Running typecheck...');
  try {
    execSync('npm run typecheck', { cwd: REPO_ROOT, stdio: 'pipe' });
    console.log('✓ typecheck passed');
  } catch (err) {
    console.error('✗ typecheck FAILED — reverting');
    writeFileSync(METHODOLOGY_PATH, sourceText);
    if (err instanceof Error && 'stdout' in err) {
      const e = err as Error & { stdout?: Buffer };
      console.error(e.stdout?.toString().slice(0, 1500));
    }
    process.exit(1);
  }

  /* Recommended tool additions — print, don\'t apply. Adding tools
     is a one-line edit per tool and the maintainer should pick
     which ones make sense after seeing the resulting diff. */
  if (aiResponse.toolRecommendations?.length > 0) {
    console.log('\n──── recommended tool additions (apply by hand if useful) ────');
    for (const t of aiResponse.toolRecommendations) {
      const tagsField = t.techApplies?.length
        ? `, techApplies: [${t.techApplies.map((x) => `'${x}'`).join(', ')}]`
        : '';
      console.log(
        `  ${t.phase}/${t.stepIndex}: { name: '${t.name}', url: '${t.url}', kind: '${t.kind}'${tagsField} }`,
      );
      console.log(`    — ${t.reasoning}`);
    }
  }

  console.log('\nNext: review with `git diff lib/methodology.ts` then commit.');
  console.log('Then `npm run coverage` to see the gauge move.');
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
  process.exit(1);
});
