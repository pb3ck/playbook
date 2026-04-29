/**
 * Bring-Your-Own-Key (BYOK) — client-side only integration with CVE /
 * threat-intel APIs (NVD, OSV, EPSS, VulnCheck, plus a `custom`
 * profile for company-internal endpoints).
 *
 * Privacy stance — explicit and persistent: keys live in
 * `localStorage` on the user\'s device. This app has no backend
 * (static export), so there\'s nothing on the server side to
 * forward, log, or store keys. All requests go directly from
 * the browser to the configured endpoint.
 *
 * Architecture:
 *   - `ByokProfile`: user-configured connection (id + name + kind +
 *     creds). Multiple profiles allowed; "enabled" toggle gates
 *     whether `enrichCve` consults that profile.
 *   - Provider adapters (one per kind): pure async functions that
 *     hit the API and normalize the response into `CveDetails`.
 *   - `enrichCve(profiles, cveId)`: fan-out across enabled
 *     profiles, return all results so the popover can merge fields
 *     from multiple sources (NVD for CVSS, EPSS for exploit
 *     probability, OSV for affected versions, etc.).
 *
 * CORS reality: NVD 2.0, OSV, EPSS support browser CORS and work
 * directly. VulnCheck and most enterprise endpoints don\'t — those
 * users point a `custom` profile at their own Cloudflare Worker /
 * proxy. The /api docs document this.
 */

/* =================================================== Types */

/** Provider kind. The orchestrator dispatches to the matching
 *  adapter based on this discriminator. Two families share the
 *  same profile shape:
 *
 *    CVE-enrichment kinds — feed the BYOK CVE popover:
 *      'nvd-2.0' | 'epss' | 'osv' | 'vulncheck' | 'custom'
 *
 *    AI-generation kinds — feed the on-demand assistance flow
 *    (lib/playbook/ai-generate.ts), surfaced as the "describe
 *    your situation" input. Recommended path is Ollama (local;
 *    no data leaves the device, no content-policy gates).
 *      'anthropic' | 'openai' | 'ollama' | 'openai-compatible'
 *
 *  Storing both families in one profile array keeps the settings
 *  drawer + persistence simple; helpers like `profileCategory`
 *  group them visually + functionally. */
export type ByokKind =
  | 'nvd-2.0'
  | 'epss'
  | 'osv'
  | 'vulncheck'
  | 'custom'
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'openai-compatible';

/** A single user-configured BYOK profile. Persisted as part of an
 *  array under `STORAGE_KEYS.byokProfiles`. */
export type ByokProfile = {
  /** Random UUID, generated at create time. Stable across renames. */
  id: string;
  /** Human label shown in the settings UI ("Production NVD",
   *  "Internal CVEDB", "Local Ollama"). Free-form. */
  name: string;
  kind: ByokKind;
  /** API key / token. Optional for kinds that don\'t require auth
   *  (epss, osv, ollama) — kept in the type so the form is uniform. */
  apiKey?: string;
  /** For kinds that take a custom endpoint:
   *    - 'custom' (CVE): URL template with `{id}` placeholder
   *    - 'ollama': base URL of the local Ollama server (default
   *      `http://localhost:11434`)
   *    - 'openai-compatible': any OpenAI chat-API-shaped endpoint
   *      (vLLM, LiteLLM, LM Studio, OpenRouter, etc.) */
  baseUrl?: string;
  /** Custom-CVE-only: HTTP header name for the auth value. Default
   *  `Authorization`. Ignored for AI kinds. */
  headerName?: string;
  /** AI-kinds-only: model id to request. Examples:
   *    - anthropic: 'claude-sonnet-4-5'
   *    - openai: 'gpt-4o'
   *    - ollama: 'llama3.1:70b' / 'whiterabbitneo' / etc.
   *    - openai-compatible: whatever the proxy exposes
   *  CVE kinds ignore this. */
  model?: string;
  /** User toggle — false hides the profile from orchestrator
   *  fan-out (CVE: enrichCve; AI: generateAssistance) without
   *  deleting it. */
  enabled: boolean;
};

/** Normalized CVE details from any provider. Unknown fields are
 *  left undefined; the popover renders only the populated bits. */
export type CveDetails = {
  id: string;
  /** Provider label for the source ("NVD 2.0", "OSV", custom name). */
  source: string;
  summary?: string;
  cvssV3?: {
    score: number;
    severity: string;
    vector?: string;
  };
  /** First EPSS score + percentile if the provider supplies it. */
  epss?: {
    score: number;
    percentile: number;
  };
  references?: { url: string; tags?: string[] }[];
  publishedDate?: string;
  lastModifiedDate?: string;
};

export type FetchResult<T> =
  | { ok: true; data: T; cachedAt: number }
  | { ok: false; error: string; status?: number };

/* =================================================== Validation */

const VALID_KINDS: ReadonlySet<ByokKind> = new Set([
  'nvd-2.0',
  'epss',
  'osv',
  'vulncheck',
  'custom',
  'anthropic',
  'openai',
  'ollama',
  'openai-compatible',
]);

/** Two profile families share storage but split in the UI + at
 *  orchestrator dispatch. */
export type ByokCategory = 'cve' | 'ai';

const AI_KINDS: ReadonlySet<ByokKind> = new Set<ByokKind>([
  'anthropic',
  'openai',
  'ollama',
  'openai-compatible',
]);

export function profileCategory(profile: ByokProfile): ByokCategory {
  return AI_KINDS.has(profile.kind) ? 'ai' : 'cve';
}

export function isAiKind(kind: ByokKind): boolean {
  return AI_KINDS.has(kind);
}

/** Salvage a parsed JSON blob into a list of profiles, dropping
 *  anything that doesn\'t look like a profile. Tolerant by design
 *  — older shapes still load. */
export function normalizeByokProfiles(raw: unknown): ByokProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: ByokProfile[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const p = v as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.name !== 'string') continue;
    if (typeof p.kind !== 'string' || !VALID_KINDS.has(p.kind as ByokKind))
      continue;
    out.push({
      id: p.id,
      name: p.name,
      kind: p.kind as ByokKind,
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : undefined,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : undefined,
      headerName: typeof p.headerName === 'string' ? p.headerName : undefined,
      model: typeof p.model === 'string' ? p.model : undefined,
      enabled: p.enabled !== false /* default true */,
    });
  }
  return out;
}

/** Generate a profile id. Uses `crypto.randomUUID()` when
 *  available; falls back to a timestamp+random for old browsers. */
export function generateProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `byok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A non-creds-bearing seed for a new profile of the given kind.
 *  Used by the settings UI when "+ Add" is clicked. */
export function newProfileSeed(kind: ByokKind): ByokProfile {
  const defaults: Record<ByokKind, Partial<ByokProfile>> = {
    'nvd-2.0': { name: 'NVD 2.0' },
    epss: { name: 'EPSS' },
    osv: { name: 'OSV' },
    vulncheck: { name: 'VulnCheck' },
    custom: {
      name: 'Custom',
      baseUrl: 'https://example.com/cve/{id}',
      headerName: 'Authorization',
    },
    /* AI provider seeds. Ollama defaults to local — the
       recommended path for the on-demand AI feature since data
       + inference stay on the user\'s device. WhiteRabbitNeo is
       a Llama-based open-weight model fine-tuned for offensive
       security; users on Ollama can `ollama pull whiterabbitneo`
       and they\'re ready. The other AI kinds default to current
       flagship-tier model ids; users override per-profile. */
    anthropic: { name: 'Anthropic', model: 'claude-sonnet-4-5' },
    openai: { name: 'OpenAI', model: 'gpt-4o' },
    ollama: {
      name: 'Ollama (local)',
      baseUrl: 'http://localhost:11434',
      model: 'whiterabbitneo',
    },
    'openai-compatible': {
      name: 'OpenAI-compatible',
      baseUrl: 'https://example.com/v1',
      model: 'model-id',
    },
  };
  return {
    id: generateProfileId(),
    kind,
    enabled: true,
    name: 'New profile',
    ...defaults[kind],
  } as ByokProfile;
}

/** Display-friendly label for a kind. */
export function kindLabel(kind: ByokKind): string {
  switch (kind) {
    case 'nvd-2.0':
      return 'NVD 2.0';
    case 'epss':
      return 'EPSS';
    case 'osv':
      return 'OSV.dev';
    case 'vulncheck':
      return 'VulnCheck';
    case 'custom':
      return 'Custom';
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'ollama':
      return 'Ollama (local)';
    case 'openai-compatible':
      return 'OpenAI-compatible';
  }
}

/** Whether this provider kind needs an API key to function. UI
 *  uses this to hide the key field for kinds that don\'t. Ollama
 *  is local — no key. NVD takes an optional key (raises rate
 *  limit). The rest require one. */
export function kindNeedsKey(kind: ByokKind): boolean {
  return (
    kind === 'nvd-2.0' /* optional but useful for rate-limit */ ||
    kind === 'vulncheck' ||
    kind === 'custom' ||
    kind === 'anthropic' ||
    kind === 'openai' ||
    kind === 'openai-compatible'
  );
}

/** Whether the kind\'s endpoint supports browser CORS. The settings
 *  UI surfaces a hint when CORS is known to be blocked so users
 *  understand why a request might fail. Ollama is local-CORS
 *  friendly with `OLLAMA_ORIGINS=*` set; document this in the
 *  drawer. */
export function kindSupportsBrowserCors(kind: ByokKind): boolean {
  return (
    kind === 'nvd-2.0' ||
    kind === 'epss' ||
    kind === 'osv' ||
    kind === 'anthropic' ||
    kind === 'openai' ||
    kind === 'ollama'
  );
}

/** Content-policy posture for the kind, surfaced in the settings
 *  drawer for AI providers so users aren\'t surprised when a
 *  pentest prompt gets refused. Free-form strings — UI just
 *  renders them. */
export function kindPolicyNote(kind: ByokKind): string | null {
  switch (kind) {
    case 'anthropic':
      return 'Pentest content requires Anthropic security research enrollment; otherwise prompts get refused.';
    case 'openai':
      return 'Content policy refuses many offensive-security prompts; results vary by phrasing + model.';
    case 'ollama':
      return 'No vendor policy — you control the model. WhiteRabbitNeo is a Llama fine-tune built for this use case.';
    case 'openai-compatible':
      return 'Policy depends on the backing provider/model — refer to whoever runs the endpoint.';
    default:
      return null;
  }
}

/* =================================================== Fetch helper */

/** Wrap `fetch` with an 8-second timeout + JSON parse + uniform
 *  error shape. Adapters reuse this so each one is just URL +
 *  headers + a normalize step. */
async function getJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
        status: res.status,
      };
    }
    const json = (await res.json()) as T;
    return { ok: true, data: json, cachedAt: Date.now() };
  } catch (err) {
    const msg =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'Request timed out after 8s'
        : err instanceof Error
          ? err.message
          : 'Unknown fetch error';
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/* =================================================== Adapters */

const CVE_ID = /^CVE-\d{4}-\d{4,7}$/i;

function assertCveId(id: string): string | null {
  return CVE_ID.test(id) ? id.toUpperCase() : null;
}

/* --- NVD 2.0 ---------------------------------------------------- */

type NvdCveItem = {
  cve: {
    id: string;
    descriptions?: { lang: string; value: string }[];
    metrics?: {
      cvssMetricV31?: {
        cvssData: {
          baseScore: number;
          baseSeverity: string;
          vectorString?: string;
        };
      }[];
      cvssMetricV30?: {
        cvssData: {
          baseScore: number;
          baseSeverity: string;
          vectorString?: string;
        };
      }[];
    };
    references?: { url: string; tags?: string[] }[];
    published?: string;
    lastModified?: string;
  };
};

async function fetchFromNvd(
  profile: ByokProfile,
  cveId: string,
): Promise<FetchResult<CveDetails>> {
  const id = assertCveId(cveId);
  if (!id) return { ok: false, error: 'Not a CVE id' };
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${id}`;
  const headers: Record<string, string> = {};
  if (profile.apiKey) headers.apiKey = profile.apiKey;
  const res = await getJson<{ vulnerabilities: NvdCveItem[] }>(url, {
    headers,
  });
  if (!res.ok) return res;
  const item = res.data.vulnerabilities?.[0]?.cve;
  if (!item) {
    return { ok: false, error: 'NVD returned no entry for this CVE' };
  }
  const desc = (item.descriptions ?? []).find((d) => d.lang === 'en')?.value;
  const metric =
    item.metrics?.cvssMetricV31?.[0]?.cvssData ??
    item.metrics?.cvssMetricV30?.[0]?.cvssData;
  return {
    ok: true,
    cachedAt: Date.now(),
    data: {
      id,
      source: profile.name,
      summary: desc,
      cvssV3: metric
        ? {
            score: metric.baseScore,
            severity: metric.baseSeverity,
            vector: metric.vectorString,
          }
        : undefined,
      references: item.references?.map((r) => ({ url: r.url, tags: r.tags })),
      publishedDate: item.published,
      lastModifiedDate: item.lastModified,
    },
  };
}

/* --- EPSS ------------------------------------------------------- */

type EpssRow = {
  cve: string;
  epss: string; // string-encoded float
  percentile: string;
  date: string;
};

async function fetchFromEpss(
  profile: ByokProfile,
  cveId: string,
): Promise<FetchResult<CveDetails>> {
  const id = assertCveId(cveId);
  if (!id) return { ok: false, error: 'Not a CVE id' };
  const url = `https://api.first.org/data/v1/epss?cve=${id}`;
  const res = await getJson<{ data: EpssRow[] }>(url);
  if (!res.ok) return res;
  const row = res.data.data?.[0];
  if (!row) {
    return { ok: false, error: 'EPSS returned no entry for this CVE' };
  }
  return {
    ok: true,
    cachedAt: Date.now(),
    data: {
      id,
      source: profile.name,
      epss: {
        score: parseFloat(row.epss),
        percentile: parseFloat(row.percentile),
      },
      lastModifiedDate: row.date,
    },
  };
}

/* --- OSV -------------------------------------------------------- */

type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  severity?: { type: string; score: string }[];
  references?: { type?: string; url: string }[];
  published?: string;
  modified?: string;
};

async function fetchFromOsv(
  profile: ByokProfile,
  cveId: string,
): Promise<FetchResult<CveDetails>> {
  const id = assertCveId(cveId);
  if (!id) return { ok: false, error: 'Not a CVE id' };
  const url = `https://api.osv.dev/v1/vulns/${id}`;
  const res = await getJson<OsvVuln>(url);
  if (!res.ok) return res;
  /* OSV severity is a CVSS vector string under `score`. We surface
     it as cvssV3 if a CVSS_V3 entry exists. Score parsing from
     vector is non-trivial; we leave the score number undefined and
     just attach the vector for display. */
  const cvssRow = res.data.severity?.find((s) =>
    /CVSS_V3/i.test(s.type),
  );
  return {
    ok: true,
    cachedAt: Date.now(),
    data: {
      id,
      source: profile.name,
      summary: res.data.summary ?? res.data.details,
      cvssV3: cvssRow
        ? {
            score: 0,
            severity: 'see vector',
            vector: cvssRow.score,
          }
        : undefined,
      references: res.data.references?.map((r) => ({
        url: r.url,
        tags: r.type ? [r.type] : undefined,
      })),
      publishedDate: res.data.published,
      lastModifiedDate: res.data.modified,
    },
  };
}

/* --- VulnCheck -------------------------------------------------- */

async function fetchFromVulncheck(
  profile: ByokProfile,
  cveId: string,
): Promise<FetchResult<CveDetails>> {
  const id = assertCveId(cveId);
  if (!id) return { ok: false, error: 'Not a CVE id' };
  if (!profile.apiKey) {
    return { ok: false, error: 'VulnCheck requires an API key' };
  }
  const url = `https://api.vulncheck.com/v3/index/nvd2?cve=${id}`;
  const res = await getJson<{ data: NvdCveItem[] }>(url, {
    headers: { Authorization: `Bearer ${profile.apiKey}` },
  });
  if (!res.ok) return res;
  const item = res.data.data?.[0]?.cve;
  if (!item) {
    return { ok: false, error: 'VulnCheck returned no entry for this CVE' };
  }
  const desc = (item.descriptions ?? []).find((d) => d.lang === 'en')?.value;
  const metric =
    item.metrics?.cvssMetricV31?.[0]?.cvssData ??
    item.metrics?.cvssMetricV30?.[0]?.cvssData;
  return {
    ok: true,
    cachedAt: Date.now(),
    data: {
      id,
      source: profile.name,
      summary: desc,
      cvssV3: metric
        ? {
            score: metric.baseScore,
            severity: metric.baseSeverity,
            vector: metric.vectorString,
          }
        : undefined,
      references: item.references?.map((r) => ({ url: r.url, tags: r.tags })),
      publishedDate: item.published,
      lastModifiedDate: item.lastModified,
    },
  };
}

/* --- Custom ----------------------------------------------------- */

/** Custom adapter: substitutes `{id}` in `baseUrl`, sends the API
 *  key under `headerName` (default `Authorization`), and tries to
 *  pluck common fields from the response. We make NO assumptions
 *  about the schema — anything we can\'t identify is left empty
 *  and the response\'s own URL is offered as the only reference. */
async function fetchFromCustom(
  profile: ByokProfile,
  cveId: string,
): Promise<FetchResult<CveDetails>> {
  const id = assertCveId(cveId);
  if (!id) return { ok: false, error: 'Not a CVE id' };
  if (!profile.baseUrl) {
    return { ok: false, error: 'Custom profile is missing a baseUrl' };
  }
  const url = profile.baseUrl.replace(/\{id\}/gi, id);
  const headers: Record<string, string> = {};
  if (profile.apiKey) {
    const headerName = profile.headerName?.trim() || 'Authorization';
    headers[headerName] = profile.apiKey;
  }
  const res = await getJson<unknown>(url, { headers });
  if (!res.ok) return res;
  const data = res.data as Record<string, unknown>;
  const summary =
    typeof data?.summary === 'string'
      ? data.summary
      : typeof data?.description === 'string'
        ? data.description
        : typeof data?.details === 'string'
          ? (data.details as string)
          : undefined;
  /* Try to pluck CVSS from common shapes — `cvss`, `cvssV3`,
     `metrics.cvssMetricV31[0].cvssData`. Each pluck is isolated so
     a missing one doesn\'t blow up the whole response. */
  let cvssV3: CveDetails['cvssV3'];
  const cvssRoot =
    (data?.cvssV3 as Record<string, unknown> | undefined) ??
    (data?.cvss as Record<string, unknown> | undefined);
  if (cvssRoot && typeof cvssRoot.score === 'number') {
    cvssV3 = {
      score: cvssRoot.score,
      severity:
        typeof cvssRoot.severity === 'string'
          ? cvssRoot.severity
          : 'unknown',
      vector:
        typeof cvssRoot.vector === 'string'
          ? cvssRoot.vector
          : typeof cvssRoot.vectorString === 'string'
            ? (cvssRoot.vectorString as string)
            : undefined,
    };
  }
  let references: CveDetails['references'];
  if (Array.isArray(data?.references)) {
    references = (data.references as unknown[])
      .map((r) => {
        if (typeof r === 'string') return { url: r };
        if (r && typeof r === 'object' && typeof (r as Record<string, unknown>).url === 'string') {
          return { url: (r as Record<string, string>).url };
        }
        return null;
      })
      .filter((r): r is { url: string } => r !== null);
  }
  return {
    ok: true,
    cachedAt: Date.now(),
    data: {
      id,
      source: profile.name,
      summary,
      cvssV3,
      references,
      publishedDate:
        typeof data?.publishedDate === 'string'
          ? (data.publishedDate as string)
          : typeof data?.published === 'string'
            ? (data.published as string)
            : undefined,
      lastModifiedDate:
        typeof data?.lastModifiedDate === 'string'
          ? (data.lastModifiedDate as string)
          : typeof data?.modified === 'string'
            ? (data.modified as string)
            : undefined,
    },
  };
}

/* =================================================== Orchestrator */

/** Look up a CVE across every enabled profile in parallel. The
 *  popover renders all results — typically NVD gives summary +
 *  CVSS, EPSS gives exploit probability, OSV gives affected
 *  versions, custom gives whatever the company internal database
 *  carries. Order is preserved to match the profiles array.
 *
 *  Each profile gets a separate result — the popover decides how
 *  to merge / display them. This keeps the failure surface
 *  per-profile (one provider down doesn\'t hide the rest). */
export async function enrichCve(
  profiles: ByokProfile[],
  cveId: string,
): Promise<{ profile: ByokProfile; result: FetchResult<CveDetails> }[]> {
  /* Only fan out to CVE-category profiles. AI profiles share the
     same storage but power a different feature (on-demand
     generation); skipping them here keeps the popover free of
     spurious errors when the user has both kinds enabled. */
  const enabled = profiles.filter(
    (p) => p.enabled && profileCategory(p) === 'cve',
  );
  return Promise.all(
    enabled.map(async (profile) => ({
      profile,
      result: await dispatch(profile, cveId),
    })),
  );
}

/** Dispatch a single (profile, cve) pair to the right adapter.
 *  AI-category profiles aren\'t CVE-callable; if one slips through
 *  the caller filtering we return a uniform error result rather
 *  than throwing, so the popover renders a recognizable message. */
function dispatch(
  profile: ByokProfile,
  cveId: string,
): Promise<FetchResult<CveDetails>> {
  switch (profile.kind) {
    case 'nvd-2.0':
      return fetchFromNvd(profile, cveId);
    case 'epss':
      return fetchFromEpss(profile, cveId);
    case 'osv':
      return fetchFromOsv(profile, cveId);
    case 'vulncheck':
      return fetchFromVulncheck(profile, cveId);
    case 'custom':
      return fetchFromCustom(profile, cveId);
    case 'anthropic':
    case 'openai':
    case 'ollama':
    case 'openai-compatible':
      return Promise.resolve({
        ok: false,
        error: `${kindLabel(profile.kind)} is an AI provider; not callable for CVE enrichment`,
      });
  }
}

/** Test-call helper — hits the profile\'s adapter against a known
 *  CVE (Heartbleed, CVE-2014-0160, present in every public CVE
 *  database) and returns the raw FetchResult. The settings UI
 *  uses this for the "Test" button per profile. */
export async function testProfile(
  profile: ByokProfile,
): Promise<FetchResult<CveDetails>> {
  return dispatch(profile, 'CVE-2014-0160');
}
