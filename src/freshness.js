/**
 * Freshness signals — how long a posting has been open.
 *
 * Why this exists: the loudest complaint about job data is paying for stale
 * or "ghost" listings, and the most-requested missing field in job-seeker
 * threads is "how long has this been posted / has it been reposted". Every
 * ATS publishes a posting date; almost no scraper turns it into a usable
 * signal. These are derived, transparent and never a substitute for the raw
 * date — `publishedAt` is always still there for the caller to judge.
 */
const DAY = 86_400_000;

/** Whole days between the posting date and `now`; null when undated. */
export function daysOpen(publishedAt, now = Date.now()) {
  if (!publishedAt) return null;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

/**
 * A posting open far longer than a normal hiring cycle. 60 days is the
 * threshold job-seeker communities converge on for "this is probably not
 * a live req" — it is a heuristic, and it is named as one in the schema.
 */
export function isStale(days, thresholdDays = 60) {
  return days === null ? null : days >= thresholdDays;
}

/** Attach the derived fields to a job in place; returns the job. */
export function addFreshness(job, { thresholdDays = 60, now = Date.now() } = {}) {
  const days = daysOpen(job.publishedAt, now);
  job.daysOpen = days;
  job.isStale = isStale(days, thresholdDays);
  return job;
}
