import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES } from '../src/sources/index.js';
import { makeJob } from '../src/normalize.js';
import { daysOpen, isStale, addFreshness } from '../src/freshness.js';
import { jobPassesFilters } from '../src/filters.js';
import { enrich } from '../src/enrich.js';
import * as fx from './fixtures/boards.js';

const CANON = ['id','source','company','companyName','title','department','team','location','locations','isRemote','workplaceType','employmentType','compensation','url','applyUrl','publishedAt','updatedAt'];

function normalizeAll(ats, payload, opts = {}) {
  const src = SOURCES[ats];
  return src.extract(payload).map((raw) => makeJob(src.transform(raw, { slug: 'acme' }), { source: ats, company: 'acme', ...opts, raw }));
}

test('greenhouse: canonical mapping, entity-decoded HTML, ISO dates', () => {
  const jobs = normalizeAll('greenhouse', fx.greenhousePayload, { includeDescription: true });
  assert.equal(jobs.length, 3);
  const j = jobs[0];
  for (const f of CANON) assert.ok(f in j, `missing field ${f}`);
  assert.equal(j.source, 'greenhouse');
  assert.equal(j.title, 'Staff Software Engineer, Payments');
  assert.equal(j.department, 'Engineering');
  assert.equal(j.employmentType, 'Full-time');
  assert.equal(j.isRemote, true);
  assert.equal(j.publishedAt, new Date('2026-07-20T09:00:00-04:00').toISOString());
  assert.match(j.descriptionHtml, /<p>Build &amp; scale payments infra\.<\/p>/);
  assert.equal(j.descriptionText, 'Build & scale payments infra.');
});

test('lever: salary range, workplaceType, epoch-ms publishedAt', () => {
  const [j] = normalizeAll('lever', fx.leverPayload);
  assert.equal(j.compensation.min, 90000);
  assert.equal(j.compensation.currency, 'GBP');
  assert.equal(j.compensation.summary, '£90k–£120k + equity');
  assert.equal(j.workplaceType, 'remote');
  assert.equal(j.isRemote, true);
  assert.equal(j.employmentType, 'Full-time');
  assert.equal(j.publishedAt, new Date(1755000000000).toISOString());
  assert.deepEqual(j.locations, ['London', 'Remote UK']);
});

test('ashby: unlisted jobs dropped, compensation summarised', () => {
  const jobs = normalizeAll('ashby', fx.ashbyPayload);
  assert.equal(jobs.length, 1, 'isListed:false must be dropped');
  const [j] = jobs;
  assert.equal(j.compensation.min, 200000);
  assert.equal(j.compensation.interval, '1 YEAR');
  assert.equal(j.compensation.summary, '$200K – $300K');
  assert.deepEqual(j.locations, ['San Francisco', 'New York']);
  assert.equal(j.isRemote, false);
});

test('workable: telecommuting => remote, company name from account payload', () => {
  const [j] = normalizeAll('workable', fx.workablePayload);
  assert.equal(j.companyName, 'Blueground');
  assert.equal(j.isRemote, true);
  assert.equal(j.workplaceType, 'remote');
  assert.equal(j.location, 'Athens, Attica, Greece');
  assert.equal(j.applyUrl, 'https://apply.workable.com/blueground/j/GR0W1/apply');
});

test('smartrecruiters: label unwrapping and hosted URL construction', () => {
  const [j] = normalizeAll('smartrecruiters', fx.smartrecruitersPayload);
  assert.equal(j.title, 'Solution Architect');
  assert.equal(j.department, 'Professional Services');
  assert.equal(j.employmentType, 'Full-time');
  assert.equal(j.url, 'https://jobs.smartrecruiters.com/acme/744000001');
});

test('recruitee: remote flag, apply url, salary and workplace mapping', () => {
  const [j, k] = normalizeAll('recruitee', fx.recruiteePayload);
  assert.equal(j.isRemote, true);
  assert.equal(j.workplaceType, 'remote');
  assert.equal(j.applyUrl, 'https://acme.recruitee.com/o/frontend-dev/c/new');
  assert.equal(j.location, 'Amsterdam, Netherlands');
  assert.deepEqual(j.compensation, { min: 4426, max: 6323, currency: 'EUR', interval: 'month', summary: '4426–6323 EUR/month' });
  assert.equal(j.updatedAt, new Date('2026-08-15 08:00:00 UTC').toISOString());
  assert.equal(k.workplaceType, 'hybrid', 'hybrid flag maps to workplaceType');
  assert.equal(k.compensation, null, 'empty salary object maps to null');
});

test('workday: thin list view maps to canonical fields, relative dates parsed', () => {
  const src = SOURCES.workday;
  const board = { origin: 'https://nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' };
  const jobs = src.extract(fx.workdayPayload).map((raw) => makeJob(src.transform({ ...raw, __board: board }), { source: 'workday', company: 'nvidia', raw }));
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].externalIdSeen, undefined);
  assert.equal(jobs[0].title, 'Senior AI Tools Engineer');
  assert.equal(jobs[0].location, null, '"2 Locations" is a placeholder, not a location');
  assert.equal(jobs[1].location, 'India, Bengaluru');
  assert.equal(jobs[0].url, 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Remote/Senior-AI-Tools-Engineer_JR2023138');
  const now = Date.parse('2026-08-27T12:00:00.000Z');
  assert.equal(src.approxPostedAt('Posted Today', now), '2026-08-27T12:00:00.000Z');
  assert.equal(src.approxPostedAt('Posted 5 Days Ago', now), '2026-08-22T12:00:00.000Z');
  assert.equal(src.approxPostedAt('Posted 30+ Days Ago', now), '2026-07-28T12:00:00.000Z');
  assert.equal(src.approxPostedAt('Posted Yesterday', now), '2026-08-26T12:00:00.000Z');
  assert.equal(src.approxPostedAt(undefined), null);
});

test('workday: board URLs parse for both host layouts, junk is rejected', () => {
  const { parseBoardUrl } = SOURCES.workday;
  assert.deepEqual(
    parseBoardUrl('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite'),
    { host: 'nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite', origin: 'https://nvidia.wd5.myworkdayjobs.com' },
  );
  assert.equal(parseBoardUrl('https://wd1.myworkdaysite.com/recruiting/gartner/EXT').tenant, 'gartner');
  assert.equal(parseBoardUrl('https://wd1.myworkdaysite.com/recruiting/gartner/EXT').site, 'EXT');
  assert.throws(() => parseBoardUrl('https://nvidia.wd5.myworkdayjobs.com/'), /missing the tenant or career-site/);
});

test('personio: XML feed with CDATA, extra offices and built job URL', () => {
  const src = SOURCES.personio;
  const raws = src.extract(fx.personioXml);
  assert.equal(raws.length, 1);
  const j = makeJob(src.transform(raws[0], { slug: 'personio' }), { source: 'personio', company: 'personio', includeDescription: true });
  assert.equal(j.title, 'Staff Software Engineer, Data Platform');
  assert.equal(j.companyName, 'Personio SE & Co. KG', 'XML entities must be decoded');
  assert.deepEqual(j.locations, ['Munich', 'Berlin']);
  assert.equal(j.department, 'Product and Tech');
  assert.equal(j.employmentType, 'full-time');
  assert.equal(j.url, 'https://personio.jobs.personio.de/job/1834171');
  assert.equal(j.publishedAt, new Date('2024-11-13T14:10:41+00:00').toISOString());
  // CDATA holds raw HTML: entities stay encoded in the HTML, decoded in the text
  assert.match(j.descriptionHtml, /<h3>Your role<\/h3><p>Build &amp; scale\.<\/p>/);
  assert.equal(j.descriptionText, 'Your role Build & scale.');
});

test('breezy: free-text salary parsed into the unified compensation object', () => {
  const [j] = normalizeAll('breezy', fx.breezyPayload);
  assert.equal(j.companyName, 'Acme Inc');
  assert.equal(j.isRemote, true);
  assert.equal(j.employmentType, 'Full-Time');
  assert.deepEqual(j.locations, ['Miami, FL', 'Remote, US']);
  assert.deepEqual(j.compensation, { min: 120000, max: 150000, currency: 'USD', interval: 'year', summary: '$120,000 – $150,000 / year' });
  const { parseSalary } = SOURCES.breezy;
  assert.deepEqual(parseSalary('€45k – €60k per year'), { min: 45000, max: 60000, currency: 'EUR', interval: 'year', summary: '€45k – €60k per year' });
  assert.equal(parseSalary(''), null);
  assert.equal(parseSalary(undefined), null);
});

test('rippling: label unwrapping and remote inference from location text', () => {
  const [j] = normalizeAll('rippling', fx.ripplingPayload);
  assert.equal(j.title, 'Account Executive - Remote');
  assert.equal(j.department, 'Sales');
  assert.equal(j.location, 'New York, NY');
  assert.equal(j.isRemote, true, 'remote in the title must be inferred');
  assert.equal(j.url, 'https://ats.rippling.com/acme/jobs/2f0674e6');
});

test('pinpoint: canonical mapping, compensation published and hidden', () => {
  const jobs = normalizeAll('pinpoint', fx.pinpointPayload, { includeDescription: true });
  assert.equal(jobs.length, 2);
  const [paid, hidden] = jobs;
  for (const f of CANON) assert.ok(f in paid, `missing field ${f}`);
  assert.equal(paid.title, 'Marketing Manager');
  assert.equal(paid.department, 'Operations');
  assert.equal(paid.team, 'Hooli', 'division is the closest thing to a team');
  assert.equal(paid.location, 'Paris');
  assert.equal(paid.employmentType, 'Full Time');
  assert.equal(paid.workplaceType, 'onsite');
  assert.equal(paid.isRemote, false);
  assert.deepEqual(paid.compensation, { min: 48000, max: 75000, currency: 'GBP', interval: 'year', summary: '£48,000 - £75,000 / year' });
  assert.equal(paid.url, 'https://acme.pinpointhq.com/en/postings/178aabc4-04c0-4582-973e-5033838c1002');
  assert.equal(paid.publishedAt, null, 'the API publishes no posting date');
  assert.equal(paid.descriptionText, 'Grow & scale the brand.');
  assert.equal(hidden.compensation, null, 'compensation_visible:false must publish nothing');
  assert.equal(hidden.workplaceType, 'remote');
  assert.equal(hidden.isRemote, true);
  assert.equal(hidden.location, 'Remote', 'the location label wins over its city/province parts');
  assert.equal(hidden.team, null);
  const { pickCompensation } = SOURCES.pinpoint;
  assert.equal(pickCompensation({ compensation: 'Competitive', compensation_visible: true }), null, 'text with no number is not comparable pay');
  assert.deepEqual(
    pickCompensation({ compensation: null, compensation_minimum: 60000, compensation_currency: 'EUR', compensation_frequency: 'year', compensation_visible: true }),
    { min: 60000, max: null, currency: 'EUR', interval: 'year', summary: '60000 EUR/year' },
  );
});

test('teamtailor: RSS items, multi-location, RFC822 dates, escaped HTML', () => {
  const src = SOURCES.teamtailor;
  const raws = src.extract(fx.teamtailorRss);
  assert.equal(raws.length, 2);
  const jobs = raws.map((raw) => makeJob(src.transform(raw), { source: 'teamtailor', company: 'acme', includeDescription: true, raw }));
  const [apac, finance] = jobs;
  for (const f of CANON) assert.ok(f in apac, `missing field ${f}`);
  assert.equal(apac.companyName, 'Acme', 'company name comes from the channel title');
  assert.equal(apac.title, 'Partnership Manager - APAC');
  assert.equal(apac.department, 'Partnerships');
  assert.equal(apac.team, 'Partnerships Manager');
  assert.deepEqual(apac.locations, ['Sydney, Australia', 'Melbourne, Australia']);
  assert.equal(apac.location, 'Sydney, Australia');
  assert.equal(apac.workplaceType, 'onsite', "remoteStatus 'none' is onsite");
  assert.equal(apac.employmentType, null);
  assert.equal(apac.compensation, null, 'the feed carries no pay data');
  assert.equal(apac.url, 'https://acme.teamtailor.com/jobs/8144170-partnership-manager-apac');
  assert.equal(apac.applyUrl, apac.url);
  assert.equal(apac.publishedAt, new Date('Wed, 29 Jul 2026 15:03:12 +0200').toISOString());
  assert.match(apac.descriptionHtml, /^<p>Build &amp; scale partnerships\.<\/p>$/, 'the escaped HTML must be decoded once');
  assert.equal(apac.descriptionText, 'Build & scale partnerships.');
  assert.equal(finance.workplaceType, 'hybrid');
  assert.deepEqual(finance.locations, ['Stockholm, Sweden'], 'an empty tt:name falls back to city + country');
  assert.equal(finance.team, null);
  assert.equal(finance.isRemote, false);
});

test('includeRaw never leaks adapter-internal __ keys', () => {
  const src = SOURCES.workday;
  const raw = { ...fx.workdayPayload.jobPostings[0], __board: { origin: 'https://x', tenant: 't', site: 's' }, __detail: null };
  const j = makeJob(src.transform(raw), { source: 'workday', company: 't', includeRaw: true, raw });
  assert.ok(!('__board' in j.raw) && !('__detail' in j.raw));
  assert.equal(j.raw.title, 'Senior AI Tools Engineer');
});

test('all adapters: stable ids are deterministic and 16 hex chars', () => {
  for (const [ats, payload] of [['greenhouse', fx.greenhousePayload], ['lever', fx.leverPayload], ['ashby', fx.ashbyPayload], ['workable', fx.workablePayload], ['smartrecruiters', fx.smartrecruitersPayload], ['recruitee', fx.recruiteePayload], ['breezy', fx.breezyPayload], ['rippling', fx.ripplingPayload], ['pinpoint', fx.pinpointPayload], ['teamtailor', fx.teamtailorRss]]) {
    const a = normalizeAll(ats, payload);
    const b = normalizeAll(ats, payload);
    assert.ok(a.length >= 1, `${ats} produced no jobs`);
    assert.equal(a[0].id, b[0].id, `${ats} id not deterministic`);
    assert.match(a[0].id, /^[0-9a-f]{16}$/);
  }
});

test('descriptions excluded by default, raw excluded by default', () => {
  const [j] = normalizeAll('lever', fx.leverPayload);
  assert.ok(!('descriptionHtml' in j));
  assert.ok(!('raw' in j));
  const [k] = normalizeAll('lever', fx.leverPayload, { includeDescription: true, includeRaw: true });
  assert.equal(k.descriptionText, 'APIs all day.');
  assert.equal(k.raw.id, 'abc-123');
});

// ---- sources and signals added in 1.2 --------------------------------------

test('oracle: requisition mapping, job URL built from tenant + site', () => {
  const src = SOURCES.oracle;
  const board = { origin: 'https://acme.fa.us2.oraclecloud.com', site: 'CX_1' };
  const raw = {
    Id: '335394', Title: 'Clinical Imaging Consultant', PostedDate: '2026-08-25',
    PrimaryLocation: 'Kansas City, MO', WorkplaceType: 'Remote', JobSchedule: 'Full time',
    Department: 'Health', BusinessUnit: 'Oracle Health', ShortDescriptionStr: '<p>Imaging.</p>',
    __board: board,
  };
  const j = makeJob(src.transform(raw), { source: 'oracle', company: 'acme', includeDescription: true });
  assert.equal(j.title, 'Clinical Imaging Consultant');
  assert.equal(j.employmentType, 'Full time');
  assert.equal(j.isRemote, true);
  assert.equal(j.url, 'https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/335394');
  assert.equal(j.publishedAt, new Date('2026-08-25').toISOString());
  assert.equal(j.descriptionText, 'Imaging.');
  assert.equal(src.parseBoardUrl('https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions').site, 'CX_1');
  assert.throws(() => src.parseBoardUrl('https://acme.fa.us2.oraclecloud.com/hcmUI/'), /missing the site number/);
});

test('eightfold: epoch seconds to ISO, remote from work_location_option', () => {
  const src = SOURCES.eightfold;
  const raw = {
    id: 562949978415450, name: 'Senior QC Chemist', ats_job_id: '881578',
    location: 'Brisbane,Queensland,Australia', locations: ['Brisbane,Queensland,Australia', 'Pinkenba,Queensland,Australia'],
    department: 'Chemical R&D', business_unit: 'Crop Science',
    t_create: 1787097600, t_update: 1787206012, work_location_option: 'remote',
    canonicalPositionUrl: 'https://talent.acme.com/careers/job/562949978415450',
  };
  const j = makeJob(src.transform(raw), { source: 'eightfold', company: 'acme' });
  assert.equal(j.externalId, undefined);
  assert.equal(j.title, 'Senior QC Chemist');
  assert.equal(j.isRemote, true);
  assert.equal(j.publishedAt, new Date(1787097600000).toISOString());
  assert.equal(j.updatedAt, new Date(1787206012000).toISOString());
  assert.equal(j.locations.length, 2);
  assert.equal(src.url('bayer'), 'https://bayer.eightfold.ai/api/apply/v2/jobs?start=0&num=100');
});

test('freshness: daysOpen and isStale derived from the posting date', () => {
  const now = Date.parse('2026-08-27T00:00:00.000Z');
  assert.equal(daysOpen('2026-08-27T00:00:00.000Z', now), 0);
  assert.equal(daysOpen('2026-08-20T00:00:00.000Z', now), 7);
  assert.equal(daysOpen(null, now), null, 'undated jobs must not be guessed');
  assert.equal(daysOpen('not-a-date', now), null);
  assert.equal(isStale(7), false);
  assert.equal(isStale(75), true, '60 days is the default ghost-job threshold');
  assert.equal(isStale(null), null);
  const job = addFreshness({ publishedAt: '2026-06-01T00:00:00.000Z' }, { now });
  assert.equal(job.daysOpen, 87);
  assert.equal(job.isStale, true);
});

test('filters: hasSalary, salaryMin and maxDaysOpen', () => {
  const f = (job, o) => jobPassesFilters(job, { parsedQuery: null, locationFilter: null, remoteOnly: false, postedAfterIso: null, ...o });
  // salaryMin is an ANNUAL USD floor and reads `compensationAnnualUsd`, which
  // `enrich` derives — so these fixtures carry a currency and an interval and
  // go through enrich, exactly like a real pipeline job. `hasSalary` still
  // looks at the raw `compensation` only: it asks whether pay was published,
  // not whether it is comparable.
  const paid = enrich({ title: 'X', compensation: { min: 90000, max: 120000, currency: 'USD', interval: 'year' }, daysOpen: 10 });
  const unpaid = enrich({ title: 'X', compensation: null, daysOpen: 10 });
  const unconvertible = enrich({ title: 'X', compensation: { min: 90000, max: 120000, currency: 'XBT', interval: 'year' }, daysOpen: 10 });
  assert.equal(f(paid, { hasSalary: true }), true);
  assert.equal(f(unpaid, { hasSalary: true }), false);
  assert.equal(f(paid, { salaryMin: 100000 }), true, 'compares against the top of the range');
  assert.equal(f(paid, { salaryMin: 130000 }), false);
  assert.equal(f(unpaid, { salaryMin: 50000 }), false, 'no published pay cannot satisfy a floor');
  assert.equal(f(unconvertible, { salaryMin: 50000 }), false, 'an unconvertible currency is not comparable either');
  assert.equal(f(unconvertible, { hasSalary: true }), true, 'but the pay *was* published');
  assert.equal(f({ ...paid, daysOpen: 90 }, { maxDaysOpen: 30 }), false);
  assert.equal(f({ ...paid, daysOpen: null }, { maxDaysOpen: 30 }), true, 'undated jobs are kept');
});
