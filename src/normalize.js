/**
 * The unified job schema every adapter maps into. Field names are chosen
 * to be self-explanatory in a dataset preview and stable across versions:
 * renaming any of these is a breaking change for buyers.
 */
import { createHash } from 'node:crypto';

export function stableId(source, company, externalId) {
  return createHash('sha1').update(`${source}:${company}:${externalId}`).digest('hex').slice(0, 16);
}

const TAG_RE = /<[^>]*>/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function decodeEntities(s) {
  if (!s) return s;
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

export function htmlToText(html) {
  if (!html) return null;
  return decodeEntities(html).replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim() || null;
}

const REMOTE_RE = /\bremote\b|\banywhere\b|\bwork from home\b/i;

export function looksRemote(...fields) {
  return fields.some((f) => typeof f === 'string' && REMOTE_RE.test(f));
}

export function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Carries the description text through the pipeline without ever putting it in
 * the output.
 *
 * Why: `descriptionQuery` and technology extraction both need the text, and a
 * caller can want the *filter* without wanting the 20 KB of HTML in every
 * record. A Symbol-keyed, non-enumerable property is invisible to
 * `JSON.stringify`, `Object.keys` and `Object.assign`, so the dataset is
 * exactly what `includeDescription` promised while the pipeline can still read
 * the text. Use `descriptionTextOf(job)` rather than touching it directly.
 */
export const HIDDEN_DESCRIPTION_TEXT = Symbol('descriptionText');

/** The description text for filtering/enrichment, emitted or not; null if the board published none. */
export function descriptionTextOf(job) {
  return job?.descriptionText ?? job?.[HIDDEN_DESCRIPTION_TEXT] ?? null;
}

/**
 * @returns the canonical job object; adapters fill `partial`.
 * @param {object} opts
 * @param {boolean} opts.includeDescription  the *fetch* decision — whether the
 *   adapter went and got the text at all.
 * @param {boolean} [opts.emitDescription]   the *emit* decision — whether the
 *   `description*` fields appear in the output. Defaults to the fetch
 *   decision, which is the historical behaviour; they differ only when the
 *   text was fetched solely to run a filter over it.
 */
export function makeJob(partial, { source, company, includeDescription, emitDescription, includeRaw, raw }) {
  const job = {
    id: stableId(source, company, partial.externalId),
    source,
    company,
    companyName: partial.companyName ?? null,
    title: partial.title?.trim() ?? null,
    department: partial.department ?? null,
    team: partial.team ?? null,
    location: partial.location ?? null,
    locations: partial.locations?.length ? partial.locations : (partial.location ? [partial.location] : []),
    isRemote: partial.isRemote ?? looksRemote(partial.location, ...(partial.locations ?? [])),
    workplaceType: partial.workplaceType ?? null,
    employmentType: partial.employmentType ?? null,
    compensation: partial.compensation ?? null,
    url: partial.url ?? null,
    applyUrl: partial.applyUrl ?? partial.url ?? null,
    publishedAt: toIso(partial.publishedAt),
    updatedAt: toIso(partial.updatedAt),
  };
  const text = partial.descriptionText ?? htmlToText(partial.descriptionHtml);
  if (emitDescription ?? includeDescription) {
    job.descriptionHtml = partial.descriptionHtml ?? null;
    job.descriptionText = text;
  } else if (text) {
    Object.defineProperty(job, HIDDEN_DESCRIPTION_TEXT, { value: text, enumerable: false });
  }
  // `raw` is untouched by the fetch/emit split: it is the ATS payload as it
  // arrived, and asking for it means asking for all of it.
  if (includeRaw) job.raw = stripInternal(raw);
  return job;
}

/** Adapters stash fetch context on `__`-prefixed keys; they are not ATS data. */
function stripInternal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw ?? null;
  const clean = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('__')));
  return Object.keys(clean).length ? clean : null;
}
