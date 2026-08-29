/**
 * Eightfold AI talent platform (public, no auth).
 * GET https://{host}/api/apply/v2/jobs?start=N&num=M
 * Live-verified 2026-08-27 (bayer.eightfold.ai, 590 jobs): { count,
 * positions: [ { id, name, location, locations[], department, business_unit,
 * t_create, t_update (epoch seconds), ats_job_id, display_job_id,
 * work_location_option, canonicalPositionUrl, job_description } ] }.
 * The `domain` query param is optional — the host alone resolves the board.
 * Custom career hosts (careers.acme.com) work too, via the URL form.
 */
import { htmlToText } from '../normalize.js';

export const source = 'eightfold';

const PAGE = 100;
const HARD_CAP = 10_000;

export function url(slug, _opts, start = 0, num = PAGE) {
  const origin = /^https?:\/\//i.test(slug) ? new URL(slug).origin : `https://${encodeURIComponent(slug)}.eightfold.ai`;
  return `${origin}/api/apply/v2/jobs?start=${start}&num=${num}`;
}

export function matchUrl(u) {
  const m = u.hostname.match(/^([^.]+)\.eightfold\.ai$/i);
  if (m) return { slug: m[1], company: m[1] };
  // Custom career hosts proxy the same API; keep the URL and label by host.
  return /\/api\/apply\/v\d\/jobs/i.test(u.pathname) ? { slug: u.href, company: u.hostname.split('.')[0] } : null;
}

export function extract(payload) {
  return Array.isArray(payload?.positions) ? payload.positions : [];
}

export function totalFound(payload) {
  return Number(payload?.count ?? 0);
}

export async function fetchAll({ slug, opts, get }) {
  const limit = Math.min(opts.maxPerCompany ?? HARD_CAP, HARD_CAP);
  const items = [];
  let total = Infinity;
  // Eightfold silently caps the page size below whatever `num` asks for, so
  // the cursor advances by what actually came back — never by an assumed page.
  for (let guard = 0; items.length < Math.min(total, limit) && guard < 1_000; guard++) {
    const page = await get(url(slug, opts, items.length, PAGE));
    if (total === Infinity) total = totalFound(page) || 0;
    const batch = extract(page);
    if (!batch.length) break;
    items.push(...batch);
  }
  return items.slice(0, limit);
}

const toIsoSeconds = (s) => (Number.isFinite(Number(s)) && Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null);

export function transform(j) {
  const option = j.work_location_option ?? j.location_flexibility ?? null;
  return {
    externalId: String(j.ats_job_id ?? j.display_job_id ?? j.id),
    title: j.name ?? j.posting_name,
    department: j.department ?? null,
    team: j.business_unit ?? null,
    location: j.location ?? null,
    locations: Array.isArray(j.locations) && j.locations.length ? j.locations : undefined,
    isRemote: /remote/i.test(option ?? '') || undefined,
    workplaceType: option,
    employmentType: j.employment_type ?? null,
    compensation: null,
    url: j.canonicalPositionUrl ?? null,
    applyUrl: j.canonicalPositionUrl ?? null,
    publishedAt: toIsoSeconds(j.t_create),
    updatedAt: toIsoSeconds(j.t_update),
    descriptionHtml: j.job_description || null,
    descriptionText: j.job_description ? htmlToText(j.job_description) : null,
  };
}
