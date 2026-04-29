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
 *  adapter based on this discriminator. */
export type ByokKind = 'nvd-2.0' | 'epss' | 'osv' | 'vulncheck' | 'custom';

/** A single user-configured BYOK profile. Persisted as part of an
 *  array under `STORAGE_KEYS.byokProfiles`. */
export type ByokProfile = {
  /** Random UUID, generated at create time. Stable across renames. */
  id: string;
  /** Human label shown in the settings UI ("Production NVD",
   *  "Internal CVEDB"). Free-form. */
  name: string;
  kind: ByokKind;
  /** API key / token. Optional for kinds that don\'t require auth
   *  (epss, osv) — kept in the type so the form is uniform. */
  apiKey?: string;
  /** Custom-only: full base URL with `{id}` placeholder for the
   *  CVE id (e.g. `https://internal.example.com/cve/{id}`). */
  baseUrl?: string;
  /** Custom-only: HTTP header name for the auth value. Default
   *  `Authorization`. */
  headerName?: string;
  /** User toggle — false hides the profile from `enrichCve`
   *  fan-out without deleting it. */
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
]);

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
  }
}

/** Whether this provider kind needs an API key to function. UI
 *  uses this to hide the key field for kinds that don\'t. */
export function kindNeedsKey(kind: ByokKind): boolean {
  return kind === 'nvd-2.0' /* optional but useful for rate-limit */ ||
    kind === 'vulncheck' || kind === 'custom';
}

/** Whether the kind\'s endpoint supports browser CORS. The settings
 *  UI surfaces a hint when CORS is known to be blocked so users
 *  understand why a request might fail. */
export function kindSupportsBrowserCors(kind: ByokKind): boolean {
  return kind === 'nvd-2.0' || kind === 'epss' || kind === 'osv';
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
  const enabled = profiles.filter((p) => p.enabled);
  return Promise.all(
    enabled.map(async (profile) => ({
      profile,
      result: await dispatch(profile, cveId),
    })),
  );
}

/** Dispatch a single (profile, cve) pair to the right adapter. */
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
