/**
 * BOARD-STATUS (per-input hints + the CSV rendering of them) and the webhook
 * payload. Both are the parts of "delivery" that can be tested without the
 * SDK — main.js keeps only the two `setValue` calls and the POST.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../src/scrape.js';
import { HttpError } from '../src/http.js';
import { hintFor, filteredOutHint, boardStatusCsv, BOARD_STATUS_COLUMNS } from '../src/hints.js';
import { buildWebhookPayload, isDeliverableWebhookUrl, WEBHOOK_JOB_LIMIT } from '../src/webhook.js';

// ---- shared harness (same shape as pipeline.test.js) ------------------------
function fakeFetch(routes) {
  const impl = async (url) => {
    for (const [pattern, payload] of routes) {
      if (url.includes(pattern)) {
        if (typeof payload === 'number') return { ok: false, status: payload, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => payload, text: async () => String(payload) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return impl;
}

function collectSink() {
  const jobs = [];
  return { jobs, pushJobs: async (batch) => { jobs.push(...batch); }, log: { info() {}, warning() {} } };
}

const T0 = Date.parse('2026-08-20T00:00:00.000Z');

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

// ---- hintFor ----------------------------------------------------------------
test('hint: a 404 on a named ATS names the URL form the slug comes from', () => {
  const hint = hintFor(new HttpError('HTTP 404 for https://…', { status: 404 }), 'greenhouse', 'acme-inc');
  assert.match(hint, /not found on greenhouse/);
  assert.match(hint, /https:\/\/boards\.greenhouse\.io\/acme-inc/, 'the form, filled in with their slug');
  assert.match(hint, /board name in the careers URL, not the company name/);

  // Every ATS we support has a form to suggest, Workday and Oracle included.
  assert.match(hintFor(new HttpError('x', { status: 404 }), 'workday', 'https://x.wd5.myworkdayjobs.com/y'), /myworkdayjobs\.com/);
  assert.match(hintFor(new HttpError('x', { status: 404 }), 'recruitee', 'acme'), /acme\.recruitee\.com/);
});

test('hint: a bare slug that matched nothing is told to paste a careers URL', () => {
  const err = new HttpError('No ATS board found for "acme" on any of: greenhouse, lever, …', { status: 404 });
  const hint = hintFor(err, null, 'acme');
  assert.match(hint, /bare slug "acme"/);
  assert.match(hint, /greenhouse\.io\/acme/, 'the three most likely forms, not all twelve');
  assert.match(hint, /lever\.co\/acme/);
  assert.match(hint, /Workday and Oracle boards must be given as a full careers URL/);
});

test('hint: a server error says "retry", an unsupported URL says what it already said', () => {
  const transient = 'The board answered with a server error or did not answer in time — usually transient, retry the run.';
  assert.equal(hintFor(new HttpError('HTTP 503 for …', { status: 503 }), 'lever', 'acme'), transient);
  assert.equal(hintFor(new HttpError('Timeout for https://api.lever.co/…', {}), 'lever', 'acme'), transient);
  assert.equal(hintFor(new HttpError('HTTP 429 for …', { status: 429 }), 'lever', 'acme'), transient);

  const unsupported = '"https://acme.com/careers" is not a supported job-board URL. Supported: greenhouse, lever.';
  assert.equal(hintFor(new HttpError(unsupported, { status: 404 }), null, 'https://acme.com/careers'), unsupported,
    'the existing message already lists every supported ATS');

  assert.match(hintFor(new HttpError('HTTP 403 for …', { status: 403 }), 'ashby', 'acme'), /not public|bot filter/);
  // Nothing sensible to say is said as nothing, never as an invented cause.
  assert.equal(hintFor(new Error('something odd'), 'ashby', 'acme'), null);
});

// ---- filteredOutHint --------------------------------------------------------
test('hint: a board that worked and returned nothing blames the filters, with numbers', () => {
  const hint = filteredOutHint({ found: 25, kept: 0, filtered: 20, duplicates: 5 });
  assert.match(hint, /all 25 job\(s\) were dropped/);
  assert.match(hint, /20 by your filters/);
  assert.match(hint, /5 as duplicates/);

  // The remainder is the spend cap: they passed everything and were not paid for.
  assert.match(filteredOutHint({ found: 10, kept: 0, filtered: 2, duplicates: 0 }), /8 by the maxTotalJobs cap/);

  // Only when it actually happened.
  assert.equal(filteredOutHint({ found: 25, kept: 3, filtered: 22, duplicates: 0 }), null, 'something came out');
  assert.equal(filteredOutHint({ found: 0, kept: 0, filtered: 0, duplicates: 0 }), null, 'an empty board is not a filter problem');
  assert.equal(filteredOutHint(), null);
});

// ---- the CSV ----------------------------------------------------------------
test('csv: commas, quotes and newlines inside a field survive the round trip', () => {
  const csv = boardStatusCsv([
    { company: 'acme', ats: 'greenhouse', ok: true, found: 3, kept: 3, filtered: 0, duplicates: 0 },
    {
      company: 'Smith, Jones & Co',
      ats: null,
      ok: false,
      error: 'No ATS board found for "acme" on any of: greenhouse, lever',
      hint: 'Say "ats:acme" — the "slug" is the board name.',
    },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], BOARD_STATUS_COLUMNS.join(','));
  assert.equal(lines[1], 'acme,greenhouse,true,3,3,0,0,,', 'plain values are never quoted');
  // A comma forces quotes; an embedded quote is doubled; missing values are empty.
  assert.equal(
    lines[2],
    '"Smith, Jones & Co",,false,,,,,"No ATS board found for ""acme"" on any of: greenhouse, lever","Say ""ats:acme"" — the ""slug"" is the board name."',
  );
  assert.equal(lines[3], '', 'the file ends with a newline');
  assert.equal(boardStatusCsv([]), `${BOARD_STATUS_COLUMNS.join(',')}\r\n`);
  assert.equal(boardStatusCsv(null), `${BOARD_STATUS_COLUMNS.join(',')}\r\n`, 'never throws on a missing summary');
});

// ---- hints in the real summary ---------------------------------------------
test('pipeline: summary.boards carries a hint on the failures and on the zero-kept boards', async () => {
  const sink = collectSink();
  const summary = await runScrape(
    {
      companies: ['greenhouse:acme', 'greenhouse:does-not-exist'],
      query: 'nothing matches this',
      _nowMs: T0,
    },
    sink,
    fakeFetch([[ghUrl('acme'), ghBoard('acme', ['Backend Engineer', 'Recruiter'])]]),
  );

  const failed = summary.boards.find((b) => !b.ok);
  assert.match(failed.hint, /not found on greenhouse/);
  assert.match(failed.hint, /boards\.greenhouse\.io\/does-not-exist/);

  const emptied = summary.boards.find((b) => b.ok);
  assert.equal(emptied.kept, 0);
  assert.match(emptied.hint, /all 2 job\(s\) were dropped/);
  assert.match(emptied.hint, /2 by your filters/);
});

test('pipeline: a board that produced results carries no hint at all', async () => {
  const summary = await runScrape(
    { companies: ['greenhouse:acme'], _nowMs: T0 },
    collectSink(),
    fakeFetch([[ghUrl('acme'), ghBoard('acme', ['Backend Engineer'])]]),
  );
  assert.equal('hint' in summary.boards[0], false, 'a hint on a healthy board is noise');
});

// ---- the webhook payload ----------------------------------------------------
test('webhook: only https is deliverable', () => {
  assert.equal(isDeliverableWebhookUrl('https://hooks.example.com/abc'), true);
  assert.equal(isDeliverableWebhookUrl('  https://hooks.example.com/abc  '), true);
  assert.equal(isDeliverableWebhookUrl('http://hooks.example.com/abc'), false, 'the body carries the whole result set');
  assert.equal(isDeliverableWebhookUrl('ftp://example.com'), false);
  assert.equal(isDeliverableWebhookUrl('not a url'), false);
  assert.equal(isDeliverableWebhookUrl(''), false);
  assert.equal(isDeliverableWebhookUrl(null), false);
  assert.equal(isDeliverableWebhookUrl(undefined), false);
});

test('webhook: the payload separates jobs from removals and caps both', () => {
  const jobs = Array.from({ length: 250 }, (_, i) => ({ id: `j${i}`, title: `Job ${i}` }));
  const removed = Array.from({ length: 250 }, (_, i) => ({ id: `r${i}`, status: 'removed' }));
  const summary = { totalJobs: 250, boards: [] };

  const payload = buildWebhookPayload({ summary, jobs, removed, datasetId: 'ds1', runId: 'run1' });
  assert.equal(payload.event, 'run.finished');
  assert.equal(payload.summary, summary, 'the summary travels verbatim');
  assert.equal(payload.newJobs.length, WEBHOOK_JOB_LIMIT);
  assert.equal(payload.removed.length, WEBHOOK_JOB_LIMIT);
  assert.equal(payload.newJobs[0].id, 'j0', 'the first ones, not a random slice');
  assert.equal(payload.datasetId, 'ds1');
  assert.equal(payload.runId, 'run1');
});

test('webhook: removal records mixed into the job list still land in `removed`', () => {
  // main.js pushes both through the same sink, so the split has to be by
  // `status`, not by who handed the array over.
  const payload = buildWebhookPayload({
    summary: {},
    jobs: [{ id: 'a' }, { id: 'b', status: 'removed' }, { id: 'c' }],
  });
  assert.deepEqual(payload.newJobs.map((j) => j.id), ['a', 'c']);
  assert.deepEqual(payload.removed.map((j) => j.id), ['b']);
  assert.equal(payload.datasetId, null, 'null outside an Apify run, never undefined');
  assert.equal(payload.runId, null);
});

test('webhook: an empty run still produces a well-formed body', () => {
  const payload = buildWebhookPayload();
  assert.deepEqual(payload, { event: 'run.finished', summary: null, newJobs: [], removed: [], datasetId: null, runId: null });
});
