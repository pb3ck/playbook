/**
 * Source-link sanity check — pulls every external URL out of the
 * catalog (tool refs in step.tools, branch references that look
 * URL-shaped) and HEAD-checks them. Reports anything 4xx/5xx or
 * times out.
 *
 * Why: catalog tool URLs rot. Vendors rebrand, repos move, GitHub
 * orgs go private. A user clicking a stale tool link in the focus
 * view gets a bad first impression. This script catches the rot
 * before it ships.
 *
 * Usage:
 *   npm run check:sources           # walk catalog + HEAD-check; print report
 *   npm run check:sources -- --json # machine-readable output (for CI)
 *
 * NOT a CI gate by default. Link rot is a maintenance task, not a
 * commit-blocker — failing CI on it would punish maintainers for
 * external orgs renaming a repo. The intended pattern is a weekly
 * scheduled workflow that runs this + opens an issue with broken
 * links, while regular CI runs typecheck/build only.
 *
 * Concurrency: 8 in-flight by default. Most public hosts are fine
 * with that for 50ish HEAD requests; bump --concurrency for larger
 * runs.
 */

import { PHASES } from '../lib/methodology';

/* =================================================== Types */

type CheckResult =
  | { url: string; ok: true; status: number; finalUrl?: string }
  | { url: string; ok: false; status?: number; error: string };

type Source = {
  url: string;
  /** Where in the catalog this URL came from — useful for the
   *  human-readable report so the maintainer knows which entry
   *  to fix. */
  context: string;
};

/* =================================================== Source extraction */

function collectSources(): Source[] {
  const out: Source[] = [];
  for (const phase of PHASES) {
    for (let i = 0; i < phase.steps.length; i++) {
      const step = phase.steps[i];
      for (const tool of step.tools ?? []) {
        if (typeof tool.url !== 'string' || !tool.url.startsWith('http')) {
          continue;
        }
        out.push({
          url: tool.url,
          context: `${phase.slug}/${i} (${step.title}) → tool: ${tool.name}`,
        });
      }
    }
  }
  /* Dedupe by url — same tool may appear in multiple steps. We
     track contexts as a list so the report can show every
     occurrence even if we only HEAD once. */
  const dedup = new Map<string, Source>();
  for (const s of out) {
    const existing = dedup.get(s.url);
    if (existing) {
      existing.context += ` · ${s.context}`;
    } else {
      dedup.set(s.url, { ...s });
    }
  }
  return [...dedup.values()];
}

/* =================================================== Fetch */

async function checkOne(url: string, timeoutMs = 10_000): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    /* HEAD first — cheaper. Some servers (notably GitHub raw
       content, Cloudflare-fronted sites) reject HEAD with 405
       or 404; fall back to GET when HEAD fails non-2xx. */
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        /* Identify ourselves so a host that bans bots can recognize
           this as a maintenance run, not unauthenticated abuse. */
        'User-Agent':
          'playbook-source-checker/1.0 (https://github.com/pb3ck/playbook)',
      },
    });
    if (!res.ok && (res.status === 404 || res.status === 405 || res.status === 403)) {
      /* Retry with GET — some servers refuse HEAD entirely. */
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'playbook-source-checker/1.0 (https://github.com/pb3ck/playbook)',
        },
      });
    }
    if (!res.ok) {
      return { url, ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    return {
      url,
      ok: true,
      status: res.status,
      finalUrl: res.url !== url ? res.url : undefined,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      error:
        err instanceof DOMException && err.name === 'AbortError'
          ? `timeout after ${timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Concurrent runner — keeps `n` checks in flight at a time.
 *  Returns results in input order. */
async function runConcurrent<T, R>(
  items: T[],
  worker: (t: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* =================================================== Main */

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const concurrencyIdx = argv.indexOf('--concurrency');
  const concurrency =
    concurrencyIdx === -1
      ? 8
      : parseInt(argv[concurrencyIdx + 1] ?? '8', 10);

  const sources = collectSources();
  if (!json) {
    console.log(
      `Checking ${sources.length} unique tool URLs (concurrency=${concurrency})...`,
    );
  }
  const t0 = Date.now();
  const results = await runConcurrent(
    sources,
    (s) => checkOne(s.url),
    concurrency,
  );
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const broken = results.filter((r) => !r.ok);
  const redirected = results.filter((r) => r.ok && r.finalUrl);

  if (json) {
    console.log(
      JSON.stringify(
        {
          generated: new Date().toISOString(),
          checked: sources.length,
          broken: broken.length,
          redirected: redirected.length,
          elapsed_sec: parseFloat(elapsed),
          results: results.map((r, i) => ({
            ...r,
            context: sources[i].context,
          })),
        },
        null,
        2,
      ),
    );
    process.exit(broken.length > 0 ? 1 : 0);
  }

  console.log(
    `\nChecked ${sources.length} URLs in ${elapsed}s · ${broken.length} broken · ${redirected.length} redirected`,
  );

  if (broken.length > 0) {
    console.log('\n──── broken ────');
    for (const r of broken) {
      const idx = results.indexOf(r);
      const ctx = sources[idx].context;
      console.log(`  ✗ ${r.url}`);
      console.log(`    ${r.error}`);
      console.log(`    ${ctx}`);
    }
  }

  if (redirected.length > 0) {
    console.log('\n──── redirected (consider updating to canonical URL) ────');
    for (const r of redirected) {
      if (!r.ok || !r.finalUrl) continue;
      console.log(`  → ${r.url}`);
      console.log(`    now ${r.finalUrl}`);
    }
  }

  /* Exit non-zero ONLY if broken — redirects are informational,
     not failures. Maintainer / CI can decide whether to fail
     the build by reading exit code. */
  process.exit(broken.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
