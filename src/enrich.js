/**
 * Cross-ATS derived fields.
 *
 * Why this exists: every ATS publishes the same three facts in its own
 * dialect — Ashby says `FullTime`, Lever `Full-time`, Workable `full_time`,
 * Recruitee `fulltime_fixed_term` — and none of them publishes a seniority at
 * all. Buyers end up writing the same post-processing over and over, or pay a
 * competitor for "seniority inference". So the raw values stay untouched
 * (they are the contract, and the caller must always be able to check our
 * work) and the derived ones are added alongside, with a `Norm` suffix.
 *
 * The rule everywhere in here: **no guessing**. A title with no seniority
 * signal returns null rather than a plausible-looking 'mid'. A wrong label is
 * worse than a missing one, because a missing one is visible.
 *
 * Pure module: no I/O, no clock, no SDK.
 */
import { descriptionTextOf } from './normalize.js';
import { extractTechnologies } from './tech.js';
import { countryCodeOf } from './geo.js';
import { detectLanguage } from './lang.js';

/** The closed vocabulary, ordered junior -> senior. Also what the filter validates against. */
export const SENIORITY_LEVELS = [
  'intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager', 'director', 'vp', 'cxo',
];

/**
 * First match wins, so the order is the whole design: a "Senior Staff
 * Engineer" is a staff engineer, an "Engineering Manager" is a manager even
 * though managers are senior people, and a "Principal Product Manager" reads
 * as management because that is the job. Scope beats grade.
 *
 * Word boundaries are not decoration: without them "Leadership Coach" reads
 * as a lead and "Internal Tools Engineer" as an intern. Both are covered by
 * tests.
 */
const SENIORITY_RULES = [
  // `chief \w+ officer` is widened to 1-3 middle words so a spelled-out
  // "Chief Information Security Officer" is not missed.
  ['cxo', /\bchief\s+(?:\w+\s+){1,3}officer\b|\b(?:ceo|cto|cfo|coo|cpo|cmo|cro|ciso|cio)\b/i],
  ['vp', /\bvice\s+president\b|\b(?:vp|svp|evp)\b/i],
  ['director', /\bdirector\b|\bhead\s+of\b/i],
  ['manager', /\bmanager\b/i],
  ['principal', /\bprincipal\b/i],
  ['staff', /\bstaff\b/i],
  ['lead', /\blead\b/i],
  ['senior', /\bsenior\b|\bsr\.?\b/i],
  // 'mid' is only ever returned on an explicit signal — never as a default.
  ['mid', /\bmid[-\s]?level\b|\bintermediate\b/i],
  ['junior', /\bjunior\b|\bjr\.?\b|\bentry[-\s]?level\b|\bgraduate\b|\bearly[-\s]career\b/i],
  // 'stage'/'stagista' are the Italian/French words for an internship and show
  // up untranslated on EU boards (Personio, Recruitee).
  ['intern', /\bintern(?:ship)?s?\b|\bworking\s+student\b|\btrainee\b|\bstagista\b|\bstage\b/i],
];

/**
 * @param {string|null|undefined} title
 * @returns {string|null} one of SENIORITY_LEVELS, or null when the title
 *   carries no signal — which is the common case and not a failure.
 */
export function inferSeniority(title) {
  if (typeof title !== 'string' || !title.trim()) return null;
  for (const [level, re] of SENIORITY_RULES) if (re.test(title)) return level;
  return null;
}

/**
 * Ordered like the seniority rules, most specific first. The precedence is
 * what makes Recruitee's `fulltime_fixed_term` come out as 'temporary'
 * instead of 'fulltime': the fixed term is the fact that matters to whoever
 * is reading the listing.
 */
const EMPLOYMENT_RULES = [
  ['internship', /\bintern(?:ship)?s?\b|\bworking\s+student\b|\btrainee\b|\bapprentice(?:ship)?\b|\bstagista\b|\bstage\b/i],
  ['temporary', /fixed.?term|temporary|\btemp\b|interim|seasonal/i],
  ['contract', /contract|contractor|freelance|\bb2b\b/i],
  ['parttime', /part.?time|min.?hours/i],
  ['fulltime', /full.?time|fulltime|permanent|regular/i],
];

/**
 * @param {*} raw the ATS value, in any of its dialects
 * @returns {string|null} 'fulltime' | 'parttime' | 'contract' | 'temporary' |
 *   'internship', or null for anything unrecognised (an ATS free-text value
 *   we cannot place is reported as unknown, not forced into a bucket).
 */
export function normalizeEmploymentType(raw) {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === 'string' ? raw : String(raw);
  if (!s.trim()) return null;
  for (const [type, re] of EMPLOYMENT_RULES) if (re.test(s)) return type;
  return null;
}

/**
 * Hybrid is tested before remote on purpose: several boards publish "Hybrid
 * Remote", and hybrid is the more specific of the two claims.
 *
 * @param {*} workplaceType the ATS value, may be null
 * @param {boolean} [isRemote] the unified flag, used only as a fallback —
 *   many boards (Greenhouse, Personio) have no workplace field at all and the
 *   only remote signal is the location text, which `isRemote` already carries.
 * @returns {'remote'|'hybrid'|'onsite'|null}
 */
export function normalizeWorkplaceType(workplaceType, isRemote) {
  const s = workplaceType === null || workplaceType === undefined ? '' : String(workplaceType);
  if (/hybrid/i.test(s)) return 'hybrid';
  if (/\bremote\b|\banywhere\b|work.?from.?home/i.test(s)) return 'remote';
  if (/on.?site|on.?premises?|in.?office|\boffice\b/i.test(s)) return 'onsite';
  return isRemote === true ? 'remote' : null;
}

/**
 * Annual-USD equivalent of a published pay range.
 *
 * Why this exists: `compensation` is published in whatever currency and
 * whatever interval the employer felt like — "6000 EUR / month", "£90,000 /
 * year", "$65 / hour" — which makes a numeric floor like `salaryMin`
 * meaningless across boards. One EU role at 6000 EUR a month is a 78k+ USD job
 * and was being dropped by a 70k floor. So the comparable number is derived
 * once, alongside the raw range, and never in place of it.
 *
 * The rates are static and approximate on purpose: a scraper that phones a
 * live FX API adds a dependency, a failure mode and a per-run cost to a field
 * nobody needs to four decimal places. The schema says "approximate", the raw
 * `compensation` object is always there, and a caller who needs the spot rate
 * has everything they need to compute it themselves.
 */

/**
 * USD per 1 unit. Approximate, updated at release time (August 2026) — good
 * enough to sort and threshold, not a pricing feed.
 */
export const FX_TO_USD = {
  USD: 1,
  EUR: 1.16,
  GBP: 1.34,
  CHF: 1.25,
  SEK: 0.105,
  NOK: 0.099,
  DKK: 0.156,
  PLN: 0.275,
  CZK: 0.048,
  HUF: 0.0029,
  RON: 0.023,
  CAD: 0.72,
  AUD: 0.65,
  NZD: 0.60,
  JPY: 0.0068,
  INR: 0.0115,
  BRL: 0.185,
  MXN: 0.054,
  SGD: 0.78,
  HKD: 0.128,
  AED: 0.272,
  ILS: 0.30,
  ZAR: 0.057,
  TRY: 0.024,
  KRW: 0.00072,
  CNY: 0.14,
};

/**
 * How many pay periods make a year. 2080 hours and 260 days are the standard
 * full-time-equivalent counts (52 x 40h, 52 x 5d) — the same ones every salary
 * calculator uses, so the number is reproducible rather than a house rule.
 *
 * The patterns have to swallow every dialect at once: Recruitee/Breezy/Pinpoint
 * say `year`/`month`/`hour`, Ashby says `1 YEAR`, Lever says
 * `per-year-salary`. Matching on the unit word inside the string handles all
 * three without a per-ATS table.
 */
const INTERVAL_MULTIPLIERS = [
  [/year|annual/i, 1],
  [/month/i, 12],
  [/week/i, 52],
  [/day|daily/i, 260],
  [/hour|hourly|\bhr\b/i, 2080],
];

/**
 * The floor under which an interval-less number is treated as unknowable
 * rather than annual. 5000 is chosen to sit above any plausible hourly, daily
 * or weekly rate and below any plausible annual salary in a major currency:
 * "45" with no interval is a rate, "120000" is a year. Anything in between is
 * refused — annualising an ambiguous number would invent data, and the caller
 * would have no way to see it happened.
 */
const ASSUME_ANNUAL_ABOVE = 5000;

function num(v) {
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** @returns {number|null} periods per year, or null when the interval cannot be established. */
function annualMultiplier(interval, magnitude) {
  const s = interval === null || interval === undefined ? '' : String(interval);
  if (s.trim()) {
    for (const [re, mult] of INTERVAL_MULTIPLIERS) if (re.test(s)) return mult;
  }
  // No interval, or one we do not recognise: only a number big enough to be an
  // annual salary is treated as one.
  return magnitude !== null && magnitude >= ASSUME_ANNUAL_ABOVE ? 1 : null;
}

/**
 * @param {object|null} comp the raw `compensation` object
 * @returns {{min: number|null, max: number|null}|null} annual USD, rounded, or
 *   null when the currency is missing/unknown, there are no numbers, or the
 *   interval cannot be established. Null means "not comparable", and that is a
 *   fact worth publishing — it is never a zero.
 */
export function annualizeCompensation(comp) {
  if (!comp || typeof comp !== 'object') return null;
  const rate = FX_TO_USD[String(comp.currency ?? '').trim().toUpperCase()];
  if (!rate) return null;
  const min = num(comp.min);
  const max = num(comp.max);
  if (min === null && max === null) return null;
  const mult = annualMultiplier(comp.interval, max ?? min);
  if (mult === null) return null;
  return {
    min: min === null ? null : Math.round(min * mult * rate),
    max: max === null ? null : Math.round(max * mult * rate),
  };
}

/**
 * Attach the derived fields in place; returns the job.
 * The raw `employmentType` / `workplaceType` are deliberately left as the ATS
 * published them — these are additive fields, never a rewrite.
 */
export function enrich(job) {
  job.seniority = inferSeniority(job.title);
  job.employmentTypeNorm = normalizeEmploymentType(job.employmentType);
  job.workplaceTypeNorm = normalizeWorkplaceType(job.workplaceType, job.isRemote);
  job.compensationAnnualUsd = annualizeCompensation(job.compensation);
  // The description is used whenever it was fetched — including when it was
  // fetched only to run a description filter and is not being emitted — so the
  // tag list is as rich as the data the run actually paid for. Title-only is
  // the fallback, never an error.
  job.technologies = extractTechnologies(`${job.title ?? ''} ${descriptionTextOf(job) ?? ''}`);
  // Country and language are the same bargain as seniority: derived, additive,
  // and null whenever the source text does not actually say. `location` is
  // free text on every ATS, and a description is only there when the run
  // fetched one — so both fields are frequently null, on purpose.
  job.countryCode = countryCodeOf(job.location, job.locations);
  job.language = detectLanguage(descriptionTextOf(job));
  return job;
}
