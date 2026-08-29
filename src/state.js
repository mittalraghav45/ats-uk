/**
 * Monitor state — what a scheduled run remembers between runs.
 *
 * Why this exists: the whole point of a scheduled scrape is "tell me what
 * changed", not "bill me for the same 400 jobs every morning". To answer
 * that, a run has to compare what a board returns *now* against what it
 * returned last time. Two extra signals fall out of the same bookkeeping
 * for free:
 *   - a posting that vanished from the board (the req was filled or pulled);
 *   - a posting that vanished and then came back — a repost, which is the
 *     single strongest public signal that a role is a ghost job.
 *
 * This module is deliberately pure: no Apify SDK, no key-value store, no
 * clock. The caller loads the previous state, calls `diffRun`, and persists
 * `nextState`. `now` is always a parameter so runs are reproducible in tests.
 *
 * State footprint is kept minimal on purpose: it is stored in a key-value
 * record that has to survive boards with tens of thousands of postings, so
 * only what the diff and the removed-record need is kept — never the whole
 * job.
 */
import { dedupeKey } from './dedupe.js';

export const STATE_VERSION = 1;

/** A monitor that has never run. */
export function emptyState(monitorId = 'default') {
  return { version: STATE_VERSION, monitorId, updatedAt: null, jobs: {}, keys: {} };
}

/** Tolerate a null / half-written / older record instead of crashing a run. */
function readState(prevState, monitorId) {
  const base = emptyState(monitorId);
  if (!prevState || typeof prevState !== 'object') return base;
  return {
    ...base,
    monitorId: prevState.monitorId ?? monitorId,
    jobs: prevState.jobs && typeof prevState.jobs === 'object' ? prevState.jobs : {},
    keys: prevState.keys && typeof prevState.keys === 'object' ? prevState.keys : {},
  };
}

/** boardKey is `source:company`; the source name never contains a colon. */
function splitBoardKey(boardKey) {
  const s = String(boardKey ?? '');
  const i = s.indexOf(':');
  return i === -1 ? { source: s, company: '' } : { source: s.slice(0, i), company: s.slice(i + 1) };
}

/**
 * Compare one run against the previous state.
 *
 * @param {object|null} prevState  what `saveState` wrote last run, or null
 * @param {Array<{boardKey: string, ok: boolean, jobs: object[]}>} jobsByBoard
 *   every board touched this run, failures included with `ok: false` and no
 *   jobs. Only `ok: true` boards can produce removals: a board that errored
 *   proves nothing about the jobs it used to hold, and reporting those as
 *   "removed" would be a false alarm on every network blip.
 * @param {number} now epoch ms — injected, never read from the clock here
 * @returns {{annotate: (job: object) => object, removed: object[], nextState: object}}
 *   `annotate` stamps `isNew`, `firstSeenAt`, `repostedCount` and `repostedAt`
 *   onto a job that was part of this diff and returns it (jobs it does not know
 *   are returned untouched). Removed records carry `removedAt` and `closedAt`,
 *   which are the same instant under the two names the market uses.
 */
export function diffRun(prevState, jobsByBoard, now, monitorId = 'default') {
  const prev = readState(prevState, monitorId);
  const nowIso = new Date(now).toISOString();

  const nextJobs = { ...prev.jobs };
  const nextKeys = { ...prev.keys };

  // A dedupe key counts as "currently posted" only while at least one job
  // carrying it is still in the state. Removed jobs are deleted from the
  // state, so this set is exactly "keys that were live at the end of the
  // previous run" — which is what makes a repost detectable.
  const prevLiveKeys = new Set(Object.values(prev.jobs).map((e) => e?.dedupeKey).filter(Boolean));

  const fetchedBoards = new Set();
  for (const board of jobsByBoard ?? []) if (board?.ok) fetchedBoards.add(board.boardKey);

  const annotations = new Map();
  const seenIds = new Set();
  const bumpedKeys = new Set(); // a key must count once per run, not once per job
  // Keys that came back this run after having been off the board. Tracked as a
  // set rather than read back off `nextKeys.lastRepostedAt`, because two runs
  // pinned to the same millisecond would make that test lie.
  const repostedKeys = new Set();

  for (const board of jobsByBoard ?? []) {
    for (const job of board?.jobs ?? []) {
      const id = job.id;
      const key = dedupeKey(job);
      const prevEntry = prev.jobs[id];
      const isNew = !prevEntry;
      const firstSeenAt = prevEntry?.firstSeenAt ?? nowIso;
      seenIds.add(id);

      nextJobs[id] = {
        firstSeenAt,
        lastSeenAt: nowIso,
        dedupeKey: key,
        boardKey: board.boardKey,
        title: job.title ?? null,
        url: job.url ?? null,
      };

      if (!bumpedKeys.has(key)) {
        bumpedKeys.add(key);
        const prevKey = prev.keys[key];
        // A repost is the removed -> present transition, and only that: a key
        // we have never seen before is a first posting, not a comeback.
        const isRepost = !!prevKey && !prevLiveKeys.has(key);
        if (isRepost) repostedKeys.add(key);
        nextKeys[key] = {
          // Increments only on absent -> present or removed -> present, so a
          // role sitting on the board for months stays at timesPosted 1.
          timesPosted: (prevKey?.timesPosted ?? 0) + (prevLiveKeys.has(key) ? 0 : 1),
          firstSeenAt: prevKey?.firstSeenAt ?? nowIso,
          lastSeenAt: nowIso,
          lastRemovedAt: prevKey?.lastRemovedAt ?? null,
          // *When* the role was last put back up, kept next to how many times
          // it has been. A date makes the ghost-job signal checkable: "reposted
          // twice, both times within a fortnight" is a different story from
          // "reposted twice in four years".
          lastRepostedAt: isRepost ? nowIso : (prevKey?.lastRepostedAt ?? null),
        };
      }

      annotations.set(id, {
        isNew,
        firstSeenAt,
        repostedCount: Math.max(0, nextKeys[key].timesPosted - 1),
        // Null on every job that is not a comeback — present and null, like
        // `isNew`, so the field never appears and disappears between runs.
        repostedAt: repostedKeys.has(key) ? nowIso : null,
      });
    }
  }

  // Removed = known from a board we successfully fetched this run, and absent
  // from what that fetch returned.
  const removed = [];
  for (const [id, entry] of Object.entries(prev.jobs)) {
    if (!entry || seenIds.has(id) || !fetchedBoards.has(entry.boardKey)) continue;
    const { source, company } = splitBoardKey(entry.boardKey);
    removed.push({
      status: 'removed',
      id,
      source,
      company,
      title: entry.title ?? null,
      url: entry.url ?? null,
      firstSeenAt: entry.firstSeenAt ?? null,
      removedAt: nowIso,
      // The same instant under both names: we say removedAt, the market
      // (TheirStack and the aggregators that follow it) says closedAt. Two
      // words cost nothing; a buyer having to rename a column costs a mapping.
      closedAt: nowIso,
    });
    delete nextJobs[id];
  }

  if (removed.length) {
    // Only stamp lastRemovedAt once the *last* job carrying the key is gone —
    // one of two identical postings disappearing is not the role coming down.
    const stillLive = new Set(Object.values(nextJobs).map((e) => e?.dedupeKey).filter(Boolean));
    for (const rec of removed) {
      const key = prev.jobs[rec.id]?.dedupeKey;
      if (!key || stillLive.has(key)) continue;
      const prevKey = nextKeys[key];
      nextKeys[key] = {
        timesPosted: prevKey?.timesPosted ?? 1,
        firstSeenAt: prevKey?.firstSeenAt ?? rec.firstSeenAt,
        lastSeenAt: prevKey?.lastSeenAt ?? rec.firstSeenAt,
        lastRemovedAt: nowIso,
        lastRepostedAt: prevKey?.lastRepostedAt ?? null,
      };
    }
  }

  const nextState = {
    version: STATE_VERSION,
    monitorId: prev.monitorId,
    updatedAt: nowIso,
    jobs: nextJobs,
    keys: nextKeys,
  };

  const annotate = (job) => {
    const a = annotations.get(job?.id);
    if (!a) return job;
    job.isNew = a.isNew;
    job.firstSeenAt = a.firstSeenAt;
    job.repostedCount = a.repostedCount;
    job.repostedAt = a.repostedAt;
    return job;
  };

  return { annotate, removed, nextState };
}
