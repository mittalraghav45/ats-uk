import test from 'node:test';
import assert from 'node:assert/strict';
import { runScrape, parseTarget } from '../src/scrape.js';
import { jobPassesFilters, parseQuery, matchesQuery } from '../src/filters.js';
import { makeDeduper } from '../src/dedupe.js';
import { fetchJson, HttpError } from '../src/http.js';
import * as fx from './fixtures/boards.js';

// ---- fake fetch that serves fixtures by URL pattern ------------------------
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

// ---- parseTarget ------------------------------------------------------------
test('parseTarget: ats:slug, bare slug, object form, junk', () => {
  assert.deepEqual(parseTarget('greenhouse:stripe'), { ats: 'greenhouse', slug: 'stripe', company: 'stripe' });
  assert.deepEqual(parseTarget('  ashby: openai '), { ats: 'ashby', slug: 'openai', company: 'openai' });
  assert.deepEqual(parseTarget('stripe'), { ats: null, slug: 'stripe', company: 'stripe' });
  assert.deepEqual(parseTarget({ ats: 'lever', id: 'acme' }), { ats: 'lever', slug: 'acme', company: 'acme' });
  assert.equal(parseTarget(''), null);
  assert.equal(parseTarget(null), null);
  // unknown prefix is treated as a bare slug, not silently dropped
  assert.deepEqual(parseTarget('foobar:acme'), { ats: null, slug: 'foobar:acme', company: 'foobar:acme' });
});

test('parseTarget: careers URLs route to the right ATS', () => {
  const cases = [
    ['https://boards.greenhouse.io/stripe', 'greenhouse', 'stripe'],
    ['https://job-boards.greenhouse.io/acme/jobs/123', 'greenhouse', 'acme'],
    ['https://jobs.lever.co/leverdemo', 'lever', 'leverdemo'],
    ['https://jobs.ashbyhq.com/openai', 'ashby', 'openai'],
    ['https://apply.workable.com/blueground/', 'workable', 'blueground'],
    ['https://careers.smartrecruiters.com/Acme', 'smartrecruiters', 'Acme'],
    ['https://greenchoice.recruitee.com/', 'recruitee', 'greenchoice'],
    ['https://acme.breezy.hr/p/xyz', 'breezy', 'acme'],
    ['https://enpal.jobs.personio.de/', 'personio', 'enpal'],
    ['https://ats.rippling.com/acme/jobs', 'rippling', 'acme'],
  ];
  for (const [url, ats, company] of cases) {
    const t = parseTarget(url);
    assert.equal(t.ats, ats, `${url} -> ${t.ats}`);
    assert.equal(t.company, company, `${url} company`);
  }
  // Workday keeps the whole URL as the slug (tenant + site live in the path)
  const wd = parseTarget('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite');
  assert.equal(wd.ats, 'workday');
  assert.equal(wd.company, 'nvidia');
  // an unrecognised URL is flagged, never probed as if it were a slug
  assert.equal(parseTarget('https://example.com/careers').unknownUrl, true);
});

// ---- filters ----------------------------------------------------------------
test('query: comma = OR, space = AND, case-insensitive', () => {
  const q = parseQuery('senior engineer, staff engineer');
  assert.equal(matchesQuery('Senior Backend Engineer', q), true);
  assert.equal(matchesQuery('Staff Engineer, Payments', q), true);
  assert.equal(matchesQuery('Junior Engineer', q), false);
  assert.equal(matchesQuery(null, q), false);
  assert.equal(matchesQuery('anything', parseQuery('  ')), true);
});

test('filters: location, remoteOnly, postedAfter keeps undated jobs', () => {
  const base = { title: 'X', location: 'Milan, Italy', locations: ['Milan, Italy'], isRemote: false, publishedAt: '2026-01-01T00:00:00.000Z' };
  const f = (job, o) => jobPassesFilters(job, { parsedQuery: null, locationFilter: null, remoteOnly: false, postedAfterIso: null, ...o });
  assert.equal(f(base, { locationFilter: 'milan' }), true);
  assert.equal(f(base, { locationFilter: 'berlin' }), false);
  assert.equal(f(base, { remoteOnly: true }), false);
  assert.equal(f({ ...base, isRemote: true }, { remoteOnly: true }), true);
  assert.equal(f(base, { postedAfterIso: '2026-06-01T00:00:00.000Z' }), false);
  assert.equal(f({ ...base, publishedAt: null, updatedAt: null }, { postedAfterIso: '2026-06-01T00:00:00.000Z' }), true, 'undated jobs must be kept');
});

// ---- dedupe -----------------------------------------------------------------
test('dedupe: same company+title+location collapses, counter counts', () => {
  const d = makeDeduper();
  const j = { company: 'acme', title: 'Staff  Engineer!', location: 'Remote — EMEA' };
  assert.equal(d.keep(j), true);
  assert.equal(d.keep({ company: 'acme', title: 'staff engineer', location: 'remote emea' }), false, 'punctuation/case must not defeat dedupe');
  assert.equal(d.keep({ company: 'other', title: 'staff engineer', location: 'remote emea' }), true);
  assert.equal(d.dropped, 1);
});

// ---- http retry -------------------------------------------------------------
test('fetchJson: retries 5xx then succeeds; 404 throws immediately as notFound', async () => {
  let n = 0;
  const flaky = async () => (++n < 3 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ fine: true }) });
  const out = await fetchJson('https://x.test/a', { fetchImpl: flaky, retries: 3 });
  assert.deepEqual(out, { fine: true });
  assert.equal(n, 3);

  let calls = 0;
  const notFound = async () => { calls++; return { ok: false, status: 404, json: async () => ({}) }; };
  await assert.rejects(
    () => fetchJson('https://x.test/b', { fetchImpl: notFound, retries: 3 }),
    (e) => e instanceof HttpError && e.notFound,
  );
  assert.equal(calls, 1, '404 must not be retried');
});

// ---- full pipeline ----------------------------------------------------------
test('pipeline: explicit boards, dedupe across duplicates, summary math', async () => {
  const fetchImpl = fakeFetch([
    ['boards-api.greenhouse.io/v1/boards/acme/jobs', fx.greenhousePayload],
    ['api.lever.co/v0/postings/acme', fx.leverPayload],
  ]);
  const sink = collectSink();
  const summary = await runScrape({ companies: ['greenhouse:acme', 'lever:acme'], dedupe: true }, sink, fetchImpl);
  // greenhouse fixture has an exact duplicate posting -> one dropped
  assert.equal(summary.totalDuplicates, 1);
  assert.equal(summary.totalJobs, 3);
  assert.equal(sink.jobs.length, 3);
  assert.equal(summary.failures, 0);
  const ids = new Set(sink.jobs.map((j) => j.id));
  assert.equal(ids.size, 3, 'ids must be unique');
});

test('pipeline: filters + maxJobsPerCompany + failure isolation', async () => {
  const fetchImpl = fakeFetch([
    ['boards-api.greenhouse.io/v1/boards/acme/jobs', fx.greenhousePayload],
    ['boards-api.greenhouse.io/v1/boards/dead/jobs', 500],
  ]);
  const sink = collectSink();
  const summary = await runScrape({
    companies: ['greenhouse:acme', 'greenhouse:dead'],
    query: 'engineer', maxJobsPerCompany: 1, dedupe: false,
  }, sink, fetchImpl);
  assert.equal(sink.jobs.length, 1, 'maxJobsPerCompany must cap output');
  assert.equal(summary.failures, 1, 'a dead board must not kill the run');
  const failed = summary.boards.find((b) => !b.ok);
  assert.match(failed.error, /HTTP 500/);
});

test('pipeline: bare slug autodetects across ATSes and keeps every hit', async () => {
  const fetchImpl = fakeFetch([
    ['boards-api.greenhouse.io/v1/boards/acme/jobs', fx.greenhousePayload],
    ['api.ashbyhq.com/posting-api/job-board/acme', fx.ashbyPayload],
    // lever/workable/smartrecruiters/recruitee -> 404 from fakeFetch default
  ]);
  const sink = collectSink();
  const summary = await runScrape({ companies: ['acme'], dedupe: true }, sink, fetchImpl);
  const atses = summary.boards.filter((b) => b.ok).map((b) => b.ats).sort();
  assert.deepEqual(atses, ['ashby', 'greenhouse']);
  assert.equal(summary.totalJobs, 3, '2 unique greenhouse + 1 ashby');
});

test('pipeline: smartrecruiters pagination walks offsets', async () => {
  const page = (n) => ({ totalFound: 150, content: Array.from({ length: n }, (_, i) => ({ id: `id-${Math.random()}`, name: `Job ${i}`, location: { city: 'X' } })) });
  const fetchImpl = fakeFetch([
    ['offset=100', page(50)],
    ['offset=0', page(100)],
  ]);
  const sink = collectSink();
  const summary = await runScrape({ companies: ['smartrecruiters:acme'], dedupe: false }, sink, fetchImpl);
  assert.equal(summary.totalJobs, 150);
  assert.equal(fetchImpl.calls.filter((u) => u.includes('smartrecruiters')).length, 2);
});

test('pipeline: smartrecruiters pagination stops at maxJobsPerCompany', async () => {
  const page = (n) => ({ totalFound: 1000, content: Array.from({ length: n }, (_, i) => ({ id: `x-${i}`, name: `Job ${i}`, location: { city: 'X' } })) });
  const fetchImpl = fakeFetch([['/postings', page(100)]]);
  const sink = collectSink();
  await runScrape({ companies: ['smartrecruiters:acme'], maxJobsPerCompany: 100, dedupe: false }, sink, fetchImpl);
  assert.equal(fetchImpl.calls.length, 1, 'must not page past the requested cap');
});

test('pipeline: workday posts, paginates and builds job URLs', async () => {
  const posting = (i) => ({ title: `Engineer ${i}`, externalPath: `/job/US/Engineer_JR${i}`, locationsText: 'US, CA, Remote', postedOn: 'Posted Today', bulletFields: [`JR${i}`] });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body });
    const offset = JSON.parse(init.body).offset;
    // Workday reports `total` only on page 1 and 0 afterwards — paging must
    // survive that, or every board silently truncates to two pages.
    return { ok: true, status: 200, json: async () => (offset === 0
      ? { total: 30, jobPostings: Array.from({ length: 20 }, (_, i) => posting(i)) }
      : { total: 0, jobPostings: Array.from({ length: 10 }, (_, i) => posting(20 + i)) }) };
  };
  const sink = collectSink();
  const summary = await runScrape({ companies: ['https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite'], dedupe: false }, sink, fetchImpl);
  assert.equal(summary.totalJobs, 30, 'both pages walked');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs');
  const [j] = sink.jobs;
  assert.equal(j.source, 'workday');
  assert.equal(j.company, 'nvidia');
  assert.equal(j.url, 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/Engineer_JR0');
  assert.ok(j.publishedAt, '"Posted Today" must yield an approximate date');
});

test('pipeline: unsupported URL fails that board only, with a clear message', async () => {
  const fetchImpl = fakeFetch([['boards-api.greenhouse.io/v1/boards/acme/jobs', fx.greenhousePayload]]);
  const sink = collectSink();
  const summary = await runScrape({ companies: ['https://example.com/careers', 'greenhouse:acme'], dedupe: false }, sink, fetchImpl);
  assert.equal(summary.failures, 1);
  assert.match(summary.boards.find((b) => !b.ok).error, /not a supported job-board URL/);
  assert.ok(sink.jobs.length > 0, 'the good board still returns jobs');
});

test('pipeline: autodetect skips URL-only sources (no bogus Workday probe)', async () => {
  const fetchImpl = fakeFetch([['boards-api.greenhouse.io/v1/boards/acme/jobs', fx.greenhousePayload]]);
  await runScrape({ companies: ['acme'], dedupe: true }, collectSink(), fetchImpl);
  assert.equal(fetchImpl.calls.filter((u) => u.includes('workday')).length, 0);
  assert.ok(fetchImpl.calls.some((u) => u.includes('personio')), 'slug-based new sources are probed');
});

test('pipeline: empty companies input throws a helpful error', async () => {
  await assert.rejects(() => runScrape({ companies: [] }, collectSink(), fakeFetch([])), /companies/);
});
