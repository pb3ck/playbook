/**
 * On-demand AI assistance — takes the user's situation (free-text
 * description plus their selected engagement / OS / tags / target)
 * and returns generated guidance for situations the curated catalog
 * doesn't cover.
 *
 * Privacy + minimalism stance:
 *
 *   - Default recommended provider is Ollama (local) — data + inference
 *     stay on the user's device. Anthropic / OpenAI / openai-compatible
 *     are alts behind the same BYOK profile system.
 *   - We feed the model the LOCAL MITRE ATT&CK vocabulary (from
 *     `data/mitre-techniques.json` via `lib/mitre.ts`) so it picks from
 *     real technique ids instead of inventing them.
 *   - We feed it the catalog's existing tool inventory so it suggests
 *     tools we already know about (no fabricated tool names).
 *   - Output is structured JSON parsed into a `GeneratedAssistance`
 *     shape — never auto-merged into `lib/methodology.ts`. The
 *     curated catalog is the source of truth; generated content is
 *     per-session, marked, and bounded.
 *
 * Generated content is explicitly NOT validated. The caller is
 * responsible for surfacing the disclosure in the UI; this module
 * just produces the structured payload + provenance metadata.
 */

import type { ByokProfile, FetchResult } from './byok';
import { allTechniques, type MitreTechnique } from '@/lib/mitre';
import { PHASES } from '@/lib/methodology';
import { TECH_TAG_GROUPS } from '@/lib/tech-tags';

/* =================================================== Types */

export type GenerateContext = {
  /** What the user has set in the playbook frame. Empty / null
   *  fields are normal — the generator uses what it has. */
  engagement: string | null;
  targetOS: string | null;
  techTags: string[];
  target: string;
  /** Free-text description of the situation the user wants help
   *  with. The orchestrator passes this verbatim to the model. */
  prompt: string;
};

export type GeneratedCommand = {
  label: string;
  command: string;
  techApplies?: string[];
  osApplies?: ('linux' | 'windows')[];
  appliesTo?: ('bug-bounty' | 'private' | 'lab')[];
  /** Subset of the local MITRE vocabulary — the model is asked to
   *  pick only from ids we have in `data/mitre-techniques.json`. */
  mitreTechniques?: string[];
  source?: string;
  caveats?: string;
};

export type GeneratedAssistance = {
  /** Stable id for this generation — used as the localStorage
   *  key + the "regenerate replaces this one" anchor. */
  id: string;
  generatedAt: string;
  context: GenerateContext;
  provider: { name: string; kind: string; model?: string };
  /** The model\'s structured response. */
  result: {
    title: string;
    summary: string;
    commands: GeneratedCommand[];
    /** Anything the model wants to flag — prerequisites,
     *  known gotchas, when to NOT use this guidance. */
    cautions?: string[];
  };
  /** True when the model returned at least one command. False on
   *  parse failure or empty response — UI should surface the
   *  raw error if rawError is set. */
  ok: boolean;
  rawError?: string;
  /** Token + latency telemetry for the user\'s reference (cost
   *  awareness for paid providers). */
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs: number;
  /** Indices into `result.commands` that the user has marked as
   *  "I ran this." Drives the Map\'s amber-tinted attribution
   *  for AI-generated content — only ticked-ran generated commands
   *  flow into the auto-derived attack graph, mirroring the
   *  catalog\'s per-command "ran" model. Cleared on regenerate
   *  (the commands themselves change so historical ticks are
   *  meaningless). */
  ranIndices?: number[];
};

/* =================================================== Prompt builder */

/** Build the system prompt that anchors the model in our catalog\'s
 *  vocabulary. We give it: the schema, the local MITRE technique
 *  list (closed vocabulary), the existing tool inventory (so it
 *  suggests tools we know about), and the situation context. */
function buildSystemPrompt(
  context: GenerateContext,
  vocabulary: MitreTechnique[],
): string {
  /* MITRE vocab — flatten to "T1234.001 — Name (tactic)" lines so
     the model sees ids paired with names + tactics in one place.
     Capped to the bundle size; for our 47-entry baseline this is
     ~50 lines. */
  const mitreLines = vocabulary
    .map((t) => `  ${t.id} — ${t.name} (${t.tactics.join(', ')})`)
    .join('\n');

  /* Tool inventory — pulled from the catalog so we can ask the
     model to "prefer these tools." Deduped by name. Bounded to
     keep the prompt size sane. */
  const toolNames = new Set<string>();
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      for (const tool of step.tools ?? []) {
        toolNames.add(tool.name);
      }
    }
  }
  const toolList = [...toolNames].slice(0, 60).join(', ');

  /* Tag list for the user\'s reference inside the prompt. */
  const tagList = TECH_TAG_GROUPS.flatMap((g) =>
    g.tags.map((t) => t.id as string),
  ).join(', ');

  return `You generate offensive-security guidance for a structured pentest playbook. Your output will be SHOWN TO THE USER AS-IS, clearly labeled as AI-generated. The user's curated catalog has gaps; you fill them on demand.

## Hard rules

1. **Output JSON only.** Match the exact schema below. No prose outside the JSON. No markdown code fences. Begin output with \`{\`.

2. **MITRE ids must come from the closed vocabulary below.** Do not invent ids. If no listed id fits a command, OMIT \`mitreTechniques\` for that command. False mappings poison the defense thread-back.

3. **Cite real sources.** Every command needs a \`source\` string — official docs, MITRE ATT&CK pages, OWASP, HackTricks, vendor advisories, well-known tool man pages. If you can\'t cite a source, omit the command.

4. **Prefer real flags.** No invented syntax. If a tool doesn\'t do what you need, don\'t fake it.

5. **Default to passive / read-only.** Loud or destructive commands MUST get \`appliesTo: ["lab"]\`. The user is on a real engagement most of the time.

6. **Use placeholders.** \`{target}\`, \`{version}\`, and any custom token like \`{cve}\`, \`{user}\`, \`{password}\` are interpolated at render time. Don\'t hardcode example values.

## Output schema

\`\`\`json
{
  "title": "short label for this generation (≤8 words)",
  "summary": "1-2 sentences explaining the situation + what these commands do",
  "commands": [
    {
      "label": "short command label",
      "command": "shell snippet, ready to paste",
      "techApplies": ["from the tag list below, or omit"],
      "osApplies": ["linux", "windows"],
      "appliesTo": ["bug-bounty", "private", "lab"],
      "mitreTechniques": ["T1234.001"],
      "source": "URL or docs reference",
      "caveats": "optional gotchas / prerequisites"
    }
  ],
  "cautions": ["optional list of "do not do this" warnings, scope reminders, etc."]
}
\`\`\`

## Closed MITRE vocabulary (use only these ids)

${mitreLines}

## Catalog tool names (prefer these where applicable)

${toolList}

## Tech-tag vocabulary (use only these in techApplies)

${tagList}

## User context

- Engagement: ${context.engagement ?? '(not set)'}
- Target OS: ${context.targetOS ?? '(not set)'}
- Selected tech tags: ${context.techTags.length === 0 ? '(none)' : context.techTags.join(', ')}
- Target: ${context.target || '(not set)'}

## Situation the user is asking about

${context.prompt}

Begin your JSON output now.`;
}

/* =================================================== Provider adapters */

/** Common shape for raw model calls. Each adapter normalizes
 *  whatever its provider returns into this shape so the
 *  orchestrator can parse uniformly. `truncated` flag tells the
 *  parser to surface a clearer error when JSON is incomplete
 *  (output token limit hit mid-emission rather than a real
 *  parse bug). */
type ModelResponse = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /** True when the provider says the response was cut off due to
   *  hitting max_tokens. Anthropic: stop_reason==='max_tokens';
   *  OpenAI: finish_reason==='length'; Ollama: done_reason!=='stop'. */
  truncated?: boolean;
};

/** Output token cap. Bumped from the original 4096 after a
 *  user hit "Unterminated string in JSON" on a mega-prompt that
 *  asked for content across 3 phases × 4 tags — JSON is verbose
 *  and 4096 wasn\'t enough headroom. 8192 is the universal max
 *  for current Sonnet / GPT-4o, plenty for any single-prompt
 *  generation we expect. Ollama: model-dependent but most
 *  modern weights handle 8192 fine. */
const MAX_OUTPUT_TOKENS = 8192;

async function callAnthropic(
  profile: ByokProfile,
  systemPrompt: string,
): Promise<ModelResponse> {
  if (!profile.apiKey) throw new Error('Anthropic profile missing apiKey');
  const model = profile.model || 'claude-sonnet-4-5';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': profile.apiKey,
      'anthropic-version': '2023-06-01',
      /* CORS pre-flight skip header — Anthropic requires this for
         direct browser calls so it knows the request is intentional
         from a browser context and not an accidental CSRF. */
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: systemPrompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    stop_reason?: string;
    content: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = json.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  return {
    text,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
    truncated: json.stop_reason === 'max_tokens',
  };
}

async function callOpenai(
  profile: ByokProfile,
  systemPrompt: string,
  endpoint = 'https://api.openai.com/v1/chat/completions',
): Promise<ModelResponse> {
  if (!profile.apiKey) throw new Error('OpenAI profile missing apiKey');
  const model = profile.model || 'gpt-4o';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${profile.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: systemPrompt }],
      max_tokens: MAX_OUTPUT_TOKENS,
      /* Force JSON output mode where supported (OpenAI + most
         openai-compatible servers honor this). Falls back to
         best-effort parsing if the server ignores it. */
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices: { message: { content: string }; finish_reason?: string }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    text: json.choices[0]?.message?.content ?? '',
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
    truncated: json.choices[0]?.finish_reason === 'length',
  };
}

async function callOllama(
  profile: ByokProfile,
  systemPrompt: string,
): Promise<ModelResponse> {
  const baseUrl = profile.baseUrl || 'http://localhost:11434';
  const model = profile.model || 'whiterabbitneo';
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: systemPrompt,
      stream: false,
      format: 'json' /* Ollama supports JSON-mode output. */,
      options: { num_predict: MAX_OUTPUT_TOKENS },
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    response: string;
    prompt_eval_count?: number;
    eval_count?: number;
    done_reason?: string;
  };
  return {
    text: json.response,
    inputTokens: json.prompt_eval_count,
    outputTokens: json.eval_count,
    /* Ollama emits done_reason: "length" when num_predict was hit
       before the model stopped naturally. Other reasons (stop, eof,
       limit) all indicate non-truncated output. */
    truncated: json.done_reason === 'length',
  };
}

async function callOpenaiCompatible(
  profile: ByokProfile,
  systemPrompt: string,
): Promise<ModelResponse> {
  const baseUrl = profile.baseUrl;
  if (!baseUrl) throw new Error('openai-compatible profile missing baseUrl');
  /* Append /chat/completions if the user gave the base /v1 root.
     Tolerate either form. */
  const endpoint = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  return callOpenai(profile, systemPrompt, endpoint);
}

/* =================================================== Orchestrator */

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Top-level entry — call from the UI. Builds the system prompt,
 *  dispatches to the right provider, parses the JSON response,
 *  packages the result with provenance metadata. Always returns a
 *  GeneratedAssistance object even on failure (with `ok: false`
 *  and `rawError` set) so the caller can render an error state
 *  uniformly. */
export async function generateAssistance(
  profile: ByokProfile,
  context: GenerateContext,
): Promise<GeneratedAssistance> {
  const t0 = Date.now();
  const vocab = allTechniques();
  const systemPrompt = buildSystemPrompt(context, vocab);

  const id = generateId();
  const baseProvenance = {
    id,
    generatedAt: new Date().toISOString(),
    context,
    provider: {
      name: profile.name,
      kind: profile.kind,
      model: profile.model,
    },
  };

  let response: ModelResponse;
  try {
    switch (profile.kind) {
      case 'anthropic':
        response = await callAnthropic(profile, systemPrompt);
        break;
      case 'openai':
        response = await callOpenai(profile, systemPrompt);
        break;
      case 'ollama':
        response = await callOllama(profile, systemPrompt);
        break;
      case 'openai-compatible':
        response = await callOpenaiCompatible(profile, systemPrompt);
        break;
      default:
        throw new Error(
          `Profile kind '${profile.kind}' is not an AI provider`,
        );
    }
  } catch (err) {
    return {
      ...baseProvenance,
      result: { title: '', summary: '', commands: [] },
      ok: false,
      rawError: err instanceof Error ? err.message : String(err),
      elapsedMs: Date.now() - t0,
    };
  }

  /* Strip any code fence the model added despite instructions. */
  const cleaned = response.text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  let parsed: {
    title?: string;
    summary?: string;
    commands?: GeneratedCommand[];
    cautions?: string[];
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    /* Truncation case — provider said the response hit max_tokens
       AND we got partial JSON. Give the user actionable advice
       (split the prompt) instead of the raw "Unterminated string"
       parser error which doesn\'t hint at the cause. */
    const baseMsg = err instanceof Error ? err.message : String(err);
    const truncationHint = response.truncated
      ? `Model output was truncated at ${response.outputTokens ?? '?'} tokens (provider's max_tokens cap). Try splitting the prompt into smaller pieces (e.g. one per phase) — each generation gets its own token budget.`
      : `The model returned partial JSON. Try regenerating; if it persists, the prompt may be asking for too much in one shot.`;
    return {
      ...baseProvenance,
      result: { title: '', summary: '', commands: [] },
      ok: false,
      rawError: `${truncationHint}\n\nParser error: ${baseMsg}\nFirst 200 chars: ${cleaned.slice(0, 200)}`,
      elapsedMs: Date.now() - t0,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };
  }

  /* Defensive normalization — model may omit fields, return
     wrong types, etc. We pull what we can and fail soft. */
  const commands = Array.isArray(parsed.commands) ? parsed.commands : [];
  const validCommands = commands.filter(
    (c) => c && typeof c === 'object' && typeof c.command === 'string',
  );

  /* Filter mitreTechniques per command to only ids that exist in
     our local vocabulary — this is the second line of defense
     against hallucinated technique ids (the first being the
     prompt rule). */
  const validIds = new Set(vocab.map((t) => t.id));
  const cleanedCommands: GeneratedCommand[] = validCommands.map((c) => ({
    ...c,
    label: typeof c.label === 'string' ? c.label : '',
    command: c.command,
    mitreTechniques: Array.isArray(c.mitreTechniques)
      ? c.mitreTechniques
          .map((id) => (typeof id === 'string' ? id.toUpperCase() : ''))
          .filter((id) => validIds.has(id))
      : undefined,
  }));

  return {
    ...baseProvenance,
    result: {
      title: typeof parsed.title === 'string' ? parsed.title : 'Generated guidance',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      commands: cleanedCommands,
      cautions: Array.isArray(parsed.cautions)
        ? parsed.cautions.filter((c): c is string => typeof c === 'string')
        : undefined,
    },
    ok: cleanedCommands.length > 0,
    rawError:
      cleanedCommands.length === 0
        ? 'Model returned no parseable commands.'
        : undefined,
    elapsedMs: Date.now() - t0,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}

/** Storage hygiene — cap the number of generations we keep so
 *  localStorage doesn\'t grow unbounded. Newest first; older
 *  ones drop off the end. */
export const MAX_GENERATIONS = 20;

export function trimGenerations(
  list: GeneratedAssistance[],
): GeneratedAssistance[] {
  if (list.length <= MAX_GENERATIONS) return list;
  return list.slice(0, MAX_GENERATIONS);
}

/** Validate a parsed-JSON blob into a GeneratedAssistance[]. Used
 *  by the persistence loader; tolerant of partial / older shapes
 *  the same way normalizeByokProfiles is. */
export function normalizeGenerations(raw: unknown): GeneratedAssistance[] {
  if (!Array.isArray(raw)) return [];
  const out: GeneratedAssistance[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const g = v as Record<string, unknown>;
    if (typeof g.id !== 'string' || typeof g.generatedAt !== 'string') continue;
    if (!g.result || typeof g.result !== 'object') continue;
    const result = g.result as Record<string, unknown>;
    if (!Array.isArray(result.commands)) continue;
    /* ranIndices is optional + must be a list of finite ints
       within the commands range. Defensively coerce; an older
       snapshot without the field stays unticked. */
    const obj = g as unknown as GeneratedAssistance;
    if (Array.isArray(obj.ranIndices)) {
      obj.ranIndices = obj.ranIndices.filter(
        (i) =>
          typeof i === 'number' &&
          Number.isFinite(i) &&
          i >= 0 &&
          i < (result.commands as unknown[]).length,
      );
    }
    out.push(obj);
  }
  return trimGenerations(out);
}
