import { FadeIn } from '@/components/motion-primitives';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'api',
  description:
    'JSON snapshot of the playbook — phases, steps, commands, tools — for tooling, automation, or your own UI.',
};

export default function ApiDocsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 pt-10 pb-16 md:px-10 md:pt-20 md:pb-24">
      <FadeIn>
        <h1
          className="font-medium tracking-tight text-bone-0"
          style={{ fontSize: 'clamp(2.25rem, 7vw, 4rem)', lineHeight: 1.05 }}
        >
          api
        </h1>
        <p className="mt-4 max-w-2xl text-base text-bone-2 md:text-lg">
          A JSON snapshot of the playbook — phases, steps, commands,
          tools, all the filter axes. Use it for tooling, automation, or
          to build your own UI on top.
        </p>
      </FadeIn>

      <FadeIn delay={0.06}>
        <Section label="endpoint">
          <p className="text-sm text-bone-2">
            One read-only endpoint. No auth, no rate limits, no POST.
            Generated at build time and served as a static file.
          </p>
          <Code>GET /api/methodology.json</Code>
          <p className="mt-3 font-mono text-[12px] text-bone-3">
            Content-Type: application/json; charset=utf-8 · ~100 KB ·
            Cache-Control: public, max-age=300
          </p>
        </Section>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Section label="payload shape">
          <Code>{`{
  version: "1",                      // schema version (alias: schema_version)
  schema_version: "1",               // identical to version; provided so consumers
                                     // pinning against breaking changes have an
                                     // unambiguous field name
  generated: ISO8601 timestamp of the build,
  engagements: EngagementMeta[],     // BB / private / lab catalog
  targetOSes:  TargetOSMeta[],       // linux / windows / mixed
  techTagGroups: TechTagGroup[],     // grouped tag catalog (web servers,
                                     // databases, languages, etc.)
  tagCoverage:                       // per-tag rollup so consumers see which
    Record<TechTag, {                // axes are populated vs placeholders.
      commands, tools, total         // built dynamically — never goes stale
    }>,
  tools: ToolRef[],                  // deduped index of every tool referenced
                                     // anywhere, with (phases, steps) breadcrumbs
  phases: Phase[]                    // the walkthrough itself, 5 phases.
                                     // each phase + step is annotated with
                                     // commands_count + tools_count rollups
}`}</Code>
          <p className="mt-3 text-sm text-bone-2">
            Display-name field naming is mostly{' '}
            <code className="font-mono text-[12px] text-bone-1">label</code>{' '}
            (engagements, OSes, tech-tag groups + entries) — phases use{' '}
            <code className="font-mono text-[12px] text-bone-1">name</code>{' '}
            (with a parallel{' '}
            <code className="font-mono text-[12px] text-bone-1">short</code>{' '}
            for the compact form). A{' '}
            <code className="font-mono text-[12px] text-bone-1">label</code>{' '}
            alias is also emitted on phases (mirrors{' '}
            <code className="font-mono text-[12px] text-bone-1">name</code>) so
            consumers can read{' '}
            <code className="font-mono text-[12px] text-bone-1">label</code>{' '}
            uniformly.
          </p>
          <p className="mt-3 text-sm text-bone-2">
            Authoritative TypeScript types live in the source repo at{' '}
            <code className="font-mono text-[12px] text-bone-1">
              lib/methodology.ts
            </code>
            ,{' '}
            <code className="font-mono text-[12px] text-bone-1">
              lib/engagements.ts
            </code>
            ,{' '}
            <code className="font-mono text-[12px] text-bone-1">
              lib/target-os.ts
            </code>
            , and{' '}
            <code className="font-mono text-[12px] text-bone-1">
              lib/tech-tags.ts
            </code>
            .
          </p>
        </Section>
      </FadeIn>

      <FadeIn delay={0.14}>
        <Section label="filter semantics">
          <p className="text-sm text-bone-2">
            Three optional tag arrays gate visibility, on every step,
            command, tool, and pre-check:
          </p>
          <Code>{`appliesTo:   Engagement[]   // ["bug-bounty" | "private" | "lab"]
osApplies:   TargetOS[]     // ["linux" | "windows"]
techApplies: TechTag[]      // ["apache", "nginx", "wordpress", ...]`}</Code>
          <p className="mt-4 text-sm text-bone-2">
            An item is visible to a given user when ALL three pass:
          </p>
          <ul className="mt-2 ml-5 list-disc space-y-1 text-sm text-bone-2 marker:text-bone-4">
            <li>
              <code className="font-mono text-[12px] text-bone-1">appliesTo</code>{' '}
              absent, OR includes the user&rsquo;s engagement
            </li>
            <li>
              <code className="font-mono text-[12px] text-bone-1">osApplies</code>{' '}
              absent, OR (the user picked{' '}
              <code className="font-mono text-[12px] text-bone-1">mixed</code>) OR
              the user&rsquo;s OS is in the list
            </li>
            <li>
              <code className="font-mono text-[12px] text-bone-1">techApplies</code>{' '}
              absent, OR (the user&rsquo;s selected tags is empty) OR any selected
              tag is in the list
            </li>
          </ul>
        </Section>
      </FadeIn>

      <FadeIn delay={0.18}>
        <Section label="interpolation">
          <p className="text-sm text-bone-2">
            Command strings carry{' '}
            <code className="font-mono text-[12px] text-bone-1">{'{name}'}</code>{' '}
            tokens that the UI substitutes from user-supplied context before
            copy. If you&rsquo;re consuming the API directly, do the same
            substitution before handing commands to a shell.
          </p>
          <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-bone-2 marker:text-bone-4">
            <li>
              <code className="font-mono text-[12px] text-bone-1">{'{target}'}</code>{' '}
              — the asset under test (host / IP / URL).
            </li>
            <li>
              <code className="font-mono text-[12px] text-bone-1">{'{version}'}</code>{' '}
              — discovered version of the primary tech stack (e.g.{' '}
              <code className="font-mono text-[12px] text-bone-1">2.4.49</code>);
              vuln-phase commands like searchsploit + cvemap thread it through.
            </li>
            <li>
              <code className="font-mono text-[12px] text-bone-1">{'{cve}'}</code>,{' '}
              <code className="font-mono text-[12px] text-bone-1">{'{cves}'}</code>{' '}
              — single CVE id and comma-separated list, for EPSS API calls.
            </li>
            <li>
              <code className="font-mono text-[12px] text-bone-1">{'{exploit_id}'}</code>{' '}
              — Exploit-DB / SearchSploit id, for the local-mirror command.
            </li>
            <li>
              <em>Anything else</em> is treated as a free-form scratch token —
              the UI surfaces an input for it; the JSON just carries the literal{' '}
              <code className="font-mono text-[12px] text-bone-1">{'{name}'}</code>.
            </li>
          </ul>
          <p className="mt-3 text-sm text-bone-2">
            Curl <code className="font-mono text-[12px] text-bone-1">-w</code>{' '}
            format strings (
            <code className="font-mono text-[12px] text-bone-1">%{'{http_code}'}</code>,{' '}
            <code className="font-mono text-[12px] text-bone-1">%{'{redirect_url}'}</code>,
            etc.) appear verbatim in some commands and are <em>not</em>{' '}
            interpolation tokens — the leading{' '}
            <code className="font-mono text-[12px] text-bone-1">%</code>{' '}
            disambiguates. If you write your own substituter, exclude{' '}
            <code className="font-mono text-[12px] text-bone-1">%{'{...}'}</code>.
          </p>
        </Section>
      </FadeIn>

      <FadeIn delay={0.2}>
        <Section label="step flags">
          <p className="text-sm text-bone-2">
            Optional flags on a step that change filter semantics for that
            step only:
          </p>
          <ul className="mt-3 ml-5 list-disc space-y-1 text-sm text-bone-2 marker:text-bone-4">
            <li>
              <code className="font-mono text-[12px] text-bone-1">requiresTechSelection: true</code>{' '}
              — flips tech filtering into <em>strict</em> mode for this step.
              Tagged commands and tools stay hidden when the user&rsquo;s
              selected-tags set is empty (instead of the default &ldquo;empty
              = no filter&rdquo; behavior). Used on the recon{' '}
              <code className="font-mono text-[12px] text-bone-1">Technology fingerprinting</code>{' '}
              step so the user isn&rsquo;t firehosed with every per-tech
              probe before they&rsquo;ve picked a stack.
            </li>
          </ul>
        </Section>
      </FadeIn>

      <FadeIn delay={0.205}>
        <Section label="session snapshot (frontend ↔ JSON)">
          <p className="text-sm text-bone-2">
            The catalog above is server-side, static, the same for
            everyone. The session — what engagement you picked, which
            tags + versions are set, which steps you marked done,
            which commands you ticked as actually run, your per-step
            notes — is client-side only (localStorage). The shell{' '}
            <code className="font-mono text-[12px] text-bone-1">
              {'{ }'}
            </code>{' '}
            <code className="font-mono text-[12px] text-bone-1">session</code>{' '}
            button serialises that whole session into a JSON file you
            can save, diff, share, or restore via the Map view&rsquo;s
            &ldquo;import session snapshot&rdquo; link.
          </p>
          <p className="mt-3 text-sm text-bone-2">
            Pair the snapshot with{' '}
            <code className="font-mono text-[12px] text-bone-1">
              /api/methodology.json
            </code>{' '}
            for a complete picture: catalog (what was offered) +
            snapshot (what you did with it).
          </p>
          <Code>{`{
  schema_version: "1",            // distinct from the catalog version
  generated: ISO8601,
  catalog_version: string | null, // catalog this was made against
  engagement: "bug-bounty" | "private" | "lab" | null,
  target_os: "linux" | "windows" | "mixed" | null,
  tech_tags: TechTag[],
  target: string,                 // engagement-scoped asset
  versions: Record<TechTag, string>,
  scratch_values: Record<string, string>,
  step_notes: Record<stepId, string>,
  progress: {
    steps:     stepId[],          // "${'$'}{slug}:step:${'$'}{i}"
    commands:  commandId[],       // "${'$'}{slug}:cmd:${'$'}{stepIdx}:${'$'}{cmdIdx}"
    prechecks: precheckId[]       // "${'$'}{slug}:precheck:${'$'}{i}"
  }
}`}</Code>
          <p className="mt-3 text-sm text-bone-2">
            Re-importing rewrites every persisted slice atomically.
            Anything missing from the snapshot resets to default
            (partial snapshots don&rsquo;t leave stale state behind).
            Schema mismatch refuses the import rather than corrupting
            state.
          </p>
          <Subhead>Cross-reference: which techniques did the user demonstrate?</Subhead>
          <Code>{`# given session.json (snapshot) + methodology.json (catalog)
jq --slurpfile catalog methodology.json '
  .progress.commands as $ran
  | $catalog[0].phases[].steps[] as $step
  | $step.commands // []
  | to_entries[] | .key as $i
  | .value as $cmd
  | select($ran[] | endswith(":cmd:" + ($i | tostring)))
  | $cmd.mitreTechniques // []
' session.json | jq -s 'flatten | unique | sort'`}</Code>
        </Section>
      </FadeIn>

      <FadeIn delay={0.21}>
        <Section label="MITRE ATT&CK mapping">
          <p className="text-sm text-bone-2">
            Commands carry an optional{' '}
            <code className="font-mono text-[12px] text-bone-1">mitreTechniques: string[]</code>{' '}
            field listing the ATT&amp;CK technique IDs they demonstrate —
            e.g.{' '}
            <code className="font-mono text-[12px] text-bone-1">{'["T1558.003"]'}</code>{' '}
            for kerberoasting,{' '}
            <code className="font-mono text-[12px] text-bone-1">{'["T1003.006"]'}</code>{' '}
            for DCSync. Coverage is partial today (high-value AD post-ex
            commands first); the rest is being backfilled.
          </p>
          <p className="mt-3 text-sm text-bone-2">
            Lets a consumer answer &ldquo;what techniques does this
            playbook actually demonstrate?&rdquo; or thread a defense
            view (&ldquo;you ran X, here&rsquo;s the detection&rdquo;)
            without re-deriving the mapping.
          </p>
          <Code>{`curl -s /api/methodology.json \\
  | jq -r '
      [.phases[].steps[].commands[]?
        | select(.mitreTechniques)
        | {label, techniques: .mitreTechniques}]'`}</Code>
        </Section>
      </FadeIn>

      <FadeIn delay={0.22}>
        <Section label="examples">
          <p className="text-sm text-bone-2">curl + jq recipes for common queries.</p>

          <Subhead>The whole playbook</Subhead>
          <Code>curl /api/methodology.json | less</Code>

          <Subhead>The tool universe (deduped, with phase / step breadcrumbs)</Subhead>
          <Code>{`curl -s /api/methodology.json \\
  | jq '.tools[] | {name, kind, url, phases, steps}'`}</Code>

          <Subhead>Every command across all phases</Subhead>
          <Code>{`curl -s /api/methodology.json \\
  | jq '.phases[].steps[].commands // [] | .[]'`}</Code>

          <Subhead>All Linux-tagged commands in post-ex</Subhead>
          <Code>{`curl -s /api/methodology.json \\
  | jq '.phases[] | select(.slug == "post-ex") | .steps[].commands // []
        | .[] | select((.osApplies // []) | index("linux"))'`}</Code>

          <Subhead>Every step that uses Burp Suite</Subhead>
          <Code>{`curl -s /api/methodology.json \\
  | jq '.phases[].steps[] | select((.tools // []) | any(.name == "Burp Suite"))'`}</Code>

          <Subhead>All WordPress-relevant items (single-tag check)</Subhead>
          <Code>{`curl -s /api/methodology.json \\
  | jq '.phases[].steps[] | (.commands // [], .tools // [])
        | .[] | select((.techApplies // []) | index("wordpress"))'`}</Code>

          <Subhead>Items matching ANY of multiple tech tags (the right way)</Subhead>
          <p className="mt-1 max-w-2xl text-[12.5px] text-bone-3">
            The single-tag <code className="text-bone-1">index(...)</code> form
            doesn&rsquo;t generalize well — for multi-tag overlap (the common
            case when filtering by an actual stack), iterate the item&rsquo;s
            tags with <code className="text-bone-1">any($t[]; ...)</code>:
          </p>
          <Code>{`curl -s /api/methodology.json \\
  | jq --argjson tags '["apache","wordpress","mysql"]' '
      .phases[].steps[] | (.commands // [], .tools // [])
      | .[] | select(
          (.techApplies // []) as $t |
          $t | length == 0 or any($t[]; . as $x | $tags | index($x))
        )'`}</Code>

          <Subhead>Customized cheat-sheet for an engagement (engagement + OS + tech)</Subhead>
          <Code>{`curl -s /api/methodology.json \\
  | jq --arg eng "bug-bounty" --arg os "linux" \\
       --argjson tags '["apache","wordpress","mysql"]' '
      .phases[]
      | select((.appliesTo // [$eng]) | index($eng))
      | "═══ " + .name + " ═══",
        (.steps[]
          | select((.appliesTo // [$eng]) | index($eng))
          | select((.osApplies // []) | length == 0 or index($os))
          | select(
              (.techApplies // []) as $t |
              $t | length == 0 or any($t[]; . as $x | $tags | index($x))
            )
          | "  " + .title,
            ((.commands // [])[]
              | select((.appliesTo // [$eng]) | index($eng))
              | select((.osApplies // []) | length == 0 or index($os))
              | select(
                  (.techApplies // []) as $t |
                  $t | length == 0 or any($t[]; . as $x | $tags | index($x))
                )
              | "    $ " + (.label // "—")))'`}</Code>
        </Section>
      </FadeIn>

      <FadeIn delay={0.24}>
        <Section label="BYOK CVE enrichment">
          <p className="text-sm text-bone-2">
            Bring-your-own-key for live CVE / threat-intel data. Configure
            profiles via the gear chip in the playbook shell — keys are
            stored in your browser&rsquo;s localStorage and sent only to
            the configured endpoint. This app is a static export; there
            is no backend to forward, log, or see your keys.
          </p>
          <Subhead>provider kinds</Subhead>
          <ul className="mt-1 list-disc pl-5 text-sm text-bone-2 marker:text-bone-4">
            <li className="mt-1">
              <code className="font-mono text-[12px] text-bone-1">nvd-2.0</code>
              {' '}— NIST NVD REST 2.0. CORS-friendly. API key is optional
              (raises rate limit from 5/30s to 50/30s).
            </li>
            <li className="mt-1">
              <code className="font-mono text-[12px] text-bone-1">epss</code>
              {' '}— FIRST EPSS scores. CORS-friendly. No key required.
            </li>
            <li className="mt-1">
              <code className="font-mono text-[12px] text-bone-1">osv</code>
              {' '}— OSV.dev. CORS-friendly. No key required.
            </li>
            <li className="mt-1">
              <code className="font-mono text-[12px] text-bone-1">vulncheck</code>
              {' '}— VulnCheck NVD++. Paid; better data. Browser CORS may
              be blocked depending on plan; if so, route via a custom
              profile pointing at your own proxy.
            </li>
            <li className="mt-1">
              <code className="font-mono text-[12px] text-bone-1">custom</code>
              {' '}— company-internal CVE database or any HTTP endpoint.
              Configure base URL with{' '}
              <code className="font-mono text-[12px] text-bone-1">{'{id}'}</code>
              {' '}placeholder + auth header name (default{' '}
              <code className="font-mono text-[12px] text-bone-1">Authorization</code>
              ). Field auto-detection looks for{' '}
              <code className="font-mono text-[12px] text-bone-1">summary</code>,{' '}
              <code className="font-mono text-[12px] text-bone-1">cvssV3</code>,{' '}
              <code className="font-mono text-[12px] text-bone-1">references</code>,{' '}
              <code className="font-mono text-[12px] text-bone-1">published</code>,
              {' '}and{' '}
              <code className="font-mono text-[12px] text-bone-1">modified</code>.
            </li>
          </ul>
          <Subhead>privacy stance</Subhead>
          <p className="text-sm text-bone-2">
            Keys never leave your device except to the endpoint they were
            configured for. They are NOT included in the session snapshot
            export (so sharing a snapshot URL or downloaded JSON cannot
            leak your keys). They ARE wiped by &ldquo;reset all data&rdquo;
            in the welcome modal.
          </p>
          <Subhead>example: custom proxy</Subhead>
          <p className="text-sm text-bone-2">
            For endpoints without browser CORS, a 30-line Cloudflare
            Worker can forward requests:
          </p>
          <Code>{`export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cveId = url.pathname.split('/').pop();
    const r = await fetch(
      \`https://api.vulncheck.com/v3/index/nvd2?cve=\${cveId}\`,
      { headers: { Authorization: \`Bearer \${env.VULNCHECK_KEY}\` } }
    );
    return new Response(await r.text(), {
      status: r.status,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }
}
// Then point a custom profile at https://your-worker.workers.dev/cve/{id}`}</Code>
        </Section>
      </FadeIn>

      <FadeIn delay={0.26}>
        <Section label="stability">
          <p className="text-sm text-bone-2">
            Snapshot dump. Schema may change with site updates — usually
            additive (new tags, new fields, new phases). If you need
            stability across deploys, pin to a known-good copy locally.
            Breaking changes (renaming a field, removing a tag) bump the{' '}
            <code className="font-mono text-[12px] text-bone-1">version</code>{' '}
            (also exposed as{' '}
            <code className="font-mono text-[12px] text-bone-1">schema_version</code>)
            field.
          </p>
        </Section>
      </FadeIn>
    </div>
  );
}

/* =================================================== sub-components */

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 border-t border-ink-5/60 pt-6 md:mt-16 md:pt-8">
      <div className="mb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-bone-3">
        {label}
      </div>
      {children}
    </section>
  );
}

function Subhead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 mb-2 font-mono text-[10px] uppercase tracking-wider text-bone-4">
      {children}
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-ink-5 bg-ink-0/60 px-3 py-2 font-mono text-[12.5px] leading-relaxed text-bone-1">
      <code>{children}</code>
    </pre>
  );
}
