import test from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../src/scrape.js';
import { inferSeniority, normalizeEmploymentType, normalizeWorkplaceType, enrich, SENIORITY_LEVELS } from '../src/enrich.js';
import { parseSeniorityFilter } from '../src/filters.js';
import * as fx from './fixtures/boards.js';

// ---- fake fetch that serves fixtures by URL pattern (same shape as pipeline.test.js)
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    for (const [pattern, payload] of routes) {
      if (url.includes(pattern)) {
        if (payload instanceof Error) throw payload;
        if (typeof payload === 'number') return { ok: false, status: payload, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => payload, text: async () => String(payload) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  impl.calls = calls;
  return impl;
}

function collectSink() {
  const jobs = [];
  return { jobs, pushJobs: async (batch) => { jobs.push(...batch); }, log: { info() {}, warning() {} } };
}

function memoryStore(initial = null) {
  const store = { value: initial };
  store.loadState = async () => store.value;
  store.saveState = async (s) => { store.value = s; };
  return store;
}

function monitorSink(store) {
  const sink = collectSink();
  sink.loadState = store.loadState;
  sink.saveState = store.saveState;
  return sink;
}

const T0 = Date.parse('2026-08-20T00:00:00.000Z');
const T1 = Date.parse('2026-08-21T00:00:00.000Z');

/** A greenhouse-shaped board of `titles.length` distinct postings. */
function ghBoard(slug, titles) {
  return {
    jobs: titles.map((title, n) => ({
      id: `${slug}-${n}`,
      title,
      absolute_url: `https://boards.greenhouse.io/${slug}/jobs/${n}`,
      location: { name: `City ${n}` },
      first_published: '2026-08-19T09:00:00-00:00',
      updated_at: '2026-08-19T09:00:00-00:00',
      company_name: slug,
      departments: [], offices: [], metadata: [], content: '',
    })),
  };
}
const ghUrl = (slug) => `boards/${slug}/jobs`;

// ---- inferSeniority ---------------------------------------------------------
test('inferSeniority: table of titles, precedence and honest nulls', () => {
  const cases = [
    ['Senior Backend Engineer', 'senior'],
    ['Staff Software Engineer', 'staff'],
    ['Senior Staff Engineer', 'staff'],          // scope beats grade
    ['Engineering Manager', 'manager'],
    ['Head of Payments', 'director'],
    ['VP of Sales', 'vp'],
    ['Chief Technology Officer', 'cxo'],
    ['Software Engineer', null],                 // no signal -> no guess
    ['Leadership Coach', null],                  // not 'lead'
    ['Internal Tools Engineer', null],           // not 'intern'
    ['Machine Learning Intern', 'intern'],
    ['Jr. Developer', 'junior'],
    ['Mid-Level Designer', 'mid'],
    ['Tech Lead', 'lead'],
    ['Principal Scientist', 'principal'],
  ];
  for (const [title, expected] of cases) {
    assert.equal(inferSeniority(title), expected, `${title} -> ${inferSeniority(title)}`);
  }
});

test('inferSeniority: junk input is null, never a default level', () => {
  for (const junk of [null, undefined, '', '   ', 42, {}]) assert.equal(inferSeniority(junk), null);
  // 'mid' is only ever an explicit signal
  assert.equal(inferSeniority('Product Designer'), null);
  assert.equal(inferSeniority('Intermediate Accountant'), 'mid');
});

test('inferSeniority: every level in the vocabulary is reachable', () => {
  const hits = new Set([
    'Data Science Intern', 'Junior Analyst', 'Mid-level Engineer', 'Sr. Recruiter',
    'Staff Designer', 'Principal Architect', 'Team Lead', 'Product Manager',
    'Director of Ops', 'SVP Marketing', 'CFO',
  ].map(inferSeniority));
  assert.deepEqual([...hits].sort(), [...SENIORITY_LEVELS].sort());
});

// ---- normalizeEmploymentType ------------------------------------------------
test('normalizeEmploymentType: every ATS dialect lands in the same bucket', () => {
  const cases = [
    ['FullTime', 'fulltime'],            // Ashby
    ['Full-time', 'fulltime'],           // Lever / Greenhouse metadata
    ['full_time', 'fulltime'],           // Workable
    ['fulltime_fixed_term', 'temporary'],// Recruitee: the fixed term is the fact that matters
    ['part_time', 'parttime'],
    ['Contractor', 'contract'],
    ['Internship', 'internship'],
    [null, null],
    [undefined, null],
    ['', null],
    ['Other', null],                     // unrecognised stays unrecognised
  ];
  for (const [raw, expected] of cases) {
    assert.equal(normalizeEmploymentType(raw), expected, `${raw} -> ${normalizeEmploymentType(raw)}`);
  }
});

// ---- normalizeWorkplaceType -------------------------------------------------
test('normalizeWorkplaceType: value first, isRemote only as a fallback', () => {
  assert.equal(normalizeWorkplaceType('Hybrid'), 'hybrid');
  assert.equal(normalizeWorkplaceType('remote'), 'remote');
  assert.equal(normalizeWorkplaceType('On-site'), 'onsite');
  assert.equal(normalizeWorkplaceType('onsite'), 'onsite');
  assert.equal(normalizeWorkplaceType(null, true), 'remote');
  assert.equal(normalizeWorkplaceType(null, false), null);
  assert.equal(normalizeWorkplaceType(null), null);
  // a value always wins over the flag: a hybrid role whose location says
  // "remote" is still hybrid
  assert.equal(normalizeWorkplaceType('Hybrid', true), 'hybrid');
});

test('enrich: adds derived fields and leaves the raw ones alone', () => {
  const job = { title: 'Senior Backend Engineer', employmentType: 'Full-time', workplaceType: 'remote', isRemote: true };
  const same = enrich(job);
  assert.equal(same, job, 'enrich returns the job it was given');
  assert.equal(job.seniority, 'senior');
  assert.equal(job.employmentTypeNorm, 'fulltime');
  assert.equal(job.workplaceTypeNorm, 'remote');
  assert.equal(job.employmentType, 'Full-time', 'raw value untouched — it is the public contract');
  assert.equal(job.workplaceType, 'remote');
});

// ---- parseSeniorityFilter ---------------------------------------------------
test('parseSeniorityFilter: trims, lowercases, drops unknowns, null when empty', () => {
  assert.deepEqual(parseSeniorityFilter(' Senior, STAFF ,principal '), ['senior', 'staff', 'principal']);
  assert.deepEqual(parseSeniorityFilter('senior,senior'), ['senior']);
  assert.deepEqual(parseSeniorityFilter('senior, wizard'), ['senior'], 'unknown values are ignored, not an error');
  assert.equal(parseSeniorityFilter(''), null);
  assert.equal(parseSeniorityFilter('   '), null);
  assert.equal(parseSeniorityFilter(null), null);
  assert.equal(parseSeniorityFilter('wizard, ninja'), null, 'nothing known -> filter off, never "match nothing"');
});

// ---- pipeline: derived fields on emitted jobs -------------------------------
test('pipeline: emitted jobs carry the derived fields', async () => {
  const sink = collectSink();
  await runScrape(
    { companies: ['lever:acme'], _nowMs: T0 },
    sink,
    fakeFetch([['api.lever.co/v0/postings/acme', fx.leverPayload]]),
  );
  assert.equal(sink.jobs.length, 1);
  const j = sink.jobs[0];
  assert.equal(j.title, 'Senior Backend Engineer');
  assert.equal(j.seniority, 'senior');
  assert.equal(j.employmentTypeNorm, 'fulltime');
  assert.equal(j.workplaceTypeNorm, 'remote');
  assert.equal(j.employmentType, 'Full-time', 'raw fields unchanged');
  assert.equal(j.workplaceType, 'remote');
});

// ---- pipeline: seniorityFilter ---------------------------------------------
test('pipeline: seniorityFilter keeps only the listed levels and drops the unknowns', async () => {
  const board = ghBoard('acme', ['Staff Software Engineer', 'Senior Data Analyst', 'Software Engineer', 'Marketing Intern']);
  const sink = collectSink();
  const summary = await runScrape(
    { companies: ['greenhouse:acme'], seniorityFilter: ' Senior , staff ', _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('acme'), board]]),
  );
  assert.deepEqual(sink.jobs.map((j) => j.title).sort(), ['Senior Data Analyst', 'Staff Software Engineer']);
  assert.deepEqual(sink.jobs.map((j) => j.seniority).sort(), ['senior', 'staff']);
  assert.equal(summary.totalJobs, 2);
  assert.equal(summary.totalFiltered, 2, 'the plain title (seniority null) and the intern are filtered out');
});

test('pipeline: an all-unknown seniorityFilter warns and keeps everything', async () => {
  const board = ghBoard('acme', ['Software Engineer', 'Senior Software Engineer']);
  const sink = collectSink();
  const warnings = [];
  sink.log = { info() {}, warning: (m) => warnings.push(m) };
  const summary = await runScrape(
    { companies: ['greenhouse:acme'], seniorityFilter: 'wizard', _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('acme'), board]]),
  );
  assert.equal(summary.totalJobs, 2, 'a typo must not silently empty the run');
  assert.match(warnings.join('\n'), /seniorityFilter/);
});

// ---- pipeline: maxTotalJobs -------------------------------------------------
test('pipeline: maxTotalJobs caps the whole run exactly and reports it', async () => {
  const sink = collectSink();
  const summary = await runScrape(
    {
      companies: ['greenhouse:alpha', 'greenhouse:beta'],
      maxTotalJobs: 3,
      _nowMs: T0,
    },
    sink,
    fakeFetch([
      [ghUrl('alpha'), ghBoard('alpha', ['Engineer A1', 'Engineer A2', 'Engineer A3'])],
      [ghUrl('beta'), ghBoard('beta', ['Engineer B1', 'Engineer B2', 'Engineer B3'])],
    ]),
  );

  assert.equal(sink.jobs.length, 3, 'exact, no overshoot from the concurrent pool');
  assert.equal(summary.totalJobs, 3);
  assert.equal(summary.capped, 3, 'the three jobs we stopped short of');
  assert.equal(summary.cappedAtMaxTotalJobs, true);
  assert.equal(summary.maxTotalJobs, 3);
  assert.equal(summary.totalFiltered, 0, 'capped is not filtered — nothing was wrong with those jobs');
});

test('pipeline: maxTotalJobs 0 / absent is unlimited and adds no summary noise', async () => {
  const routes = [[ghUrl('alpha'), ghBoard('alpha', ['Engineer A1', 'Engineer A2', 'Engineer A3'])]];
  for (const maxTotalJobs of [0, undefined]) {
    const sink = collectSink();
    const summary = await runScrape({ companies: ['greenhouse:alpha'], maxTotalJobs, _nowMs: T0 }, sink, fakeFetch(routes));
    assert.equal(sink.jobs.length, 3);
    assert.equal('capped' in summary, false);
    assert.equal('cappedAtMaxTotalJobs' in summary, false);
  }
});

test('pipeline: a cap that is never reached is still reported, at zero', async () => {
  const sink = collectSink();
  const summary = await runScrape(
    { companies: ['greenhouse:alpha'], maxTotalJobs: 50, _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('alpha'), ghBoard('alpha', ['Engineer A1', 'Engineer A2'])]]),
  );
  assert.equal(sink.jobs.length, 2);
  assert.equal(summary.capped, 0);
  assert.equal(summary.cappedAtMaxTotalJobs, false);
});

test('monitor new-only + maxTotalJobs: capped jobs stay out of the saved state', async () => {
  const routes = [
    [ghUrl('alpha'), ghBoard('alpha', ['Engineer A1', 'Engineer A2', 'Engineer A3'])],
    [ghUrl('beta'), ghBoard('beta', ['Engineer B1', 'Engineer B2', 'Engineer B3'])],
  ];
  const base = {
    companies: ['greenhouse:alpha', 'greenhouse:beta'],
    monitorMode: 'new-only',
    monitorId: 'unit',
    maxTotalJobs: 3,
  };
  const store = memoryStore();

  const first = monitorSink(store);
  const summary = await runScrape({ ...base, _nowMs: T0 }, first, fakeFetch(routes));
  assert.equal(first.jobs.length, 3);
  assert.equal(summary.newJobs, 3, 'only the delivered ones count as new');
  assert.equal(summary.capped, 3);
  assert.equal(summary.cappedAtMaxTotalJobs, true);
  assert.equal(
    Object.keys(store.value.jobs).length, 3,
    'a job held back by the cap was never delivered, so it must not be remembered as seen',
  );
  assert.deepEqual(
    Object.keys(store.value.jobs).sort(),
    first.jobs.map((j) => j.id).sort(),
    'the state is exactly what was emitted',
  );
  assert.equal(Object.keys(store.value.keys).length, 3, 'repost bookkeeping is rolled back too');

  // Next run, uncapped: the three held-back jobs must arrive, as new, with no
  // bogus repost flag.
  const second = monitorSink(store);
  const s2 = await runScrape({ ...base, maxTotalJobs: 0, _nowMs: T1 }, second, fakeFetch(routes));
  assert.equal(second.jobs.length, 3, 'the jobs the cap held back come back around');
  assert.equal(s2.newJobs, 3);
  for (const j of second.jobs) {
    assert.equal(j.isNew, true);
    assert.equal(j.repostedCount, 0, 'held back is not the same as removed-and-reposted');
    assert.equal(j.firstSeenAt, new Date(T1).toISOString());
  }
  assert.equal(Object.keys(store.value.jobs).length, 6);
});

test('monitor annotate + maxTotalJobs: already-known jobs consume the cap but keep their state', async () => {
  const routes = [[ghUrl('alpha'), ghBoard('alpha', ['Engineer A1', 'Engineer A2', 'Engineer A3'])]];
  const base = { companies: ['greenhouse:alpha'], monitorMode: 'annotate', monitorId: 'unit' };
  const store = memoryStore();

  await runScrape({ ...base, _nowMs: T0 }, monitorSink(store), fakeFetch(routes));
  const seenIds = Object.keys(store.value.jobs).sort();
  assert.equal(seenIds.length, 3);

  const second = monitorSink(store);
  const summary = await runScrape({ ...base, maxTotalJobs: 2, _nowMs: T1 }, second, fakeFetch(routes));
  assert.equal(second.jobs.length, 2);
  assert.equal(summary.capped, 1);
  assert.deepEqual(
    Object.keys(store.value.jobs).sort(), seenIds,
    'an already-delivered job skipped by the cap keeps its entry — it really was seen before',
  );
  for (const e of Object.values(store.value.jobs)) {
    assert.equal(e.firstSeenAt, new Date(T0).toISOString(), 'firstSeenAt stays sticky');
  }
});
