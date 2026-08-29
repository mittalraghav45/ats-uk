/**
 * BOARD-STATUS: per-input diagnostics.
 *
 * Why this exists: the single most common support question about any job-board
 * scraper is "why did I get 0 results?", and the honest answer is almost never
 * "the scraper is broken". It is a slug that is not the company's board name, a
 * careers URL pasted from the wrong page, a filter that matched nothing, or a
 * board that was down for ten seconds. The run summary already knows which of
 * those happened — it just never said so in words.
 *
 * So every board line gets a `hint`: one sentence, addressed to whoever wrote
 * the input, telling them what to change. The functions here are pure and take
 * the error rather than throwing anything, so they are unit-testable and cannot
 * affect a run.
 */

/**
 * The shape of a careers URL for each ATS, in the form a buyer would paste.
 * Kept here rather than in the adapters because it is documentation, not
 * parsing: the adapters' `matchUrl` accepts more shapes than these, and these
 * are the ones worth suggesting.
 */
const BOARD_URL_FORMS = {
  greenhouse: ['https://boards.greenhouse.io/{slug}', 'https://job-boards.greenhouse.io/{slug}'],
  lever: ['https://jobs.lever.co/{slug}'],
  ashby: ['https://jobs.ashbyhq.com/{slug}'],
  workable: ['https://apply.workable.com/{slug}'],
  smartrecruiters: ['https://careers.smartrecruiters.com/{slug}'],
  recruitee: ['https://{slug}.recruitee.com'],
  personio: ['https://{slug}.jobs.personio.de', 'https://{slug}.jobs.personio.com'],
  breezy: ['https://{slug}.breezy.hr'],
  rippling: ['https://ats.rippling.com/{slug}/jobs'],
  eightfold: ['https://{slug}.eightfold.ai'],
  pinpoint: ['https://{slug}.pinpointhq.com'],
  teamtailor: ['https://{slug}.teamtailor.com'],
  workday: ['https://{tenant}.wd5.myworkdayjobs.com/{site}', 'https://wd3.myworkdaysite.com/{tenant}/{site}'],
  oracle: ['https://{tenant}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions'],
};

/**
 * What a bare slug is probed against first when no ATS was named. The full
 * list is long and unhelpful in an error message; these three carry the large
 * majority of tech boards, so they are the ones worth naming.
 */
const LIKELY_AUTODETECT = ['greenhouse', 'lever', 'ashby'];

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function urlForms(ats, slug) {
  const forms = BOARD_URL_FORMS[ats];
  if (!forms) return [];
  return forms.map((f) => f.replace('{slug}', slug || '{slug}'));
}

/**
 * One sentence telling the user what to do about a board that failed.
 *
 * @param {Error|{message?: string, status?: number}} error the error `runScrape`
 *   caught for this board (an `HttpError` carries `status`)
 * @param {string|null} ats the ATS named in the input, or null for autodetect
 * @param {string} slug the slug or URL that was tried
 * @returns {string|null} the hint, or null when we have nothing useful to add —
 *   an invented explanation is worse than the raw error.
 */
export function hintFor(error, ats, slug) {
  const message = String(error?.message ?? error ?? '');
  const status = Number(error?.status ?? 0);

  // An unrecognised URL: the message already lists every supported ATS, and
  // there is nothing to add to it.
  if (/is not a supported job-board URL/i.test(message)) return message;

  const notFound = status === 404 || /no ats board found/i.test(message);
  if (notFound) {
    if (ats && BOARD_URL_FORMS[ats]) {
      return `Slug "${slug}" was not found on ${ats}. The slug is the board name in the careers URL, not the company name — check the form: ${urlForms(ats, slug).join(' or ')}.`;
    }
    if (!ats) {
      const forms = LIKELY_AUTODETECT.map((a) => urlForms(a, slug)[0]).join(', ');
      return `No board answered for the bare slug "${slug}". Open the company's careers page and paste its URL instead, or name the ATS as "ats:${slug}". The three most common are: ${forms}. Workday and Oracle boards must be given as a full careers URL.`;
    }
    return `Slug "${slug}" was not found on ${ats}. Check the careers URL the company actually publishes.`;
  }

  if (/^timeout|timed out/i.test(message) || RETRYABLE_STATUS.has(status) || (status >= 500 && status < 600)) {
    return 'The board answered with a server error or did not answer in time — usually transient, retry the run.';
  }

  if (status === 401 || status === 403) {
    return `The board refused the request (HTTP ${status}). That board is not public, or it is behind a bot filter — a proxy may be needed.`;
  }

  return null;
}

/**
 * The other half of "why 0 results": the board answered, and the filters ate
 * everything. Reported only when it actually happened (found > 0, kept = 0),
 * because otherwise the numbers speak for themselves.
 *
 * @param {{found: number, kept: number, filtered: number, duplicates: number}} board
 * @returns {string|null}
 */
export function filteredOutHint({ found = 0, kept = 0, filtered = 0, duplicates = 0 } = {}) {
  if (!(found > 0) || kept > 0) return null;
  const reasons = [];
  if (filtered > 0) reasons.push(`${filtered} by your filters`);
  if (duplicates > 0) reasons.push(`${duplicates} as duplicates`);
  // Whatever is left was held back by the run-wide maxTotalJobs cap: it passed
  // everything and simply was not paid for.
  const capped = found - filtered - duplicates - kept;
  if (capped > 0) reasons.push(`${capped} by the maxTotalJobs cap`);
  if (!reasons.length) return null;
  return `The board was read fine — all ${found} job(s) were dropped before output (${reasons.join(', ')}). Relax the filters if that is not what you wanted.`;
}

/** The columns of BOARD-STATUS.csv, in order. */
export const BOARD_STATUS_COLUMNS = ['company', 'ats', 'ok', 'found', 'kept', 'filtered', 'duplicates', 'error', 'hint'];

/**
 * RFC-4180 escaping: a field is quoted when it contains a comma, a quote, a
 * newline or edge whitespace, and quotes inside are doubled. Written out here
 * rather than pulled from a package because it is nine lines and this actor
 * has no dependencies.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {object[]} boards `summary.boards`
 * @returns {string} the CSV text, header included, CRLF-terminated rows (what
 *   Excel expects; every other reader tolerates it).
 */
export function boardStatusCsv(boards) {
  const rows = [BOARD_STATUS_COLUMNS.join(',')];
  for (const b of boards ?? []) {
    rows.push(BOARD_STATUS_COLUMNS.map((c) => csvCell(b?.[c])).join(','));
  }
  return `${rows.join('\r\n')}\r\n`;
}
