/**
 * Live smoke test — run where outbound network is open (your machine or an
 * Apify run):  node scripts/smoke.mjs
 * Hits one real board per ATS and prints what came back. Exits non-zero if
 * any LIVE-VERIFIED source fails; smoke-flagged sources only warn.
 */
import { runScrape } from '../src/scrape.js';
import { SOURCES, SOURCE_NAMES } from '../src/sources/index.js';

const TARGETS = [
  'greenhouse:stripe',
  'lever:leverdemo',
  'ashby:openai',
  'workable:blueground',
  'smartrecruiters:smartrecruiters',
  'recruitee:greenchoice',
  'personio:personio',
  'breezy:breezy',
  'rippling:rippling',
  'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
  'eightfold:bayer',
  'pinpoint:workwithus',
  'teamtailor:career',
  'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions',
];

const sink = { pushJobs: async () => {}, log: { info: () => {}, warning: () => {} } };
const summary = await runScrape({ companies: TARGETS, maxJobsPerCompany: 5, dedupe: true }, sink);

let hardFail = false;
const covered = new Set();
for (const b of summary.boards) {
  const flag = SOURCES[b.ats]?.needsSmokeTest ? ' (smoke-flagged)' : '';
  if (b.ok) {
    covered.add(b.ats);
    console.log(`✓ ${b.ats}:${b.company}${flag} — ${b.found} jobs found`);
  } else {
    console.log(`✗ ${b.ats ?? '?'}:${b.company}${flag} — ${b.error}`);
    if (!SOURCES[b.ats]?.needsSmokeTest) hardFail = true;
  }
}

const missing = SOURCE_NAMES.filter((s) => !covered.has(s));
if (missing.length) {
  console.log(`\n! no live target covered: ${missing.join(', ')}`);
  hardFail = true;
}
console.log(`\n${covered.size}/${SOURCE_NAMES.length} ATS live. Total kept: ${summary.totalJobs}, duplicates: ${summary.totalDuplicates}, failures: ${summary.failures}`);
process.exit(hardFail ? 1 : 0);
