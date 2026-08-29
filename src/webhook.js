/**
 * The end-of-run webhook payload.
 *
 * Why it lives here and not in main.js: main.js is the only file allowed to
 * know about the Apify SDK, and everything in it is therefore untestable. The
 * *shape* of what a customer's endpoint receives is a contract, so the part
 * worth testing — building it — is a pure function, and main.js is left with
 * nothing but the POST.
 *
 * The delivery rules that go with it (enforced in main.js): https only, 15s
 * timeout, one retry, and a failure never fails the run. A scraped dataset
 * that is already saved must not be thrown away because someone's endpoint
 * was down.
 */

/** How many jobs of each kind travel in the body. */
export const WEBHOOK_JOB_LIMIT = 200;

/**
 * Only https. A webhook body carries the whole result set of a paid run, and
 * plain http would put it on the wire in clear text; refusing is the same
 * call every serious webhook sender makes.
 * @returns {boolean}
 */
export function isDeliverableWebhookUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    return new URL(url.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * @param {object} args
 * @param {object} args.summary the run summary, verbatim
 * @param {object[]} [args.jobs] the jobs emitted this run, in emission order.
 *   In `new-only` monitor mode those *are* the new jobs, which is why the field
 *   is called `newJobs`: it is "what this run delivered", and in the mode built
 *   for scheduled runs that is exactly the news.
 * @param {object[]} [args.removed] the removal records emitted this run
 * @param {string|null} [args.datasetId]
 * @param {string|null} [args.runId]
 * @param {number} [args.limit] cap per list; the default is the documented 200
 * @returns {object} the JSON body
 */
export function buildWebhookPayload({ summary, jobs = [], removed = [], datasetId = null, runId = null, limit = WEBHOOK_JOB_LIMIT } = {}) {
  const cap = Number.isFinite(limit) && limit > 0 ? limit : WEBHOOK_JOB_LIMIT;
  // The two lists are separated by `status` rather than by who pushed them, so
  // a caller that mixes them in one sink still gets a correct body.
  const all = Array.isArray(jobs) ? jobs : [];
  const removals = [...(Array.isArray(removed) ? removed : []), ...all.filter((j) => j?.status === 'removed')];
  return {
    event: 'run.finished',
    summary: summary ?? null,
    newJobs: all.filter((j) => j?.status !== 'removed').slice(0, cap),
    removed: removals.slice(0, cap),
    datasetId: datasetId ?? null,
    runId: runId ?? null,
  };
}
