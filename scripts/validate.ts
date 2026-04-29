/**
 * validate — interactive triage helper for AI-drafted command
 * candidates from scripts/drafts/*.yaml.
 *
 * Walks each draft entry, prompts (k)eep / (s)kip / (q)uit, and
 * for kept entries optionally records a `validated: { on, notes }`
 * block — set ONLY if the user has actually run the command on a
 * lab box / trusted source. The default for validation is NO; you
 * type 'y' explicitly to mark a command as human-verified.
 *
 * Output: TypeScript CommandSnippet literals, formatted to match
 * the existing lib/methodology.ts style. Either printed to stdout
 * for copy-paste, or appended to a file via --append-to.
 *
 * Usage:
 *   npm run validate -- scripts/drafts/apache-vuln.yaml
 *   npm run validate -- scripts/drafts/apache-vuln.yaml --append-to scripts/drafts/_kept.ts
 *
 * The helper does NOT modify the source draft file. Re-running on
 * the same file walks every entry again — this is intentional, the
 * drafts directory is gitignored and ephemeral, so persistence
 * across runs would be misleading. Use --append-to to accumulate
 * across multiple draft files.
 *
 * Why interactive: catalog merges are intrinsically judgment calls
 * — which command to keep depends on whether you ran it, whether
 * the source is solid, whether the MITRE mapping is precise. A
 * non-interactive bulk-import would force every yes/no decision
 * up-front in the YAML, defeating the point of curation.
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parse as parseYaml } from 'yaml';

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

/* =================================================== Main */

async function main() {
  const argv = process.argv.slice(2);
  const filePath = argv[0];
  const appendIdx = argv.indexOf('--append-to');
  const appendPath = appendIdx === -1 ? null : argv[appendIdx + 1];

  if (!filePath || !existsSync(filePath)) {
    console.error(
      'Usage: npm run validate -- <draft-file.yaml> [--append-to <out.ts>]\n\n' +
        'Walks the YAML\'s `drafts:` array interactively and emits\n' +
        'TypeScript CommandSnippet literals for the entries you keep.',
    );
    process.exit(2);
  }

  const raw = readFileSync(filePath, 'utf8');
  let parsed: DraftFile;
  try {
    parsed = parseYaml(raw) as DraftFile;
  } catch (err) {
    console.error(
      `Failed to parse YAML in ${filePath}:\n  ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
  if (!parsed?.drafts || !Array.isArray(parsed.drafts)) {
    console.error(`No \`drafts:\` array found in ${filePath}`);
    process.exit(2);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const ask = (q: string) => rl.question(q);

  console.log(
    `\nReviewing ${parsed.drafts.length} draft${parsed.drafts.length === 1 ? '' : 's'} from ${filePath}\n` +
      `Validation defaults to NO — type 'y' only if you have actually run the command.`,
  );

  const kept: string[] = [];
  let skipped = 0;
  let quit = false;

  for (let i = 0; i < parsed.drafts.length; i++) {
    const d = parsed.drafts[i];
    printDraft(d, i + 1, parsed.drafts.length);

    const action = (await ask('\n[k]eep / [s]kip / [q]uit ? '))
      .trim()
      .toLowerCase();
    if (action === 'q' || action === 'quit') {
      quit = true;
      break;
    }
    if (action !== 'k' && action !== 'keep') {
      skipped++;
      continue;
    }

    /* Validation prompt — default NO, since marking validated
       requires actually running the command. User types 'y' only
       if they did. Notes optional + free-form. */
    const lab = (await ask('  lab-validated today? [y/N] '))
      .trim()
      .toLowerCase();
    const validated = lab === 'y' || lab === 'yes';
    let valNotes: string | null = null;
    if (validated) {
      const notesIn = (
        await ask('  validation notes (optional, Enter to skip): ')
      ).trim();
      valNotes = notesIn.length > 0 ? notesIn : null;
    }

    const ts = formatTypescript(d, validated, valNotes);
    kept.push(ts);

    if (appendPath) appendFileSync(appendPath, ts + '\n\n');
  }

  rl.close();

  console.log(
    `\n──── summary ────\n` +
      `  kept:    ${kept.length}${kept.filter((t) => t.includes('validated:')).length > 0 ? ` (${kept.filter((t) => t.includes('validated:')).length} validated)` : ''}\n` +
      `  skipped: ${skipped}\n` +
      `  total:   ${parsed.drafts.length}${quit ? ' (stopped early)' : ''}`,
  );

  if (kept.length > 0 && !appendPath) {
    console.log(
      '\n──── output (paste into the relevant step in lib/methodology.ts) ────\n',
    );
    for (const ts of kept) {
      console.log(ts);
      console.log();
    }
  } else if (appendPath && kept.length > 0) {
    console.log(`\n  appended ${kept.length} snippet(s) to ${appendPath}`);
  }
}

/* =================================================== Render */

function printDraft(d: DraftEntry, n: number, total: number) {
  const sep = '─'.repeat(72);
  console.log(`\n${sep}\ndraft ${n}/${total}`);
  if (d.label) console.log(`  label:      ${d.label}`);
  if (d.command) {
    const indented = d.command
      .trimEnd()
      .split('\n')
      .map((l, i) => (i === 0 ? l : `              ${l}`))
      .join('\n');
    console.log(`  command:    ${indented}`);
  }
  if (d.techApplies)
    console.log(`  techApplies: ${JSON.stringify(d.techApplies)}`);
  if (d.osApplies)
    console.log(`  osApplies:   ${JSON.stringify(d.osApplies)}`);
  if (d.appliesTo)
    console.log(`  appliesTo:   ${JSON.stringify(d.appliesTo)}`);
  if (d.mitreTechniques)
    console.log(`  mitre:      ${JSON.stringify(d.mitreTechniques)}`);
  if (d.source) console.log(`  source:     ${d.source}`);
  if (d.confidence) console.log(`  confidence: ${d.confidence}`);
  if (d.notes) console.log(`  notes:      ${d.notes}`);
}

/** Emit a CommandSnippet literal in the same style as
 *  lib/methodology.ts uses — single-quoted strings, optional
 *  fields omitted when empty, validated block included only when
 *  the user said yes during the prompt. */
function formatTypescript(
  d: DraftEntry,
  validated: boolean,
  valNotes: string | null,
): string {
  const today = new Date().toISOString().slice(0, 10);
  /* JSON.stringify produces double-quoted strings with proper
     escaping; we leave them as-is rather than trying to convert
     to single quotes (which would require re-escaping any
     embedded apostrophes). The rest of methodology.ts uses
     single quotes by convention but TypeScript accepts both. */
  const lines: string[] = ['{'];
  if (d.label) lines.push(`  label: ${JSON.stringify(d.label)},`);
  lines.push(`  command: ${JSON.stringify(d.command.trimEnd())},`);
  if (d.appliesTo) lines.push(`  appliesTo: ${JSON.stringify(d.appliesTo)},`);
  if (d.osApplies) lines.push(`  osApplies: ${JSON.stringify(d.osApplies)},`);
  if (d.techApplies)
    lines.push(`  techApplies: ${JSON.stringify(d.techApplies)},`);
  if (d.mitreTechniques)
    lines.push(`  mitreTechniques: ${JSON.stringify(d.mitreTechniques)},`);
  if (validated) {
    const notesPart = valNotes ? `, notes: ${JSON.stringify(valNotes)}` : '';
    lines.push(`  validated: { on: '${today}'${notesPart} },`);
  }
  lines.push('},');
  return lines.join('\n');
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
