/**
 * Pinpoint public postings feed (public, no auth).
 * GET https://{slug}.pinpointhq.com/postings.json
 * Live-verified 2026-08-27 (workwithus, cazoo, plentific, kaluza boards):
 * { data: [...] } — the whole board comes back in one response, there is no
 * pagination (a `page` query param is ignored and the response carries no
 * cursor or Link header). Unknown subdomains answer 404, so probing a bare
 * slug is safe; a live board with nothing open answers 200 with `data: []`.
 * Posting fields: id, title, url, path, employment_type ('full_time'),
 * employment_type_text ('Full Time'), workplace_type ('remote'|'onsite'|null),
 * workplace_type_text, compensation (display text, e.g. '£48,000 - £75,000 /
 * year' or 'Competitive'), compensation_minimum, compensation_maximum,
 * compensation_currency, compensation_frequency, compensation_visible,
 * deadline_at, description, benefits(+_header), key_responsibilities(+_header),
 * skills_knowledge_expertise(+_header), reporting_to,
 * job{id,requisition_id,department{id,name},division{id,name}},
 * location{id,name,city,province,postal_code,street_address}.
 * No publication date is exposed anywhere in the payload (`deadline_at` is a
 * closing date, not a posting date), so `publishedAt` is null and `daysOpen`
 * stays null for this source — guessing one would fake the ghost-job signal.
 */
export const source = 'pinpoint';

export function url(slug) {
  return `https://${encodeURIComponent(slug)}.pinpointhq.com/postings.json`;
}

export function matchUrl(u) {
  const m = u.hostname.match(/^([^.]+)\.pinpointhq\.com$/i);
  return m ? { slug: m[1], company: m[1] } : null;
}

export function extract(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function num(v) {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pinpoint publishes pay as four structured fields plus a display string.
 * Two deliberate rules:
 *  - `compensation_visible: false` means the employer chose not to publish
 *    pay, so nothing is reported even if the numeric fields carry values.
 *  - a display string with no numbers ('Competitive') is not pay data: it
 *    cannot be compared, and letting it satisfy `hasSalary` would mislead.
 */
export function pickCompensation(j) {
  if (j?.compensation_visible === false) return null;
  const min = num(j?.compensation_minimum);
  const max = num(j?.compensation_maximum);
  if (min === null && max === null) return null;
  const text = typeof j.compensation === 'string' && j.compensation.trim() ? j.compensation.trim() : null;
  const currency = j.compensation_currency ?? null;
  const interval = j.compensation_frequency ?? null;
  return {
    min,
    max,
    currency,
    interval,
    summary: text ?? `${[min, max].filter((x) => x !== null).join('–')} ${currency ?? ''}${interval ? `/${interval}` : ''}`.trim(),
  };
}

/** `name` is the label the board shows ('Remote', 'London'); the parts are the fallback. */
function placeName(l) {
  if (!l) return null;
  const parts = [...new Set([l.city, l.province].filter(Boolean))];
  return l.name ?? (parts.join(', ') || null);
}

export function transform(j, { slug } = {}) {
  const path = typeof j.path === 'string' ? j.path : null;
  const href = j.url ?? (path && slug ? `https://${slug}.pinpointhq.com${path}` : null);
  return {
    externalId: String(j.id),
    title: j.title,
    department: j.job?.department?.name ?? null,
    // Pinpoint's org tree is division > department; `division` is the closest
    // thing the feed has to a team.
    team: j.job?.division?.name ?? null,
    location: placeName(j.location),
    isRemote: j.workplace_type === 'remote' || undefined,
    // Already the canonical vocabulary ('remote' | 'onsite' | 'hybrid').
    workplaceType: j.workplace_type ?? null,
    employmentType: j.employment_type_text ?? j.employment_type ?? null,
    compensation: pickCompensation(j),
    url: href,
    applyUrl: href,
    publishedAt: null, // not published by this API — see the header comment
    updatedAt: null,
    descriptionHtml: j.description ?? null,
  };
}
