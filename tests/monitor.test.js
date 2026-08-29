import test from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../src/scrape.js';
import { emptyState, diffRun } from '../src/state.js';
import { dedupeKey } from '../src/dedupe.js';
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

/** The key-value store main.js gives the scraper, reduced to a variable. */
function memoryStore(initial = null) {
  const store = { value: initial };
  store.loadState = async () => store.value;
  store.saveState = async (s) => { store.value = s; };
  return store;
}

function monitorSink(store) {
  const jobs = [];
  return {
    jobs,
    pushJobs: async (batch) => { jobs.push(...batch); },
    log: { info() {}, warning() {} },
    loadState: store.loadState,
    saveState: store.saveState,
  };
}

const GH = 'boards-api.greenhouse.io/v1/boards/acme/jobs';
const LEVER = 'api.lever.co/v0/postings/acme';
const T0 = Date.parse('2026-08-20T00:00:00.000Z');
const T1 = Date.parse('2026-08-21T00:00:00.000Z');
const T2 = Date.parse('2026-08-22T00:00:00.000Z');

/** greenhouse fixture minus the postings whose numeric id is listed. */
const ghWithout = (...drop) => ({ jobs: fx.greenhousePayload.jobs.filter((j) => !drop.includes(j.id)) });

const base = { companies: ['greenhouse:acme'], dedupe: true, monitorId: 'unit' };

// ---- runScrape wiring -------------------------------------------------------
test('monitor: first run on an empty state marks everything new and saves state', async () => {
  const store = memoryStore();
  const sink = monitorSink(store);
  const summary = await runScrape(
    { ...base, monitorMode: 'annotate', _nowMs: T0 },
    sink,
    fakeFetch([[GH, fx.greenhousePayload]]),
  );

  assert.equal(sink.jobs.length, 2, 'greenhouse fixture: 3 postings, 1 dropped as a duplicate');
  for (const j of sink.jobs) {
    assert.equal(j.isNew, true);
    assert.equal(j.firstSeenAt, new Date(T0).toISOString());
    assert.equal(j.repostedCount, 0);
    assert.equal(j.repostedAt, null, 'a first posting is not a repost');
  }
  assert.equal(summary.newJobs, 2);
  assert.equal(summary.unchangedJobs, 0);
  assert.equal(summary.removedJobs, 0);
  assert.equal(summary.monitorMode, 'annotate');

  const state = store.value;
  assert.equal(state.version, 1);
  assert.equal(state.monitorId, 'unit');
  assert.equal(state.updatedAt, new Date(T0).toISOString());
  assert.equal(Object.keys(state.jobs).length, 2);
  const entry = state.jobs[sink.jobs[0].id];
  assert.deepEqual(Object.keys(entry).sort(), ['boardKey', 'dedupeKey', 'firstSeenAt', 'lastSeenAt', 'title', 'url']);
  assert.equal(entry.boardKey, 'greenhouse:acme');
  assert.equal(Object.keys(state.keys).length, 2);
  assert.equal(Object.values(state.keys)[0].timesPosted, 1);
});

test('monitor: second identical run in new-only emits nothing and only refreshes lastSeenAt', async () => {
  const store = memoryStore();
  const fetchImpl = fakeFetch([[GH, fx.greenhousePayload]]);

  const first = monitorSink(store);
  await runScrape({ ...base, monitorMode: 'new-only', _nowMs: T0 }, first, fetchImpl);
  assert.equal(first.jobs.length, 2, 'run 1: everything is new');
  const idsAfterFirst = Object.keys(store.value.jobs).sort();

  const second = monitorSink(store);
  const summary = await runScrape({ ...base, monitorMode: 'new-only', _nowMs: T1 }, second, fetchImpl);

  assert.equal(second.jobs.length, 0, 'run 2 must not re-emit — and therefore not re-bill — known jobs');
  assert.equal(summary.newJobs, 0);
  assert.equal(summary.unchangedJobs, 2);
  assert.equal(summary.removedJobs, 0);
  assert.equal(summary.totalJobs, 2, 'totalJobs keeps its old meaning: jobs that passed filters + dedupe');

  assert.deepEqual(Object.keys(store.value.jobs).sort(), idsAfterFirst, 'nothing gained or lost');
  for (const e of Object.values(store.value.jobs)) {
    assert.equal(e.firstSeenAt, new Date(T0).toISOString(), 'firstSeenAt is sticky');
    assert.equal(e.lastSeenAt, new Date(T1).toISOString(), 'lastSeenAt follows the run');
  }
  for (const k of Object.values(store.value.keys)) assert.equal(k.timesPosted, 1, 'still posted once, not twice');
});

test('monitor: a job that disappears is emitted as a removed record and leaves the state', async () => {
  const store = memoryStore();
  const first = monitorSink(store);
  await runScrape({ ...base, monitorMode: 'new-only', emitRemoved: true, _nowMs: T0 }, first, fakeFetch([[GH, fx.greenhousePayload]]));
  const gone = first.jobs.find((j) => j.title === 'Accountant');
  assert.ok(gone, 'fixture sanity: the Accountant posting exists in run 1');

  const second = monitorSink(store);
  const summary = await runScrape(
    { ...base, monitorMode: 'new-only', emitRemoved: true, _nowMs: T1 },
    second,
    fakeFetch([[GH, ghWithout(4400003)]]),
  );

  assert.equal(summary.removedJobs, 1);
  assert.equal(second.jobs.length, 1, 'only the removal notice is emitted');
  assert.deepEqual(second.jobs[0], {
    status: 'removed',
    id: gone.id,
    source: 'greenhouse',
    company: 'acme',
    title: 'Accountant',
    url: gone.url,
    firstSeenAt: new Date(T0).toISOString(),
    removedAt: new Date(T1).toISOString(),
    // Same instant, second name: 'closedAt' is what the market calls it.
    closedAt: new Date(T1).toISOString(),
  });

  assert.equal(store.value.jobs[gone.id], undefined, 'a removed job must leave state.jobs');
  const key = store.value.keys[dedupeKey(gone)];
  assert.equal(key.lastRemovedAt, new Date(T1).toISOString());
  assert.equal(key.timesPosted, 1);
});

test('monitor: emitRemoved off detects the removal but emits no record', async () => {
  const store = memoryStore();
  await runScrape({ ...base, monitorMode: 'new-only', _nowMs: T0 }, monitorSink(store), fakeFetch([[GH, fx.greenhousePayload]]));
  const sink = monitorSink(store);
  const summary = await runScrape({ ...base, monitorMode: 'new-only', _nowMs: T1 }, sink, fakeFetch([[GH, ghWithout(4400003)]]));
  assert.equal(summary.removedJobs, 1);
  assert.equal(sink.jobs.length, 0);
});

test('monitor: a removed job that comes back is new again and carries repostedCount 1', async () => {
  const store = memoryStore();
  await runScrape({ ...base, monitorMode: 'annotate', emitRemoved: true, _nowMs: T0 }, monitorSink(store), fakeFetch([[GH, fx.greenhousePayload]]));
  await runScrape({ ...base, monitorMode: 'annotate', emitRemoved: true, _nowMs: T1 }, monitorSink(store), fakeFetch([[GH, ghWithout(4400003)]]));

  const third = monitorSink(store);
  const summary = await runScrape(
    { ...base, monitorMode: 'annotate', emitRemoved: true, _nowMs: T2 },
    third,
    fakeFetch([[GH, fx.greenhousePayload]]),
  );

  const back = third.jobs.find((j) => j.title === 'Accountant');
  assert.equal(back.isNew, true, 'it left the board and came back — that is a new posting');
  assert.equal(back.firstSeenAt, new Date(T2).toISOString());
  assert.equal(back.repostedCount, 1, 'the ghost-job signal');
  assert.equal(back.repostedAt, new Date(T2).toISOString(), 'and when it happened');
  assert.equal(summary.newJobs, 1);
  assert.equal(summary.unchangedJobs, 1);

  const other = third.jobs.find((j) => j.title !== 'Accountant');
  assert.equal(other.repostedCount, 0, 'a posting that never left is not a repost');
  assert.equal(other.repostedAt, null, 'and carries the field as null, not missing');
  assert.equal(store.value.keys[dedupeKey(back)].timesPosted, 2);
  assert.equal(store.value.keys[dedupeKey(back)].lastRepostedAt, new Date(T2).toISOString(), 'the repost date is persisted');
  assert.equal(store.value.keys[dedupeKey(other)].lastRepostedAt, null);
});

test('monitor: a board that fails produces no removals and keeps its jobs in the state', async () => {
  const twoBoards = { ...base, companies: ['greenhouse:acme', 'lever:acme'] };
  const store = memoryStore();
  const first = monitorSink(store);
  await runScrape(
    { ...twoBoards, monitorMode: 'annotate', emitRemoved: true, _nowMs: T0 },
    first,
    fakeFetch([[GH, fx.greenhousePayload], [LEVER, fx.leverPayload]]),
  );
  const leverJob = first.jobs.find((j) => j.source === 'lever');
  assert.ok(leverJob);

  const second = monitorSink(store);
  const summary = await runScrape(
    { ...twoBoards, monitorMode: 'annotate', emitRemoved: true, _nowMs: T1 },
    second,
    fakeFetch([[GH, fx.greenhousePayload], [LEVER, 500]]),
  );

  assert.equal(summary.failures, 1);
  assert.equal(summary.removedJobs, 0, 'an unreachable board is not evidence that its jobs were pulled');
  assert.equal(second.jobs.filter((j) => j.status === 'removed').length, 0);
  const entry = store.value.jobs[leverJob.id];
  assert.ok(entry, 'the job of a failed board stays in the state');
  assert.equal(entry.lastSeenAt, new Date(T0).toISOString(), 'and is left untouched');
});

test('monitor: annotate mode emits every job, new and known alike', async () => {
  const store = memoryStore();
  const fetchImpl = fakeFetch([[GH, ghWithout(4400003)]]);
  await runScrape({ ...base, monitorMode: 'annotate', _nowMs: T0 }, monitorSink(store), fetchImpl);

  const second = monitorSink(store);
  const summary = await runScrape(
    { ...base, monitorMode: 'annotate', _nowMs: T1 },
    second,
    fakeFetch([[GH, fx.greenhousePayload]]),
  );

  assert.equal(second.jobs.length, 2, 'annotate emits the known job too');
  const known = second.jobs.find((j) => j.title !== 'Accountant');
  const fresh = second.jobs.find((j) => j.title === 'Accountant');
  assert.equal(known.isNew, false);
  assert.equal(known.firstSeenAt, new Date(T0).toISOString());
  assert.equal(known.repostedCount, 0);
  assert.equal(known.repostedAt, null);
  assert.equal(fresh.isNew, true);
  assert.equal(fresh.firstSeenAt, new Date(T1).toISOString());
  assert.equal(fresh.repostedCount, 0);
  assert.equal(fresh.repostedAt, null, 'never seen before is not the same as reposted');
  assert.equal(summary.newJobs, 1);
  assert.equal(summary.unchangedJobs, 1);
});

test('monitor: monitorMode without a state store warns and behaves exactly like off', async () => {
  const warnings = [];
  const jobs = [];
  const sink = { jobs, pushJobs: async (b) => { jobs.push(...b); }, log: { info() {}, warning: (m) => warnings.push(m) } };
  const summary = await runScrape({ ...base, monitorMode: 'new-only', _nowMs: T0 }, sink, fakeFetch([[GH, fx.greenhousePayload]]));
  assert.equal(jobs.length, 2, 'no state store means no filtering — nothing is silently swallowed');
  assert.equal(summary.monitorMode, undefined);
  assert.equal(summary.newJobs, undefined);
  assert.equal(jobs[0].isNew, undefined, 'off must not add monitor fields');
  assert.match(warnings.join('\n'), /needs a state store/);
});

test('monitor: default run is byte-for-byte the old behaviour', async () => {
  const store = memoryStore();
  const sink = monitorSink(store);
  const summary = await runScrape({ companies: ['greenhouse:acme'], dedupe: true, _nowMs: T0 }, sink, fakeFetch([[GH, fx.greenhousePayload]]));
  assert.equal(sink.jobs.length, 2);
  for (const j of sink.jobs) {
    assert.equal('isNew' in j, false);
    assert.equal('firstSeenAt' in j, false);
    assert.equal('repostedCount' in j, false);
    assert.equal('repostedAt' in j, false);
  }
  assert.equal(store.value, null, 'no state is written when monitoring is off');
  assert.deepEqual(Object.keys(summary).sort(), ['boards', 'failures', 'totalDuplicates', 'totalFiltered', 'totalJobs']);
});

// ---- state.js in isolation --------------------------------------------------
test('state: emptyState shape', () => {
  assert.deepEqual(emptyState('m1'), { version: 1, monitorId: 'm1', updatedAt: null, jobs: {}, keys: {} });
});

test('state: a null / malformed previous state is treated as a first run', () => {
  const jobs = [{ id: 'a', company: 'acme', title: 'Dev', location: 'Milan', url: 'u' }];
  const board = [{ boardKey: 'greenhouse:acme', ok: true, jobs }];
  for (const prev of [null, undefined, 'garbage', {}, { jobs: null, keys: 7 }]) {
    const { annotate, removed, nextState } = diffRun(prev, board, T0, 'm1');
    assert.equal(removed.length, 0);
    assert.equal(annotate({ ...jobs[0] }).isNew, true);
    assert.equal(nextState.jobs.a.firstSeenAt, new Date(T0).toISOString());
    assert.equal(nextState.version, 1);
  }
});

test('state: two jobs sharing a dedupe key in one run count as one posting', () => {
  const jobs = [
    { id: 'a', company: 'acme', title: 'Dev', location: 'Milan', url: 'ua' },
    { id: 'b', company: 'acme', title: 'dev', location: 'MILAN', url: 'ub' },
  ];
  const { annotate, nextState } = diffRun(null, [{ boardKey: 'greenhouse:acme', ok: true, jobs }], T0);
  const key = dedupeKey(jobs[0]);
  assert.equal(Object.keys(nextState.keys).length, 1);
  assert.equal(nextState.keys[key].timesPosted, 1, 'one role posted twice is not two postings over time');
  assert.equal(annotate(jobs[0]).repostedCount, 0);
  assert.equal(annotate(jobs[1]).repostedCount, 0);
  assert.equal(Object.keys(nextState.jobs).length, 2, 'both ids are still tracked individually');
});

test('state: lastRemovedAt is only stamped when the last job holding a key is gone', () => {
  const twins = [
    { id: 'a', company: 'acme', title: 'Dev', location: 'Milan', url: 'ua' },
    { id: 'b', company: 'acme', title: 'Dev', location: 'Milan', url: 'ub' },
  ];
  const key = dedupeKey(twins[0]);
  const run1 = diffRun(null, [{ boardKey: 'greenhouse:acme', ok: true, jobs: twins }], T0).nextState;

  // one twin drops off: the role is still posted
  const run2 = diffRun(run1, [{ boardKey: 'greenhouse:acme', ok: true, jobs: [twins[0]] }], T1);
  assert.equal(run2.removed.length, 1);
  assert.equal(run2.nextState.keys[key].lastRemovedAt, null);

  // the last one drops off: now the role came down
  const run3 = diffRun(run2.nextState, [{ boardKey: 'greenhouse:acme', ok: true, jobs: [] }], T2);
  assert.equal(run3.removed.length, 1);
  assert.equal(run3.nextState.keys[key].lastRemovedAt, new Date(T2).toISOString());
  assert.deepEqual(run3.nextState.jobs, {});
});

test('state: annotate leaves jobs it does not know about untouched, and is pure w.r.t. prevState', () => {
  const prev = emptyState('m1');
  Object.freeze(prev.jobs);
  Object.freeze(prev.keys);
  const { annotate, nextState } = diffRun(prev, [{ boardKey: 'greenhouse:acme', ok: true, jobs: [{ id: 'a', company: 'acme', title: 'Dev', location: 'Milan' }] }], T0);
  const stranger = annotate({ id: 'zzz' });
  assert.deepEqual(stranger, { id: 'zzz' });
  assert.deepEqual(prev.jobs, {}, 'prevState must not be mutated');
  assert.equal(Object.keys(nextState.jobs).length, 1);
});

test('state: a job known from a board that was not fetched at all is left alone', () => {
  const jobs = [{ id: 'a', company: 'acme', title: 'Dev', location: 'Milan', url: 'u' }];
  const run1 = diffRun(null, [{ boardKey: 'greenhouse:acme', ok: true, jobs }], T0).nextState;
  // next run scrapes a different company entirely
  const run2 = diffRun(run1, [{ boardKey: 'lever:other', ok: true, jobs: [] }], T1);
  assert.equal(run2.removed.length, 0);
  assert.ok(run2.nextState.jobs.a, 'dropping a company from the input must not report its jobs as removed');
});
