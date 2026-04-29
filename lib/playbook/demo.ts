import type { SessionSnapshot } from './session';
import { SESSION_SCHEMA_VERSION } from './session';

/**
 * Curated example session — a Windows / Active Directory engagement
 * with realistic recon → vuln → AD-mapping → cred-harvest progress
 * and demonstrated MITRE ATT&CK techniques. Loaded by the welcome
 * modal\'s "load example engagement" affordance so a fresh visitor
 * can immediately see the full app populated (Map view with hosts +
 * services + findings + creds, defense thread-back lit up,
 * scratch-token threading) instead of staring at empty surfaces.
 *
 * Imported via `state.loadSnapshot()` — the same pipeline used by
 * the user-driven session-import button. Keeps one ingestion path,
 * one place to evolve.
 *
 * The ids inside `progress.commands` reference real positions in the
 * shipping catalog; if the catalog reshuffles, this snapshot may go
 * stale and need a refresh. That tradeoff is acceptable — the demo
 * is a pedagogical artifact, not a stability contract.
 */
export const DEMO_SESSION: SessionSnapshot = {
  schema_version: SESSION_SCHEMA_VERSION,
  generated: '2026-04-28T00:00:00.000Z',
  catalog_version: '1',
  engagement: 'private',
  target_os: 'windows',
  tech_tags: ['kerberos', 'ldap', 'iis', 'mssql'],
  target: 'dc01.acme.local',
  versions: {
    iis: '10.0',
    mssql: '15.0.4138.2',
  },
  scratch_values: {
    cve: 'CVE-2022-26923',
    domain: 'acme.local',
    nthash: 'aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0',
  },
  progress: {
    /* Step "completion" was removed in the activity-over-completion
       refactor. Empty array kept for schema_version=1 back-compat. */
    steps: [],
    commands: [
      /* Recon: nmap quiet, fingerprint generics + AD enum stack. */
      'recon:cmd:2:0',
      'recon:cmd:6:0',
      'recon:cmd:6:1',
      'recon:cmd:6:8',
      'recon:cmd:6:21',
      'recon:cmd:6:23',
      'recon:cmd:6:24',
      'recon:cmd:6:25',
      /* Vuln: Zerologon + NoPac + Certifried CVE lookups. */
      'vuln:cmd:0:9',
      'vuln:cmd:0:11',
      'vuln:cmd:0:12',
      /* Post-ex: BloodHound + certipy + GetUserSPNs + DCSync chain
         leading to Golden-Ticket-adjacent capability. */
      'post-ex:cmd:2:0',
      'post-ex:cmd:2:2',
      'post-ex:cmd:2:3',
      'post-ex:cmd:3:1',
      'post-ex:cmd:3:2',
      'post-ex:cmd:3:3',
      'post-ex:cmd:3:4',
      'post-ex:cmd:3:7',
      'post-ex:cmd:3:8',
      /* Lateral: pass-the-hash to demonstrate T1550.002 surface. */
      'post-ex:cmd:4:0',
    ],
    prechecks: [
      'recon:precheck:0',
      'recon:precheck:1',
      'vuln:precheck:0',
      'post-ex:precheck:0',
    ],
  },
  /* Steps the user has navigated through. The demo lights up a
     handful so the activity counts in the phase headers show
     non-zero from the moment the snapshot loads. */
  visited_steps: [
    'recon:step:0',
    'recon:step:1',
    'recon:step:2',
    'recon:step:6',
    'vuln:step:0',
    'vuln:step:1',
    'post-ex:step:2',
    'post-ex:step:3',
  ],
  /* Empty positions map — the infra-map derives its layout from the
     session and the user can drag from there. */
  infra_map: { positions: {} },
};
