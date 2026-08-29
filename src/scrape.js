/**
 * Platform-independent scraping core: given targets and options, fetch,
 * transform, filter, dedupe and hand batches to a sink. main.js wires this
 * to the Apify SDK; tests wire it to fixtures. Keeping the core free of
 * the SDK is what makes the whole pipeline unit-testable.
 */
import { SOURCES, SOURCE_NAMES, AUTODETECTABLE, matchUrl } from './sources/index.js';
import { fetchJson, HttpError } from './http.js';
import { makeJob } from './normalize.js';
import { parseQuery, jobPassesFilters, parseSeniorityFilter, parseTechnologyFilter, parseCountryFilter, parseLanguageFilter } from './filters.js';
import { makeDeduper } from './dedupe.js';
import { addFreshness } from './freshness.js';
import { enrich, SENIORITY_LEVELS } from './enrich.js';
import { diffRun } from './state.js';
import { hintFor, filteredOutHint } from './hints.js';

/** "greenhouse:stripe" | "stripe" | careers URL | {ats,id} -> {ats|null, slug, company} */
export function parseTarget(entry) {
  if (entry && typeof entry === 'object') {
    const ats = String(entry.ats ?? '').toLowerCase().trim();
    const slug = String(entry.id ?? entry.slug ?? entry.url ?? '').trim();
    if (!slug) return null;
    const known = SOURCE_NAMES.includes(ats) ? ats : null;
    return known ? { ats: known, slug, company: entry.company ?? slug } : parseTarget(slug);
  }
  const s = String(entry ?? '').trim();
  if (!s) return null;

  if (/^https?:\/\//i.test(s)) {
    const hit = matchUrl(s);
    // An unrecognised URL is reported as such instead of being probed as a slug.
    return hit ?? { ats: null, slug: s, company: s, unknownUrl: true };
  }

  const m = s.match(/^([a-z]+)\s*:\s*(.+)$/i);
  if (m && SOURCE_NAMES.includes(m[1].toLowerCase())) {
    const ats = m[1].toLowerCase();
    const slug = m[2].trim();
    const company = /^https?:\/\//i.test(slug) ? (matchUrl(slug)?.company ?? slug) : slug;
    return { ats, slug, company };
  }
  return { ats: null, slug: s, company: s };
}

async function fetchBoard(ats, slug, opts, fetchImpl) {
  const src = SOURCES[ats];
  const get = (url, init = {}) => fetchJson(url, { ...init, fetchImpl });
  if (src.fetchAll) return src.fetchAll({ slug, opts, get });
  return src.extract(await get(src.url(slug, opts)));
}

/** Probe every slug-addressable ATS for a bare slug; keep the ones with jobs. */
export async function autodetect(slug, opts, fetchImpl) {
  const probes = AUTODETECTABLE.map(async (ats) => {
    try {
      const items = await fetchBoard(ats, slug, opts, fetchImpl);
      return items.length ? { ats, items } : null;
    } catch {
      return null; // an unreachable ATS must not sink the whole probe
    }
  });
  return (await Promise.all(probes)).filter(Boolean);
}

async function pool(items, size, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const [index, item] = queue.shift();
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}

/**
 * The run-wide spend cap.
 *
 * Boards are fetched concurrently, but JS is single-threaded: `take()` reads
 * and increments the counter without an `await` in between, so no two boards
 * can interleave inside it. That is what makes the cap exact instead of
 * "roughly N, plus whatever was in flight".
 */
function makeBudget(limit) {
  let taken = 0;
  return {
    get unlimited() { return !(limit > 0); },
    take() {
      if (!(limit > 0)) return true;
      if (taken >= limit) return false;
      taken++;
      return true;
    },
  };
}

/**
 * A job the cap refused was never delivered, so the monitor must not remember
 * it — otherwise the next run would greet it as "already seen" and the buyer
 * would never get it at all. This is the subtle part: deleting the job entry
 * is not enough, because `diffRun` also bumped the repost bookkeeping in
 * `state.keys` for it, and leaving that bump behind would make the posting
 * look like a repost the first time it is actually delivered. So each key that
 * no job in the state still carries is restored to its previous value (or
 * removed when there was none).
 */
function forgetCappedJobs(nextState, prevState, cappedIds) {
  const touchedKeys = new Set();
  for (const id of cappedIds) {
    const entry = nextState.jobs[id];
    if (!entry) continue;
    if (entry.dedupeKey) touchedKeys.add(entry.dedupeKey);
    delete nextState.jobs[id];
  }
  const stillLive = new Set(Object.values(nextState.jobs).map((e) => e?.dedupeKey).filter(Boolean));
  for (const key of touchedKeys) {
    if (stillLive.has(key)) continue;
    const prevKey = prevState?.keys?.[key];
    if (prevKey) nextState.keys[key] = prevKey;
    else delete nextState.keys[key];
  }
}

/**
 * @param {object} input actor input
 * @param {object} sink  { pushJobs(jobs[]), log, loadState?(), saveState?(state) }
 *   loadState/saveState are only consulted when monitorMode is on.
 * @returns summary
 */
export async function runScrape(input, sink, fetchImpl = globalThis.fetch) {
  const maxPerCompany = Number(input.maxJobsPerCompany) > 0 ? Number(input.maxJobsPerCompany) : Infinity;
  const parsedDescriptionQuery = parseQuery(input.descriptionQuery);
  const parsedDescriptionExclude = parseQuery(input.descriptionExclude);
  // Fetching a description and emitting it are two different decisions. The
  // description filters need the text; the caller may still not want 20 KB of
  // HTML in every record, and may not even know the filter costs a fetch. So
  // the adapters are told to *get* the text (their `includeDescription` has
  // always meant exactly that), and `emitDescription` alone decides whether it
  // reaches the dataset. The extra requests are real — on Workday one per job —
  // and the input schema says so where the filter is documented.
  const emitDescription = input.includeDescription === true;
  const fetchDescriptions = emitDescription || !!parsedDescriptionQuery || !!parsedDescriptionExclude;
  const opts = {
    includeDescription: fetchDescriptions,
    includeRaw: input.includeRaw === true,
    maxPerCompany: Number.isFinite(maxPerCompany) ? maxPerCompany : undefined,
  };
  const filters = {
    parsedQuery: parseQuery(input.query),
    parsedExcludeQuery: parseQuery(input.excludeQuery),
    parsedDescriptionQuery,
    parsedDescriptionExclude,
    locationFilter: input.locationFilter?.trim() || null,
    remoteOnly: input.remoteOnly === true,
    postedAfterIso: input.postedAfter ? new Date(input.postedAfter).toISOString() : null,
    hasSalary: input.hasSalary === true,
    salaryMin: Number(input.salaryMin) > 0 ? Number(input.salaryMin) : null,
    maxDaysOpen: Number(input.maxDaysOpen) > 0 ? Number(input.maxDaysOpen) : null,
    seniorityIn: parseSeniorityFilter(input.seniorityFilter),
    technologiesIn: parseTechnologyFilter(input.technologyFilter),
    countryIn: parseCountryFilter(input.countryFilter),
    languageIn: parseLanguageFilter(input.languageFilter),
  };
  if (filters.languageIn && !fetchDescriptions) {
    // The language is read from the description text. Without it every job has
    // `language: null` and the filter would return an empty run that looks
    // exactly like a broken scraper — so we say it out loud instead.
    sink.log?.warning?.('languageFilter is set but no description is being fetched, so every job has language null and nothing can match. Switch on includeDescription (or use a description filter) to give the detector something to read.');
  }
  if (input.seniorityFilter?.trim() && !filters.seniorityIn) {
    sink.log?.warning?.(`seniorityFilter "${input.seniorityFilter}" contains no known level — filter ignored. Known levels: ${SENIORITY_LEVELS.join(', ')}.`);
  }
  const staleAfterDays = Number(input.staleAfterDays) > 0 ? Number(input.staleAfterDays) : 60;
  // `_nowMs` is an undocumented test hook (deliberately absent from the input
  // schema): freshness and the monitor diff both need a clock, and a run is
  // only reproducible if the caller can pin it.
  const now = input._nowMs != null && Number.isFinite(Number(input._nowMs)) ? Number(input._nowMs) : Date.now();
  const deduper = input.dedupe !== false ? makeDeduper() : null;

  // Hard ceiling on billed results for the whole run (0 = off). The single
  // most-repeated complaint about job-data actors is not knowing what a run
  // will cost; this is the knob that answers it.
  const maxTotal = Number(input.maxTotalJobs) > 0 ? Number(input.maxTotalJobs) : 0;
  const budget = makeBudget(maxTotal);
  let capped = 0; // jobs that passed everything and were dropped only by the cap

  // Monitor mode. Off unless asked for, and off if the caller cannot persist
  // state — without a store there is no "previous run" to diff against, and
  // silently marking every job as new every time would be worse than not
  // monitoring at all.
  const requestedMode = String(input.monitorMode ?? 'off');
  let monitorMode = requestedMode === 'annotate' || requestedMode === 'new-only' ? requestedMode : 'off';
  if (monitorMode !== 'off' && typeof sink.loadState !== 'function') {
    sink.log?.warning?.(`monitorMode "${monitorMode}" needs a state store, but the caller provides none — running with monitorMode "off".`);
    monitorMode = 'off';
  }
  const monitoring = monitorMode !== 'off';
  const emitRemoved = monitoring && input.emitRemoved === true;
  // Results are collected per board and diffed once, after the pool: the pool
  // runs boards concurrently, and touching shared state from inside it would
  // race.
  const boardResults = [];

  const targets = (input.companies ?? []).map(parseTarget).filter(Boolean);
  if (!targets.length) throw new Error('Input "companies" is empty — add at least one entry like "greenhouse:stripe", a bare slug, or a careers-page URL.');

  const summary = { boards: [], totalJobs: 0, totalFiltered: 0, totalDuplicates: 0, failures: 0 };

  await pool(targets, Number(input.concurrency) || 10, async (target) => {
    const boards = [];
    try {
      if (target.unknownUrl) {
        throw new HttpError(`"${target.slug}" is not a supported job-board URL. Supported: ${SOURCE_NAMES.join(', ')}.`, { status: 404 });
      }
      if (target.ats) {
        boards.push({ ats: target.ats, items: await fetchBoard(target.ats, target.slug, opts, fetchImpl) });
      } else {
        const found = await autodetect(target.slug, opts, fetchImpl);
        if (!found.length) throw new HttpError(`No ATS board found for "${target.slug}" on any of: ${AUTODETECTABLE.join(', ')}. Workday boards need their full careers URL.`, { status: 404 });
        boards.push(...found);
      }
    } catch (e) {
      summary.failures++;
      // The hint is the whole point of BOARD-STATUS: the error says what
      // happened, the hint says what to change about the input.
      summary.boards.push({ company: target.company, ats: target.ats, ok: false, error: e.message, hint: hintFor(e, target.ats, target.slug) });
      // A failed board must never look like "everything here was removed".
      if (monitoring) boardResults.push({ boardKey: `${target.ats ?? 'autodetect'}:${target.company}`, ok: false, jobs: [] });
      sink.log?.warning?.(`✗ ${target.ats ?? 'autodetect'}:${target.company} — ${e.message}`);
      return;
    }

    for (const { ats, items } of boards) {
      let kept = 0, filtered = 0, dupes = 0;
      const out = [];
      for (const raw of items) {
        if (kept >= maxPerCompany) break;
        // enrich() runs before the filters on purpose: seniorityFilter reads
        // the derived field, so it has to exist by then.
        const job = enrich(addFreshness(
          makeJob(SOURCES[ats].transform(raw, { slug: target.slug, company: target.company }), {
            source: ats, company: target.company, ...opts, emitDescription, raw,
          }),
          { thresholdDays: staleAfterDays, now },
        ));
        if (!jobPassesFilters(job, filters)) { filtered++; continue; }
        if (deduper && !deduper.keep(job)) { dupes++; continue; }
        // Monitoring applies the cap after the diff instead (see below): what
        // is billed there is what is emitted, and in "new-only" that is only
        // the new jobs — which are not known yet at this point. Capped jobs
        // are counted, not silently swallowed, and they are not `filtered`:
        // nothing was wrong with them, we just stopped spending.
        if (!monitoring && !budget.take()) { capped++; continue; }
        out.push(job);
        kept++;
      }
      if (monitoring) boardResults.push({ boardKey: `${ats}:${target.company}`, ok: true, jobs: out });
      else if (out.length) await sink.pushJobs(out);
      summary.totalJobs += kept;
      summary.totalFiltered += filtered;
      summary.totalDuplicates += dupes;
      const boardLine = { company: target.company, ats, ok: true, found: items.length, kept, filtered, duplicates: dupes };
      // "The board worked and I still got nothing" is the other half of the
      // 0-results question, and the counters already know the answer.
      const dropped = filteredOutHint(boardLine);
      if (dropped) boardLine.hint = dropped;
      summary.boards.push(boardLine);
      sink.log?.info?.(`✓ ${ats}:${target.company} — ${items.length} found, ${kept} kept`);
    }
  });

  if (monitoring) {
    // Annotation happens here, after filters and dedupe, so jobs the caller
    // rejected never enter the state — and, symmetrically, a job that a
    // changed filter now rejects reads as removed, because the monitor tracks
    // the feed the caller asked for, not the raw board.
    const prevState = await sink.loadState();
    const { annotate, removed, nextState } = diffRun(prevState, boardResults, now, input.monitorId?.trim() || 'default');

    let newJobs = 0;
    let unchangedJobs = 0;
    const cappedNewIds = [];
    for (const board of boardResults) {
      const emit = [];
      for (const job of board.jobs) {
        annotate(job);
        // 'new-only' still counts and still refreshes lastSeenAt in the state;
        // it just does not re-emit — and therefore does not re-bill — a job
        // the caller already received.
        const wouldEmit = monitorMode === 'annotate' || job.isNew;
        if (wouldEmit && !budget.take()) {
          capped++;
          // Only a *new* job has to be forgotten. An already-seen job skipped
          // by the cap in 'annotate' mode was delivered in an earlier run, so
          // its state entry is still true — and dropping it would reset its
          // firstSeenAt and fake a repost.
          if (job.isNew) cappedNewIds.push(job.id);
          continue;
        }
        if (job.isNew) newJobs++; else unchangedJobs++;
        if (wouldEmit) emit.push(job);
      }
      if (emit.length) await sink.pushJobs(emit);
    }
    // Removal notices are never charged, so the spend cap does not apply.
    if (emitRemoved && removed.length) await sink.pushJobs(removed);

    if (cappedNewIds.length) forgetCappedJobs(nextState, prevState, cappedNewIds);

    await sink.saveState?.(nextState);

    summary.monitorMode = monitorMode;
    summary.newJobs = newJobs;
    summary.unchangedJobs = unchangedJobs;
    summary.removedJobs = removed.length;
  }

  if (maxTotal > 0) {
    // "No silent caps": if a ceiling was set it is always reported, whether or
    // not it bit, so a short result set is never a mystery. `capped` is its own
    // bucket, deliberately not folded into totalFiltered — those jobs matched.
    // (In monitor mode totalJobs keeps its meaning of "passed filters and
    //  dedupe", which already differs from "emitted".)
    summary.maxTotalJobs = maxTotal;
    summary.capped = capped;
    summary.cappedAtMaxTotalJobs = capped > 0;
  }

  return summary;
}
