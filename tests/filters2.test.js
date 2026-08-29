/**
 * The 1.4 filters and signals: annualised pay, title excludes, full-text
 * description filters (fetched but not necessarily emitted) and technologies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../src/scrape.js';
import { annualizeCompensation, enrich, FX_TO_USD } from '../src/enrich.js';
import { extractTechnologies, TECHNOLOGY_COUNT } from '../src/tech.js';
import { jobPassesFilters, parseQuery, parseTechnologyFilter } from '../src/filters.js';

// ---- shared harness (same shape as pipeline.test.js) ------------------------
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

const T0 = Date.parse('2026-08-20T00:00:00.000Z');

/** A greenhouse-shaped board; `content` is the description the API returns. */
function ghBoard(slug, jobs) {
  return {
    jobs: jobs.map(({ title, content = '' }, n) => ({
      id: `${slug}-${n}`,
      title,
      absolute_url: `https://boards.greenhouse.io/${slug}/jobs/${n}`,
      location: { name: `City ${n}` },
      first_published: '2026-08-19T09:00:00-00:00',
      updated_at: '2026-08-19T09:00:00-00:00',
      company_name: slug,
      departments: [], offices: [], metadata: [], content,
    })),
  };
}
const ghUrl = (slug) => `boards/${slug}/jobs`;

/** Filter helper: only the keys under test have to be supplied. */
const passes = (job, o) => jobPassesFilters(job, { parsedQuery: null, locationFilter: null, remoteOnly: false, postedAfterIso: null, ...o });

// ---- annualizeCompensation --------------------------------------------------
test('annualize: every interval dialect lands on the same annual USD scale', () => {
  // 6000 EUR / month = 72,000 EUR = ~83.5k USD. This is the case the old
  // salaryMin got wrong: a 70k floor rejected it because 6000 < 70000.
  const eurMonth = annualizeCompensation({ min: 5000, max: 6000, currency: 'EUR', interval: 'month' });
  assert.ok(eurMonth.max > 70_000 && eurMonth.max < 90_000, `6000 EUR/month -> ${eurMonth.max} USD`);
  assert.equal(eurMonth.max, Math.round(6000 * 12 * FX_TO_USD.EUR));

  // Lever's dialect, and a currency worth more than the dollar.
  const gbpYear = annualizeCompensation({ min: 90000, max: 120000, currency: 'GBP', interval: 'per-year-salary' });
  assert.ok(gbpYear.min > 100_000, `90k GBP/year -> ${gbpYear.min} USD`);

  // Ashby's dialect.
  assert.deepEqual(
    annualizeCompensation({ min: 200000, max: 300000, currency: 'USD', interval: '1 YEAR' }),
    { min: 200000, max: 300000 },
  );

  // A US hourly rate: 2080 hours is the full-time year.
  assert.deepEqual(
    annualizeCompensation({ min: 55, max: 75, currency: 'USD', interval: 'hour' }),
    { min: 114_400, max: 156_000 },
  );

  // Day and week rates too.
  assert.equal(annualizeCompensation({ min: null, max: 500, currency: 'USD', interval: 'day' }).max, 130_000);
  assert.equal(annualizeCompensation({ min: null, max: 2000, currency: 'USD', interval: 'week' }).max, 104_000);
});

test('annualize: refuses rather than guesses', () => {
  assert.equal(annualizeCompensation(null), null);
  assert.equal(annualizeCompensation({ min: 1, max: 2, currency: null, interval: 'year' }), null, 'no currency, no conversion');
  assert.equal(annualizeCompensation({ min: 1, max: 2, currency: 'XBT', interval: 'year' }), null, 'unknown currency');
  assert.equal(annualizeCompensation({ min: null, max: null, currency: 'USD', interval: 'year' }), null, 'no numbers');
  // Interval missing: only a number big enough to be a yearly salary is read
  // as one. Everything else is ambiguous and stays null.
  assert.deepEqual(annualizeCompensation({ min: null, max: 120000, currency: 'USD', interval: null }), { min: null, max: 120000 });
  assert.equal(annualizeCompensation({ min: 30, max: 45, currency: 'USD', interval: null }), null, '45 with no interval is a rate, not a salary');
  assert.equal(annualizeCompensation({ min: 100, max: 120, currency: 'EUR', interval: 'per-fortnight' }), null, 'unrecognised interval + small number -> null');
  // Recruitee publishes its numbers as strings.
  assert.equal(annualizeCompensation({ min: '4426', max: '6323', currency: 'EUR', interval: 'month' }).max, Math.round(6323 * 12 * FX_TO_USD.EUR));
});

test('enrich: compensationAnnualUsd is always present, null when not computable', () => {
  assert.equal(enrich({ title: 'X', compensation: null }).compensationAnnualUsd, null);
  const j = enrich({ title: 'X', compensation: { min: 4426, max: 6323, currency: 'EUR', interval: 'month' } });
  assert.equal(typeof j.compensationAnnualUsd.max, 'number');
  assert.deepEqual(j.compensation, { min: 4426, max: 6323, currency: 'EUR', interval: 'month' }, 'the raw range is never rewritten');
});

// ---- salaryMin, on the annual USD scale -------------------------------------
test('salaryMin: a monthly EUR range is compared as an annual USD figure', () => {
  const eu = enrich({ title: 'Frontend Developer', compensation: { min: 4426, max: 6323, currency: 'EUR', interval: 'month' } });
  assert.equal(passes(eu, { salaryMin: 70_000 }), true, 'the bug: ~88k USD/yr used to fail a 70k floor because the raw number was 6323');
  assert.equal(passes(eu, { salaryMin: 150_000 }), false, 'and a floor it really is under still rejects it');

  const unpaid = enrich({ title: 'X', compensation: null });
  assert.equal(passes(unpaid, { salaryMin: 10_000 }), false, 'no published pay cannot satisfy a floor');

  const opaque = enrich({ title: 'X', compensation: { min: 100, max: 120, currency: 'EUR', interval: null } });
  assert.equal(passes(opaque, { salaryMin: 10_000 }), false, 'published but not comparable is dropped too');
});

// ---- excludeQuery -----------------------------------------------------------
test('excludeQuery: same syntax as query, opposite verdict', () => {
  const ex = parseQuery('internship, staffing agency');
  assert.equal(passes({ title: 'Machine Learning Internship' }, { parsedExcludeQuery: ex }), false);
  assert.equal(passes({ title: 'Staffing Agency Recruiter' }, { parsedExcludeQuery: ex }), false, 'space = AND inside one alternative');
  assert.equal(passes({ title: 'Staffing Coordinator' }, { parsedExcludeQuery: ex }), true, 'one word of an AND alternative is not a match');
  assert.equal(passes({ title: 'Senior Backend Engineer' }, { parsedExcludeQuery: ex }), true);
  assert.equal(passes({ title: 'Anything' }, { parsedExcludeQuery: null }), true, 'inactive filter must keep everything');
  assert.equal(passes({ title: null }, { parsedExcludeQuery: ex }), true, 'an untitled job matches nothing, so it is not excluded');
});

test('excludeQuery: matching is substring, exactly like query — documented, not fixed', () => {
  // `matchesQuery` is substring-based, so 'intern' catches 'Internal'. The two
  // filters must not disagree about what a keyword means, so this is kept and
  // spelled out in the input schema instead of being special-cased here.
  const short = parseQuery('intern');
  assert.equal(passes({ title: 'Internal Tools Engineer' }, { parsedExcludeQuery: short }), false);
  assert.equal(passes({ title: 'Internal Tools Engineer' }, { parsedExcludeQuery: parseQuery('internship') }), true, 'a longer word is the way out');
});

test('pipeline: query and excludeQuery combine', async () => {
  const board = ghBoard('acme', [
    { title: 'Senior Backend Engineer' },
    { title: 'Backend Engineering Intern' },
    { title: 'Marketing Manager' },
  ]);
  const sink = collectSink();
  await runScrape(
    { companies: ['greenhouse:acme'], query: 'engineer', excludeQuery: 'intern', _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('acme'), board]]),
  );
  assert.deepEqual(sink.jobs.map((j) => j.title), ['Senior Backend Engineer']);
});

// ---- description filters ----------------------------------------------------
test('descriptionQuery/Exclude: asymmetric on a missing description', () => {
  const withText = { title: 'X', descriptionText: 'We run Kubernetes on GCP.' };
  const noText = { title: 'X' };
  const q = parseQuery('kubernetes');

  assert.equal(passes(withText, { parsedDescriptionQuery: q }), true);
  assert.equal(passes({ title: 'X', descriptionText: 'We run Nomad.' }, { parsedDescriptionQuery: q }), false);
  assert.equal(passes(noText, { parsedDescriptionQuery: q }), false, 'boards that expose no description cannot match');

  assert.equal(passes(withText, { parsedDescriptionExclude: q }), false);
  assert.equal(passes(noText, { parsedDescriptionExclude: q }), true, 'no text means nothing matched, so there is nothing to exclude');

  // The AND/OR syntax is the same one `query` uses.
  assert.equal(passes(withText, { parsedDescriptionQuery: parseQuery('nomad, kubernetes gcp') }), true);
  assert.equal(passes(withText, { parsedDescriptionQuery: parseQuery('kubernetes aws') }), false);
});

test('pipeline: descriptionQuery fetches the text without emitting it', async () => {
  const board = ghBoard('acme', [
    { title: 'Platform Engineer', content: '<p>You will run Kubernetes clusters.</p>' },
    { title: 'Office Manager', content: '<p>You will run the office.</p>' },
  ]);
  const fetchImpl = fakeFetch([[ghUrl('acme'), board]]);
  const sink = collectSink();
  await runScrape(
    { companies: ['greenhouse:acme'], descriptionQuery: 'kubernetes', includeDescription: false, _nowMs: T0 },
    sink,
    fetchImpl,
  );

  assert.deepEqual(sink.jobs.map((j) => j.title), ['Platform Engineer'], 'the filter ran on text nobody asked to see');
  const [j] = sink.jobs;
  assert.equal('descriptionHtml' in j, false, 'fetched for the filter is not the same as asked for in the output');
  assert.equal('descriptionText' in j, false);
  assert.equal(JSON.stringify(j).includes('clusters'), false, 'and the text does not leak through serialisation either');
  // The adapter still had to be told to get the text.
  assert.ok(fetchImpl.calls.some((u) => u.includes('content=true')), 'greenhouse must be asked for content');
  // ...and the enrichment gets to use it.
  assert.deepEqual(j.technologies, ['Kubernetes']);
});

test('pipeline: includeDescription still emits the fields, filter or no filter', async () => {
  const board = ghBoard('acme', [{ title: 'Platform Engineer', content: '<p>You will run Kubernetes clusters.</p>' }]);
  const sink = collectSink();
  await runScrape(
    { companies: ['greenhouse:acme'], descriptionQuery: 'kubernetes', includeDescription: true, _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('acme'), board]]),
  );
  const [j] = sink.jobs;
  assert.match(j.descriptionHtml, /Kubernetes/);
  assert.match(j.descriptionText, /Kubernetes/);
});

test('pipeline: no description filter and no includeDescription -> no description fetch', async () => {
  const fetchImpl = fakeFetch([[ghUrl('acme'), ghBoard('acme', [{ title: 'Platform Engineer' }])]]);
  await runScrape({ companies: ['greenhouse:acme'], _nowMs: T0 }, collectSink(), fetchImpl);
  assert.equal(fetchImpl.calls.some((u) => u.includes('content=true')), false, 'the cheap path must stay cheap');
});

test('pipeline: descriptionExclude keeps the jobs whose board publishes nothing', async () => {
  // Greenhouse returns `content: ''` for these, i.e. no text at all.
  const board = ghBoard('acme', [
    { title: 'Engineer A', content: '<p>Requires an active security clearance.</p>' },
    { title: 'Engineer B', content: '' },
  ]);
  const sink = collectSink();
  await runScrape(
    { companies: ['greenhouse:acme'], descriptionExclude: 'security clearance', _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('acme'), board]]),
  );
  assert.deepEqual(sink.jobs.map((j) => j.title), ['Engineer B']);
});

// ---- extractTechnologies ----------------------------------------------------
test('extractTechnologies: canonical names, sorted, deduplicated', () => {
  assert.deepEqual(extractTechnologies('Senior Python Developer (Django, AWS)'), ['AWS', 'Django', 'Python']);
  assert.deepEqual(extractTechnologies('Python, python, PYTHON'), ['Python'], 'one canonical name per technology');
  assert.deepEqual(extractTechnologies(''), []);
  assert.deepEqual(extractTechnologies(null), []);
  assert.deepEqual(extractTechnologies(undefined), []);
  assert.deepEqual(extractTechnologies('   '), []);
  assert.ok(TECHNOLOGY_COUNT >= 200, `dictionary is ${TECHNOLOGY_COUNT} entries`);
});

test('extractTechnologies: the collisions the dictionary is built to survive', () => {
  assert.deepEqual(extractTechnologies('Java Engineer'), ['Java'], 'Java must not drag in JavaScript');
  assert.deepEqual(extractTechnologies('JavaScript Engineer'), ['JavaScript'], 'and JavaScript must not read as Java');
  assert.deepEqual(extractTechnologies('TypeScript Developer'), ['TypeScript']);
  assert.deepEqual(extractTechnologies('Go-to-market Manager'), [], 'the canonical false positive');
  assert.deepEqual(extractTechnologies('We need to go live in Q3'), []);
  assert.deepEqual(extractTechnologies('Senior Go Engineer'), ['Go'], 'but the real thing is still found');
  assert.deepEqual(extractTechnologies('Golang backend'), ['Go']);
  assert.deepEqual(extractTechnologies('C++ and C# on .NET'), ['.NET', 'C#', 'C++']);
  assert.deepEqual(extractTechnologies('Candidates who excel at communication'), [], '"excel at" is not Excel');
  assert.deepEqual(extractTechnologies('Advanced Microsoft Excel required'), ['Excel']);
  assert.deepEqual(extractTechnologies('Chef de Partie, evening service'), [], 'kitchens are not Chef the config tool');
  assert.deepEqual(extractTechnologies('MySQL replication'), ['MySQL'], 'SQL must not fall out of MySQL');
  assert.deepEqual(extractTechnologies('Oracle Database administrator'), ['Oracle Database']);
  assert.deepEqual(extractTechnologies('oracle'), [], 'our own source name is not a technology');
  assert.equal(extractTechnologies('R&D Manager, C-level exposure').length, 0, 'single letters are deliberately not in the dictionary');
});

test('enrich: technologies from the title, and from the description when there is one', () => {
  assert.deepEqual(enrich({ title: 'Senior Python Engineer' }).technologies, ['Python']);
  assert.deepEqual(
    enrich({ title: 'Senior Engineer', descriptionText: 'Terraform, AWS and PostgreSQL.' }).technologies,
    ['AWS', 'PostgreSQL', 'Terraform'],
  );
  assert.deepEqual(enrich({ title: 'Office Manager' }).technologies, [], 'always an array, never null');
  assert.deepEqual(enrich({ title: null }).technologies, []);
});

// ---- technologyFilter -------------------------------------------------------
test('parseTechnologyFilter: trims, lowercases, null when empty', () => {
  assert.deepEqual([...parseTechnologyFilter(' Python , AWS ')], ['python', 'aws']);
  assert.equal(parseTechnologyFilter(''), null);
  assert.equal(parseTechnologyFilter('   '), null);
  assert.equal(parseTechnologyFilter(null), null);
});

test('technologyFilter: comma = OR, and an empty tag list is dropped', () => {
  const wanted = parseTechnologyFilter('python, go');
  assert.equal(passes({ title: 'X', technologies: ['Python', 'Django'] }, { technologiesIn: wanted }), true);
  assert.equal(passes({ title: 'X', technologies: ['Go'] }, { technologiesIn: wanted }), true, 'any one of them is enough');
  assert.equal(passes({ title: 'X', technologies: ['Java'] }, { technologiesIn: wanted }), false);
  assert.equal(passes({ title: 'X', technologies: [] }, { technologiesIn: wanted }), false, 'nothing detected cannot match a stack');
  assert.equal(passes({ title: 'X' }, { technologiesIn: wanted }), false, 'and neither can a missing field');
  assert.equal(passes({ title: 'X', technologies: [] }, { technologiesIn: null }), true, 'inactive filter keeps everything');
  assert.equal(
    passes({ title: 'X', technologies: ['PostgreSQL'] }, { technologiesIn: parseTechnologyFilter('postgresql') }), true,
    'the canonical name is matched case-insensitively',
  );
});

test('pipeline: technologyFilter reads the description when one was fetched', async () => {
  // Mirrors the real API: Greenhouse only sends `content` when it is asked to,
  // so the same board answers differently depending on the fetch decision.
  const routes = [
    ['content=true', ghBoard('acme', [
      { title: 'Backend Engineer', content: '<p>Python, Django and PostgreSQL.</p>' },
      { title: 'Frontend Engineer', content: '<p>React and TypeScript.</p>' },
    ])],
    [ghUrl('acme'), ghBoard('acme', [{ title: 'Backend Engineer' }, { title: 'Frontend Engineer' }])],
  ];

  // Title-only: neither title names a technology, so both are dropped.
  const thin = collectSink();
  await runScrape({ companies: ['greenhouse:acme'], technologyFilter: 'python', _nowMs: T0 }, thin, fakeFetch(routes));
  assert.deepEqual(thin.jobs.map((j) => j.title), [], 'a title alone says nothing about the stack');

  // With the description fetched (here by a description filter), it works.
  const rich = collectSink();
  await runScrape(
    { companies: ['greenhouse:acme'], technologyFilter: 'python', descriptionQuery: 'python', _nowMs: T0 },
    rich,
    fakeFetch(routes),
  );
  assert.deepEqual(rich.jobs.map((j) => j.title), ['Backend Engineer']);
  assert.deepEqual(rich.jobs[0].technologies, ['Django', 'PostgreSQL', 'Python']);
  assert.equal('descriptionText' in rich.jobs[0], false, 'still not emitted');
});

test('pipeline: every emitted job carries technologies and compensationAnnualUsd', async () => {
  const sink = collectSink();
  await runScrape(
    { companies: ['greenhouse:acme'], _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('acme'), ghBoard('acme', [{ title: 'Office Manager' }])]]),
  );
  const [j] = sink.jobs;
  assert.deepEqual(j.technologies, [], 'present and empty, not absent');
  assert.equal(j.compensationAnnualUsd, null, 'present and null, not absent');
});
