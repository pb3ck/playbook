/**
 * Curated index of offensive / defensive / purple-team WEB RESOURCES.
 *
 * Curation rule (strict): if you'd reach for it via a `man` page, an
 * `apt install`-able binary, or a desktop app, it does NOT belong here.
 * Likewise the docs page for a CLI tool is just a man page in HTML.
 *
 * Curation rule (taste): aim for ~5–15 entries per category. If you wouldn't
 * reach for it in the top five for its area, leave it out. Comprehensive
 * grows by accumulation; useful grows by deletion.
 *
 * Field conventions:
 *   - team    : 'defense' | 'purple'. Defaults to 'offense' when omitted.
 *   - pricing : only set when notable (freemium / paid / login).
 *   - tags    : 0–3 cross-cutting facets for filtering. Tag only when a user
 *               filtering by that tag would genuinely want this in the result.
 *               General meta-refs stay untagged so narrow filters don't drown
 *               the user in noise.
 *   - note    : optional one-liner shown after the description.
 *
 * Hierarchy:
 *   Folders may have `tools`, `subfolders`, or both. Slugs are unique across
 *   the catalog — they're URL anchors and tree-open keys.
 */

export type Pricing = 'freemium' | 'paid' | 'login';
export type Team = 'offense' | 'defense' | 'purple';

export type TechTag =
  | 'ad' | 'web' | 'api' | 'cloud' | 'mobile' | 'network' | 'binary' | 'crypto';

export type ActivityTag =
  | 'recon' | 'exploit' | 'post-ex' | 'creds' | 'defense' | 'training' | 'cve';

export type Tag = TechTag | ActivityTag;

export const TAG_GROUPS: { label: string; tags: Tag[] }[] = [
  { label: 'Tech', tags: ['ad', 'web', 'api', 'cloud', 'mobile', 'network', 'binary', 'crypto'] },
  { label: 'Activity', tags: ['recon', 'exploit', 'post-ex', 'creds', 'defense', 'training', 'cve'] },
];

export const TAG_LABELS: Record<Tag, string> = {
  ad: 'Active Directory',
  web: 'Web',
  api: 'API',
  cloud: 'Cloud / K8s',
  mobile: 'Mobile',
  network: 'Network',
  binary: 'Binary / RE',
  crypto: 'Crypto',
  recon: 'Recon / OSINT',
  exploit: 'Exploitation',
  'post-ex': 'Post-exploitation',
  creds: 'Credentials',
  defense: 'Defense',
  training: 'Training / CTF',
  cve: 'CVE / Advisory',
};

export type ExternalTool = {
  name: string;
  description: string;
  url: string;
  team?: Exclude<Team, 'offense'>;
  pricing?: Pricing;
  tags?: Tag[];
  note?: string;
};

export type ToolCategory = {
  slug: string;
  title: string;
  blurb?: string;
  tools?: ExternalTool[];
  subfolders?: ToolCategory[];
};

export function teamOf(t: ExternalTool): Team {
  return t.team ?? 'offense';
}

/* =========================================================================
 * Catalog — pruned to what I'd actually reach for.
 * ========================================================================= */

export const offensiveCategories: ToolCategory[] = [
  {
    slug: 'references',
    title: 'References',
    blurb: 'Living references — quicker to grep than to memorize.',
    subfolders: [
      {
        slug: 'ref-methodology',
        title: 'Methodology',
        tools: [
          { name: 'HackTricks', description: 'Comprehensive offensive notes, organized by phase.', url: 'https://book.hacktricks.xyz/', tags: ['ad', 'web', 'cloud', 'binary'] },
          { name: 'HackTricks Active Directory', description: 'AD-specific HackTricks methodology.', url: 'https://book.hacktricks.xyz/windows-hardening/active-directory-methodology', tags: ['ad', 'post-ex'] },
          { name: 'The Hacker Recipes', description: 'Active Directory, web, and infrastructure attack reference.', url: 'https://www.thehacker.recipes/', tags: ['ad', 'web'] },
        ],
      },
      {
        slug: 'ref-payloads',
        title: 'Payloads & wordlists',
        tools: [
          { name: 'PayloadsAllTheThings', description: 'Massive payload, technique, and bypass collection.', url: 'https://github.com/swisskyrepo/PayloadsAllTheThings', tags: ['web', 'exploit'] },
          { name: 'InternalAllTheThings', description: 'Sister repo — AD and internal pentest tradecraft.', url: 'https://github.com/swisskyrepo/InternalAllTheThings', tags: ['ad', 'post-ex'] },
          { name: 'SecLists', description: 'Standard collection of wordlists and payloads.', url: 'https://github.com/danielmiessler/SecLists', tags: ['web', 'recon'] },
          { name: 'revshells.com', description: 'Generator for reverse-shell one-liners across languages.', url: 'https://www.revshells.com/', tags: ['post-ex', 'exploit'] },
        ],
      },
      {
        slug: 'ref-lolx',
        title: 'Living off the land',
        tools: [
          { name: 'GTFOBins', description: 'Unix binaries usable to bypass restrictions.', url: 'https://gtfobins.github.io/', tags: ['post-ex'] },
          { name: 'LOLBAS', description: 'Living-off-the-land binaries on Windows.', url: 'https://lolbas-project.github.io/', team: 'purple', tags: ['post-ex', 'defense'] },
          { name: 'WADComs', description: 'Interactive cheat sheet of Windows/AD offensive commands.', url: 'https://wadcoms.github.io/', tags: ['ad', 'post-ex'] },
          { name: 'LOLDrivers', description: 'Vulnerable & malicious Windows drivers used by adversaries.', url: 'https://www.loldrivers.io/', team: 'purple', tags: ['post-ex', 'defense'] },
        ],
      },
      {
        slug: 'ref-owasp',
        title: 'OWASP',
        tools: [
          { name: 'OWASP Cheat Sheet Series', description: 'Concise security guidance, one topic per sheet.', url: 'https://cheatsheetseries.owasp.org/', team: 'defense', tags: ['web', 'api', 'defense'] },
          { name: 'OWASP WSTG', description: 'Web Security Testing Guide — methodology canon.', url: 'https://owasp.org/www-project-web-security-testing-guide/', tags: ['web'] },
          { name: 'OWASP Top 10', description: 'The canonical top web vulnerabilities list.', url: 'https://owasp.org/www-project-top-ten/', team: 'purple', tags: ['web'] },
        ],
      },
    ],
  },

  {
    slug: 'osint',
    title: 'OSINT',
    blurb: 'Browser-based recon services and search engines.',
    subfolders: [
      {
        slug: 'osint-internet-scan',
        title: 'Internet scan engines',
        tools: [
          { name: 'Shodan', description: 'Search engine for internet-connected devices.', url: 'https://www.shodan.io/', pricing: 'freemium', tags: ['recon', 'network'] },
          { name: 'Censys', description: 'Internet-wide scan data and asset search.', url: 'https://search.censys.io/', pricing: 'freemium', tags: ['recon', 'network'] },
        ],
      },
      {
        slug: 'osint-dns',
        title: 'DNS, certs & domains',
        tools: [
          { name: 'crt.sh', description: 'Certificate transparency log search.', url: 'https://crt.sh/', tags: ['recon'] },
          { name: 'DNSDumpster', description: 'DNS recon and host discovery.', url: 'https://dnsdumpster.com/', tags: ['recon'] },
          { name: 'SecurityTrails', description: 'Historical DNS, WHOIS, and subdomain data.', url: 'https://securitytrails.com/', pricing: 'freemium', tags: ['recon'] },
          { name: 'Hurricane Electric BGP', description: 'BGP, ASN, and IP space lookups.', url: 'https://bgp.he.net/', tags: ['recon', 'network'] },
          { name: 'MXToolbox', description: 'DNS, mail, and blacklist lookups.', url: 'https://mxtoolbox.com/', tags: ['recon'] },
        ],
      },
      {
        slug: 'osint-archives',
        title: 'URL & page archives',
        tools: [
          { name: 'urlscan.io', description: 'Live URL scanning, DOM and request inspection.', url: 'https://urlscan.io/', tags: ['recon', 'web'] },
          { name: 'Wayback Machine', description: 'Internet Archive — historical snapshots of pages.', url: 'https://web.archive.org/', tags: ['recon'] },
        ],
      },
      {
        slug: 'osint-people',
        title: 'People, emails & breaches',
        tools: [
          { name: 'Hunter.io', description: 'Email discovery by domain.', url: 'https://hunter.io/', pricing: 'freemium', tags: ['recon', 'creds'] },
          { name: 'Have I Been Pwned', description: 'Check email/password against breach corpus.', url: 'https://haveibeenpwned.com/', team: 'purple', tags: ['creds'] },
          { name: 'IntelX', description: 'Search engine over leaks, paste sites, dark web.', url: 'https://intelx.io/', pricing: 'freemium', tags: ['recon', 'creds'] },
          { name: 'WhatsMyName', description: 'Username enumeration across hundreds of sites.', url: 'https://whatsmyname.app/', tags: ['recon'] },
        ],
      },
      {
        slug: 'osint-misc',
        title: 'Tech & wireless',
        tools: [
          { name: 'BuiltWith', description: 'Tech stack fingerprinting for any site.', url: 'https://builtwith.com/', pricing: 'freemium', tags: ['recon', 'web'] },
          { name: 'WiGLE', description: 'Crowd-sourced wireless network mapping.', url: 'https://wigle.net/', tags: ['recon', 'network'] },
        ],
      },
    ],
  },

  {
    slug: 'vulndbs',
    title: 'Vulnerability databases',
    blurb: 'CVE catalogs, advisories, and exploit indexes.',
    tools: [
      { name: 'Exploit Database', description: 'Public exploits and shellcode index.', url: 'https://www.exploit-db.com/', tags: ['cve', 'exploit'] },
      { name: 'CVE.org (MITRE)', description: 'Authoritative CVE list.', url: 'https://www.cve.org/', team: 'purple', tags: ['cve'] },
      { name: 'NVD', description: 'NIST National Vulnerability Database with scoring and CPE data.', url: 'https://nvd.nist.gov/', team: 'purple', tags: ['cve'] },
      { name: 'CISA KEV', description: 'Known Exploited Vulnerabilities catalog — what attackers actually use.', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', team: 'defense', tags: ['cve', 'defense'] },
      { name: 'GitHub Advisory Database', description: 'Open-source ecosystem advisories.', url: 'https://github.com/advisories', team: 'purple', tags: ['cve'] },
      { name: 'OSV.dev', description: 'Distributed open-source vulnerability database.', url: 'https://osv.dev/', team: 'purple', tags: ['cve'] },
      { name: 'Sploitus', description: 'Search engine for exploits and PoCs.', url: 'https://sploitus.com/', tags: ['cve', 'exploit'] },
      { name: 'Project Zero', description: "Google's offensive research blog and bug tracker.", url: 'https://googleprojectzero.blogspot.com/', team: 'purple', tags: ['cve'] },
    ],
  },

  {
    slug: 'frameworks',
    title: 'Frameworks',
    blurb: 'Adversary behavior models and weakness taxonomies.',
    tools: [
      { name: 'MITRE ATT&CK', description: 'Adversary tactics and techniques knowledge base.', url: 'https://attack.mitre.org/', team: 'purple' },
      { name: 'ATT&CK Navigator', description: 'Visualize and annotate ATT&CK matrices in the browser.', url: 'https://mitre-attack.github.io/attack-navigator/', team: 'purple' },
      { name: 'MITRE D3FEND', description: 'Defensive countermeasure knowledge graph.', url: 'https://d3fend.mitre.org/', team: 'defense', tags: ['defense'] },
      { name: 'MITRE CWE', description: 'Common Weakness Enumeration.', url: 'https://cwe.mitre.org/', team: 'defense', tags: ['defense'] },
      { name: 'NIST CSF', description: 'NIST Cybersecurity Framework — risk and controls.', url: 'https://www.nist.gov/cyberframework', team: 'defense', tags: ['defense'] },
    ],
  },

  {
    slug: 'labs',
    title: 'Labs & training',
    blurb: 'Browser-based platforms for hands-on practice.',
    tools: [
      { name: 'Hack The Box', description: 'Boxes, labs, and certification tracks.', url: 'https://www.hackthebox.com/', pricing: 'freemium', tags: ['training', 'ad', 'web'] },
      { name: 'TryHackMe', description: 'Guided rooms across attack categories.', url: 'https://tryhackme.com/', pricing: 'freemium', tags: ['training', 'ad', 'web'] },
      { name: 'PortSwigger Web Security Academy', description: 'Free, in-depth web app security labs.', url: 'https://portswigger.net/web-security', tags: ['training', 'web'] },
      { name: 'pwn.college', description: 'Binary exploitation and reverse engineering curriculum.', url: 'https://pwn.college/', tags: ['training', 'binary'] },
      { name: 'OverTheWire', description: 'Wargames for shell, networking, and crypto fundamentals.', url: 'https://overthewire.org/wargames/', tags: ['training'] },
      { name: 'picoCTF', description: 'CMU-run, beginner-friendly CTF.', url: 'https://picoctf.org/', tags: ['training'] },
      { name: 'VulnHub', description: 'Vulnerable VM index for offline practice.', url: 'https://www.vulnhub.com/', tags: ['training'] },
      { name: 'Hacker101 CTF', description: "HackerOne's free web hacking CTF.", url: 'https://ctf.hacker101.com/', tags: ['training', 'web'] },
      { name: 'CryptoHack', description: 'Cryptography challenges and learning platform.', url: 'https://cryptohack.org/', tags: ['training', 'crypto'] },
      { name: 'CTFtime', description: 'Calendar and writeups for CTFs worldwide.', url: 'https://ctftime.org/', tags: ['training'] },
    ],
  },

  {
    slug: 'ad',
    title: 'Active Directory',
    blurb: 'AD attack paths and tradecraft.',
    tools: [
      { name: 'adsecurity.org', description: "Sean Metcalf's deep AD security writeups.", url: 'https://adsecurity.org/', team: 'purple', tags: ['ad'] },
      { name: 'SpecterOps blog', description: 'Posts on AD, BloodHound, and offensive tradecraft.', url: 'https://posts.specterops.io/', tags: ['ad', 'post-ex'] },
      { name: 'AD Attack & Defense', description: "infosecn1nja's curated AD attack/defense matrix.", url: 'https://github.com/infosecn1nja/AD-Attack-Defense', team: 'purple', tags: ['ad', 'defense'] },
      { name: 'Mayfly277 Blog', description: 'Lab-driven AD writeups (GOAD, ADCS, Exchange).', url: 'https://mayfly277.github.io/', tags: ['ad', 'post-ex'] },
      { name: 'GOAD Lab', description: 'Game of Active Directory — vulnerable AD lab project.', url: 'https://github.com/Orange-Cyberdefense/GOAD', tags: ['ad', 'training'] },
    ],
  },

  {
    slug: 'cloud',
    title: 'Cloud',
    blurb: 'AWS, Azure, GCP, and Kubernetes-focused web resources.',
    tools: [
      { name: 'HackTricks Cloud', description: 'AWS/Azure/GCP/K8s offensive notes.', url: 'https://cloud.hacktricks.xyz/', tags: ['cloud'] },
      { name: 'AWS Well-Architected — Security', description: 'Official AWS security pillar guidance.', url: 'https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html', team: 'defense', tags: ['cloud', 'defense'] },
      { name: 'Rhino Security AWS Blog', description: 'Long-running AWS offensive research series.', url: 'https://rhinosecuritylabs.com/category/aws/', tags: ['cloud'] },
      { name: 'Kubernetes Security Cheatsheet (OWASP)', description: 'OWASP K8s security cheat sheet.', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Kubernetes_Security_Cheat_Sheet.html', team: 'defense', tags: ['cloud', 'defense'] },
      { name: 'Kubernetes Threat Matrix (Microsoft)', description: 'ATT&CK-style matrix for K8s.', url: 'https://www.microsoft.com/en-us/security/blog/2021/03/23/secure-containerized-environments-with-updated-threat-matrix-for-kubernetes/', team: 'purple', tags: ['cloud'] },
    ],
  },

  {
    slug: 'mobile',
    title: 'Mobile',
    blurb: 'iOS and Android offensive references.',
    tools: [
      { name: 'OWASP MASTG', description: 'Mobile Application Security Testing Guide.', url: 'https://mas.owasp.org/MASTG/', team: 'purple', tags: ['mobile'] },
      { name: 'OWASP MASVS', description: 'Mobile Application Security Verification Standard.', url: 'https://mas.owasp.org/MASVS/', team: 'defense', tags: ['mobile', 'defense'] },
      { name: 'HackTricks iOS', description: 'iOS pentesting notes.', url: 'https://book.hacktricks.xyz/mobile-pentesting/ios-pentesting', tags: ['mobile'] },
      { name: 'HackTricks Android', description: 'Android pentesting notes.', url: 'https://book.hacktricks.xyz/mobile-pentesting/android-app-pentesting', tags: ['mobile'] },
    ],
  },

  {
    slug: 'crypto',
    title: 'Crypto & encoding',
    blurb: 'Decode, transform, identify — all in the browser.',
    tools: [
      { name: 'CyberChef', description: "GCHQ's swiss-army knife for encoding, crypto, and data ops.", url: 'https://gchq.github.io/CyberChef/', team: 'purple', tags: ['crypto'] },
      { name: 'dCode', description: 'Massive collection of cipher and encoding tools.', url: 'https://www.dcode.fr/en', team: 'purple', tags: ['crypto'] },
      { name: 'CrackStation', description: 'Free hash lookup with massive rainbow tables.', url: 'https://crackstation.net/', tags: ['crypto', 'creds'] },
      { name: 'hashes.com', description: 'Hash identification, lookup, and cracking marketplace.', url: 'https://hashes.com/', tags: ['crypto', 'creds'] },
      { name: 'jwt.io', description: 'Decode, verify, and tamper with JWTs in the browser.', url: 'https://jwt.io/', team: 'purple', tags: ['crypto', 'web'] },
    ],
  },

  {
    slug: 'detection',
    title: 'Defense & detection',
    blurb: 'Detection content, emulation, and incident research.',
    tools: [
      { name: 'Sigma HQ', description: 'Generic SIEM rule format and rule library.', url: 'https://sigmahq.io/', team: 'defense', tags: ['defense'] },
      { name: 'Atomic Red Team', description: 'Adversary emulation tests mapped to ATT&CK.', url: 'https://atomicredteam.io/', team: 'purple', tags: ['defense', 'post-ex'] },
      { name: 'MITRE Caldera', description: 'Automated adversary emulation platform.', url: 'https://caldera.mitre.org/', team: 'purple', tags: ['defense', 'post-ex'] },
      { name: 'The DFIR Report', description: 'Real-world intrusion writeups, end to end.', url: 'https://thedfirreport.com/', team: 'defense', tags: ['defense'] },
      { name: 'Mandiant Blog', description: 'Mandiant threat intel and incident research.', url: 'https://cloud.google.com/blog/topics/threat-intelligence', team: 'defense', tags: ['defense'] },
    ],
  },

  {
    slug: 'bounty',
    title: 'Bug bounty',
    blurb: 'Public reports and disclosure norms.',
    tools: [
      { name: 'HackerOne Hacktivity', description: 'Public disclosure feed across HackerOne programs.', url: 'https://hackerone.com/hacktivity', pricing: 'login', tags: ['web'] },
      { name: 'Bugcrowd Crowdstream', description: 'Public reports across Bugcrowd programs.', url: 'https://bugcrowd.com/crowdstream', tags: ['web'] },
      { name: 'disclose.io', description: 'Standard safe-harbor and disclosure policies.', url: 'https://disclose.io/', team: 'purple' },
      { name: 'Pentester Land', description: 'Aggregated bug bounty writeups and newsletter.', url: 'https://pentester.land/', tags: ['web', 'training'] },
    ],
  },

  {
    slug: 'threat-intel',
    title: 'Threat intel & sandboxes',
    blurb: 'Live verdicts on hosts, files, URLs, and indicators.',
    tools: [
      { name: 'GreyNoise Visualizer', description: 'Filter background internet noise from real targeting.', url: 'https://viz.greynoise.io/', team: 'defense', pricing: 'freemium', tags: ['defense', 'network'] },
      { name: 'AbuseIPDB', description: 'IP reputation and abuse reports.', url: 'https://www.abuseipdb.com/', team: 'defense', pricing: 'freemium', tags: ['defense', 'network'] },
      { name: 'VirusTotal', description: 'Hash, URL, and file scanning with intel.', url: 'https://www.virustotal.com/', team: 'purple', pricing: 'freemium', tags: ['defense'] },
      { name: 'URLhaus (abuse.ch)', description: 'Malicious URL feed.', url: 'https://urlhaus.abuse.ch/', team: 'defense', tags: ['defense'] },
      { name: 'MalwareBazaar (abuse.ch)', description: 'Malware sample database.', url: 'https://bazaar.abuse.ch/', team: 'purple', tags: ['defense', 'binary'] },
      { name: 'any.run', description: 'Interactive malware sandbox in the browser.', url: 'https://any.run/', team: 'purple', pricing: 'freemium', tags: ['defense', 'binary'] },
      { name: 'ipinfo.io', description: 'Geolocation, ASN, and company data for IPs.', url: 'https://ipinfo.io/', team: 'purple', pricing: 'freemium', tags: ['recon', 'network'] },
    ],
  },

  {
    slug: 'news',
    title: 'News',
    blurb: 'Daily check-in feeds.',
    tools: [
      { name: 'KrebsOnSecurity', description: 'Brian Krebs on cybercrime, fraud, and threats.', url: 'https://krebsonsecurity.com/', team: 'purple' },
      { name: 'tldr;sec', description: "Clint Gibler's weekly security newsletter.", url: 'https://tldrsec.com/', team: 'purple' },
      { name: 'SANS ISC', description: 'SANS Internet Storm Center daily diary.', url: 'https://isc.sans.edu/', team: 'defense' },
    ],
  },
];
