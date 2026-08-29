/** Input-driven post-filters. Pure functions, unit-tested. */
import { SENIORITY_LEVELS } from './enrich.js';
import { descriptionTextOf } from './normalize.js';

/**
 * "senior, staff, principal" -> ['senior','staff','principal'].
 * Unknown words are dropped instead of throwing — a typo must not kill a run
 * that is otherwise fine. If *nothing* in the list is a known level the filter
 * is reported as inactive (null) rather than silently matching nothing; the
 * caller warns, because a filter that quietly drops every job looks exactly
 * like a broken scraper.
 * @returns {string[]|null}
 */
export function parseSeniorityFilter(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const wanted = input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const known = [...new Set(wanted.filter((s) => SENIORITY_LEVELS.includes(s)))];
  return known.length ? known : null;
}

/**
 * "senior engineer, staff engineer" -> [['senior','engineer'],['staff','engineer']].
 * Comma = OR between alternatives, space = AND inside one. The same parser
 * serves `query`, `excludeQuery`, `descriptionQuery` and `descriptionExclude`,
 * so the syntax a buyer learns once holds everywhere.
 */
export function parseQuery(query) {
  if (!query?.trim()) return null;
  return query.split(',').map((alt) => alt.trim().toLowerCase().split(/\s+/).filter(Boolean)).filter((a) => a.length);
}

/**
 * Matching is **substring**, not word: `intern` matches "Internal Tools
 * Engineer". That is deliberate and kept identical for the exclude variants —
 * one surprising rule is better than two rules that disagree — and it is
 * spelled out in the input schema so an exclude list can be written around it.
 */
export function matchesQuery(title, parsed) {
  if (!parsed) return true;
  const t = (title ?? '').toLowerCase();
  return parsed.some((words) => words.every((w) => t.includes(w)));
}

/**
 * "python, aws" -> a lookup of the requested canonical technology names.
 * Comma = OR: a job passes on any one of them. Case-insensitive, because the
 * canonical names are capitalised ('PostgreSQL') and nobody types them that way.
 */
export function parseTechnologyFilter(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const wanted = input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return wanted.length ? new Set(wanted) : null;
}

/**
 * "de, at, ch" -> Set {'DE','AT','CH'}. Comma = OR, ISO-2, case-insensitive.
 * No validation against the dictionary: an unknown code simply matches
 * nothing, and refusing the whole filter would be a bigger surprise than
 * returning zero rows for "xx".
 */
export function parseCountryFilter(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const wanted = input.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return wanted.length ? new Set(wanted) : null;
}

/** "en, de" -> Set {'en','de'}. Comma = OR, ISO 639-1, case-insensitive. */
export function parseLanguageFilter(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const wanted = input.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return wanted.length ? new Set(wanted) : null;
}

export function jobPassesFilters(job, {
  parsedQuery, parsedExcludeQuery, parsedDescriptionQuery, parsedDescriptionExclude,
  locationFilter, remoteOnly, postedAfterIso, hasSalary, salaryMin, maxDaysOpen,
  seniorityIn, technologiesIn, countryIn, languageIn,
}) {
  if (!matchesQuery(job.title, parsedQuery)) return false;
  // Same syntax as `query`, opposite verdict. Guarded because matchesQuery
  // answers `true` for an inactive filter, which here would drop everything.
  if (parsedExcludeQuery && matchesQuery(job.title, parsedExcludeQuery)) return false;
  if (parsedDescriptionQuery || parsedDescriptionExclude) {
    // Present whenever the description was fetched, emitted or not.
    const text = descriptionTextOf(job);
    // Asymmetric on purpose. A required phrase cannot be found in a text that
    // does not exist, so boards that expose no description can't match and the
    // job goes; an *excluded* phrase equally cannot be found there, so nothing
    // was matched and the job stays. Both readings are the literal one.
    if (parsedDescriptionQuery && !(text && matchesQuery(text, parsedDescriptionQuery))) return false;
    if (parsedDescriptionExclude && text && matchesQuery(text, parsedDescriptionExclude)) return false;
  }
  if (seniorityIn) {
    // Unlike the date filter above, an unknown seniority is *not* kept: the
    // level is inferred from the title, so null means "this title says
    // nothing", and someone asking for staff+ roles does not want the pile of
    // titles we could not read. Documented in the input schema.
    if (!job.seniority || !seniorityIn.includes(job.seniority)) return false;
  }
  if (locationFilter) {
    const needle = locationFilter.toLowerCase();
    const hay = [job.location, ...(job.locations ?? [])].filter(Boolean).join(' | ').toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (countryIn) {
    // Same rule as seniority and technologies: `countryCode` is derived from a
    // free-text location, so null means "the string did not say", and a filter
    // that names countries keeps only jobs whose country could be determined.
    // Documented in the input schema, because "Remote" losing to a country
    // filter is otherwise surprising.
    if (!job.countryCode || !countryIn.has(job.countryCode)) return false;
  }
  if (languageIn) {
    // Ditto, with one extra catch worth knowing: the language is read from the
    // description, so a run that never fetched descriptions has `language: null`
    // on every job and this filter empties the result set. The schema says so.
    if (!job.language || !languageIn.has(job.language)) return false;
  }
  if (remoteOnly && !job.isRemote) return false;
  if (postedAfterIso) {
    const stamp = job.publishedAt ?? job.updatedAt;
    // Boards that expose no date keep the job — dropping silently would look like missing data.
    if (stamp && stamp < postedAfterIso) return false;
  }
  if (hasSalary && !job.compensation) return false;
  if (salaryMin != null) {
    // The floor is an **annual USD** figure, so it is compared against the
    // annualised, converted range — not against the raw number, which may be a
    // monthly EUR amount and would fail a 70k floor while being a 78k job.
    // Asking for a floor implies asking for a comparable number: a job with no
    // published pay, or one we cannot convert (unknown currency, ambiguous
    // interval), cannot satisfy it and is dropped.
    const top = job.compensationAnnualUsd?.max ?? job.compensationAnnualUsd?.min;
    if (typeof top !== 'number' || top < salaryMin) return false;
  }
  if (technologiesIn) {
    // Same reasoning as seniority: technologies are derived, so `[]` means
    // "the text named none of them", and someone filtering by stack does not
    // want the pile we could not read.
    const have = job.technologies ?? [];
    if (!have.some((t) => technologiesIn.has(String(t).toLowerCase()))) return false;
  }
  if (maxDaysOpen != null && typeof job.daysOpen === 'number' && job.daysOpen > maxDaysOpen) return false;
  return true;
}
