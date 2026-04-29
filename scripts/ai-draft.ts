/**
 * AI authoring CLI — drafts candidate command snippets for a given
 * tag + phase using Anthropic's Claude.
 *
 * This is a private dev tool. It runs on the maintainer's machine
 * with their own ANTHROPIC_API_KEY (set in .env.local). The end
 * user of the playbook never sees this — they consume the
 * validated, hand-merged commands from lib/methodology.ts.
 *
 * Workflow:
 *
 *   1. echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
 *   2. npm run ai:draft -- --tag tomcat --phase recon
 *   3. Open scripts/drafts/tomcat-recon.yaml in an editor
 *   4. Validate each command (run on a lab box, check the source URL)
 *   5. Paste validated commands into the right step in
 *      lib/methodology.ts
 *   6. npm run coverage    # see the gauge move
 *
 * Why YAML output: easy to hand-edit during validation, easy to
 * diff against the raw Claude response, easy for a future merge
 * script to reimport.
 *
 * Why this needs Anthropic security research enrollment: Claude's
 * default content policy refuses offensive-security prompts. The
 * enrolled program lets approved researchers use the API for this
 * exact use case. If you're not enrolled, the API call will
 * succeed but the output will be a refusal — point a different
 * provider at it (OpenAI, OpenRouter, local Ollama with an
 * uncensored model) by adapting `callProvider` below.
 */

import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASES } from '../lib/methodology.ts';
import { TECH_TAG_GROUPS, type TechTag } from '../lib/tech-tags.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/* =================================================== Env loader */

/** Parse a minimal .env.local without depending on dotenv. Lines
 *  that look like KEY=VALUE get added to process.env if not already
 *  set. Comments (#) and blank lines ignored. Quoted values get
 *  unquoted. Sufficient for one or two API keys; if we ever need
 *  multi-line values or substitution we can swap to dotenv. */
function loadEnvLocal() {
  const path = join(REPO_ROOT, '.env.local');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key]) continue;
    const value = raw.replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  }
}

/* =================================================== CLI */

type Args = {
  tag: TechTag;
  phase: string;
  count: number;
  engagement?: string;
  os?: string;
  model: string;
  outPath: string;
  dryRun: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const tag = get('tag');
  const phase = get('phase');
  if (!tag || !phase) {
    console.error(
      'Usage: npm run ai:draft -- --tag <tag> --phase <phase> [options]\n\n' +
        'Required:\n' +
        '  --tag <tag>           tech-tag id (apache, tomcat, kerberos, ...)\n' +
        '  --phase <phase>       phase slug (recon | vuln | exploit | post-ex | defense)\n\n' +
        'Optional:\n' +
        '  --count N             how many candidates to draft (default 5)\n' +
        '  --engagement <eng>    bug-bounty | private | lab\n' +
        '  --os <os>             linux | windows\n' +
        '  --model <id>          Anthropic model id (default claude-sonnet-4-5)\n' +
        '  --out <path>          output path (default scripts/drafts/<tag>-<phase>.yaml)\n' +
        '  --dry-run             print to stdout instead of writing the file',
    );
    process.exit(2);
  }

  const validTags = TECH_TAG_GROUPS.flatMap((g) =>
    g.tags.map((t) => t.id as string),
  );
  if (!validTags.includes(tag)) {
    console.error(
      `Unknown tag '${tag}'.\n\nValid tags:\n  ${validTags.join(', ')}\n\n` +
        `(If you want to add a new tag, add it to lib/tech-tags.ts first.)`,
    );
    process.exit(2);
  }

  const validPhases = PHASES.map((p) => p.slug);
  if (!validPhases.includes(phase)) {
    console.error(
      `Unknown phase '${phase}'. Valid: ${validPhases.join(' | ')}`,
    );
    process.exit(2);
  }

  const countRaw = get('count');
  const count = countRaw ? parseInt(countRaw, 10) : 5;
  if (!Number.isFinite(count) || count < 1 || count > 20) {
    console.error('--count must be an integer between 1 and 20');
    process.exit(2);
  }

  const engagement = get('engagement');
  if (engagement && !['bug-bounty', 'private', 'lab'].includes(engagement)) {
    console.error("--engagement must be one of: bug-bounty | private | lab");
    process.exit(2);
  }

  const os = get('os');
  if (os && !['linux', 'windows'].includes(os)) {
    console.error('--os must be one of: linux | windows');
    process.exit(2);
  }

  const model = get('model') ?? 'claude-sonnet-4-5';
  const outPath =
    get('out') ??
    join(REPO_ROOT, 'scripts', 'drafts', `${tag}-${phase}.yaml`);
  const dryRun = has('dry-run');

  return {
    tag: tag as TechTag,
    phase,
    count,
    engagement,
    os,
    model,
    outPath,
    dryRun,
  };
}

/* =================================================== Prompt */

function buildPrompt(args: Args): string {
  const phase = PHASES.find((p) => p.slug === args.phase)!;
  const tagInfo = TECH_TAG_GROUPS.flatMap((g) => g.tags).find(
    (t) => t.id === args.tag,
  )!;

  /* Pull up to 3 existing commands from the same phase to anchor
     tone + style. Prefer ones already tagged for this tag (highest
     fidelity reference); fall back to any commands in the phase. */
  const sameTagInPhase = phase.steps
    .flatMap((s) => s.commands ?? [])
    .filter((c) => c.techApplies?.includes(args.tag))
    .slice(0, 3);
  const fallback = phase.steps.flatMap((s) => s.commands ?? []).slice(0, 3);
  const examples = sameTagInPhase.length > 0 ? sameTagInPhase : fallback;

  const exampleYaml = examples
    .map((c) => {
      const parts = [`  - label: ${JSON.stringify(c.label ?? '(no label)')}`];
      const cmdLines = c.command.split('\n');
      if (cmdLines.length === 1) {
        parts.push(`    command: ${JSON.stringify(c.command)}`);
      } else {
        parts.push(`    command: |`);
        for (const line of cmdLines) parts.push(`      ${line}`);
      }
      if (c.appliesTo)
        parts.push(`    appliesTo: [${c.appliesTo.map((e) => JSON.stringify(e)).join(', ')}]`);
      if (c.osApplies)
        parts.push(`    osApplies: [${c.osApplies.map((o) => JSON.stringify(o)).join(', ')}]`);
      if (c.techApplies)
        parts.push(`    techApplies: [${c.techApplies.map((t) => JSON.stringify(t)).join(', ')}]`);
      if (c.mitreTechniques)
        parts.push(
          `    mitreTechniques: [${c.mitreTechniques.map((t) => JSON.stringify(t)).join(', ')}]`,
        );
      return parts.join('\n');
    })
    .join('\n');

  return `You are drafting candidate command snippets for an offensive-security playbook. Your output will be hand-reviewed by a security professional before being merged into the catalog — your job is to produce strong starting candidates with citable sources, NOT to write the final published version. Quality > quantity.

## Context

- Tag: ${args.tag} (${tagInfo.label})
- Phase: ${phase.slug} (${phase.name})
- Phase blurb: ${phase.blurb}
- Phase goal: ${phase.goal}
${args.engagement ? `- Engagement scope: ${args.engagement}\n` : ''}${args.os ? `- OS scope: ${args.os}\n` : ''}- Want: ${args.count} candidate commands

## Schema

Each command must match this TypeScript type:

\`\`\`ts
type CommandSnippet = {
  label?: string;             // short, scan-able (≤6 words)
  command: string;            // shell snippet, ready to paste
  appliesTo?: ('bug-bounty' | 'private' | 'lab')[];
  osApplies?: ('linux' | 'windows')[];
  techApplies?: TechTag[];    // MUST include "${args.tag}"
  mitreTechniques?: string[]; // ATT&CK technique IDs e.g. "T1078.001"
};
\`\`\`

Commands may use placeholders interpolated at render time:
- \`{target}\` — the asset under test (host/IP/URL)
- \`{version}\` — the discovered version of THIS tag's component
- \`{<token>}\` — user-set scratch values (e.g. \`{cve}\`, \`{exploit_id}\`, \`{domain}\`, \`{user}\`)

## Tone + style reference

Existing commands from the catalog for the ${phase.slug} phase — match this voice (terse, copy-ready, no chatty commentary inside the command itself):

\`\`\`yaml
${exampleYaml || '  # (no existing commands for this phase yet)'}
\`\`\`

## Output format

Output ONLY YAML matching this structure — no preamble, no commentary, no markdown code fences. Begin output immediately with \`drafts:\`.

\`\`\`yaml
drafts:
  - label: "short label"
    command: |
      single-line or multi-line shell command
    techApplies: ["${args.tag}"]
    mitreTechniques: ["T1234.001"]   # OMIT this field if no technique unambiguously applies
    source: "https://... or 'man nmap' or 'HackTricks: <topic>' etc."
    confidence: low | medium | high
    notes: "optional: prerequisites, expected output, noise level, caveats"
\`\`\`

## Hard rules

1. **Cite or omit.** Every command MUST have a \`source\` field. If you can't name the source, don't write the command. Prefer: official docs, vendor advisories, MITRE ATT&CK pages, OWASP, HackTricks, PayloadsAllTheThings, well-known tool man pages.

2. **Honest confidence.** \`high\` only when you're sure the syntax works on current versions and the technique is current best-practice. \`medium\` for "this is the canonical approach but I'd verify the flags." \`low\` for anything you're guessing about.

3. **Don't pad.** Target is ${args.count} but write fewer if you can't produce ${args.count} good ones. The user reviewing is an expert; bad candidates waste their time.

4. **MITRE: only when unambiguous.** False mappings poison the defense thread-back. If you're not certain the technique applies, omit the field.

5. **Scope precisely.** Only set \`appliesTo\` / \`osApplies\` when the command genuinely is scope-specific (e.g. a Windows-only tool, a bug-bounty-rate-limited variant). Otherwise leave the field off — the default is "applies everywhere."

6. **No destructive defaults.** This will be run by people on real targets. Default to passive / read-only / rate-limited variants. Loud variants get \`appliesTo: ["lab"]\`.

7. **Real commands, real flags.** No "imagine you would..." pseudo-code. If a tool doesn't have the flag you want, don't invent it.`;
}

/* =================================================== Provider */

/** Wrap the Anthropic call so future providers (OpenAI, Ollama,
 *  OpenRouter) can slot in behind the same interface without
 *  rewriting the prompt builder. */
async function callProvider(
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

/* =================================================== Main */

async function main() {
  loadEnvLocal();
  const args = parseArgs();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      'Missing ANTHROPIC_API_KEY.\n\n' +
        'Add it to .env.local at the repo root:\n' +
        '  echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local\n\n' +
        '(.env.local is gitignored.)',
    );
    process.exit(1);
  }

  const prompt = buildPrompt(args);
  console.log(
    `Drafting ${args.count} commands · tag=${args.tag} · phase=${args.phase} · model=${args.model}`,
  );
  if (args.engagement) console.log(`  engagement: ${args.engagement}`);
  if (args.os) console.log(`  os: ${args.os}`);
  console.log('');

  const t0 = Date.now();
  const { text, inputTokens, outputTokens } = await callProvider(
    apiKey,
    args.model,
    prompt,
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  /* Strip any code fence the model added despite instructions. */
  const cleaned = text
    .replace(/^```ya?ml\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  /* Header comment travels with the YAML — ensures the file's
     unvalidated provenance is visible from line 1. */
  const header =
    `# AI-drafted candidates · tag=${args.tag} · phase=${args.phase}\n` +
    `# Generated: ${new Date().toISOString()}\n` +
    `# Model: ${args.model}\n` +
    `# Tokens: ${inputTokens} in, ${outputTokens} out · elapsed: ${elapsed}s\n` +
    `#\n` +
    `# REVIEW BEFORE MERGING. Each command needs to be:\n` +
    `#   1. Validated on a lab box (or trusted source)\n` +
    `#   2. Confirmed via the cited source URL\n` +
    `#   3. Verified mitreTechniques mapping (if claimed)\n` +
    `#   4. Pasted into the right step in lib/methodology.ts\n` +
    `#\n` +
    `# After merging: \`npm run coverage\` to see the gauge move.\n\n`;

  if (args.dryRun) {
    console.log('--- output ---\n');
    console.log(cleaned);
  } else {
    mkdirSync(dirname(args.outPath), { recursive: true });
    writeFileSync(args.outPath, header + cleaned + '\n');
    console.log(`wrote ${args.outPath}`);

    /* Tiny preview so you don't have to open the file just to
       sanity-check the result. */
    const previewLines = cleaned.split('\n').slice(0, 12);
    console.log('\n--- preview (first 12 lines) ---');
    console.log(previewLines.join('\n'));
    if (cleaned.split('\n').length > 12) console.log('  ...');
  }

  console.log(
    `\nTokens: ${inputTokens} in, ${outputTokens} out · elapsed: ${elapsed}s`,
  );
}

main().catch((err) => {
  console.error(
    'Error:',
    err instanceof Error ? err.message : String(err),
  );
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
  process.exit(1);
});
