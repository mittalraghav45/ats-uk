/**
 * Workday CXS careers API (public, no auth).
 * POST https://{host}/wday/cxs/{tenant}/{site}/jobs   body {appliedFacets,limit,offset,searchText}
 * Live-verified 2026-08-27 (NVIDIA, Salesforce): { total, jobPostings: [
 *   { title, externalPath, locationsText, postedOn, bulletFields } ] }.
 * Detail (one GET per job, only when descriptions are requested):
 *   { jobPostingInfo: { startDate, timeType, location, additionalLocations,
 *     jobReqId, externalUrl, jobDescription } }.
 *
 * Workday tenants are not guessable from a company name, so this source is
 * URL-only: users paste the careers URL and the tenant/site are read from it.
 */
import { htmlToText } from '../normalize.js';

export const source = 'workday';
export const urlOnly = true;

const PAGE = 20; // Workday caps a page at 20 regardless of what you ask for.
const HARD_CAP = 5_000;
const LOCALE = /^[a-z]{2}-[A-Za-z]{2}$/;
const NOISE = new Set(['wday', 'cxs', 'recruiting', 'jobs', 'job', 'details', 'en']);

/** Careers URL -> {host, tenant, site}; throws if the URL is not a board. */
export function parseBoardUrl(href) {
  const u = new URL(href);
  const segs = u.pathname.split('/').filter(Boolean).filter((s) => !LOCALE.test(s) && !NOISE.has(s.toLowerCase()));
  const hostLabel = u.hostname.split('.')[0];
  // {tenant}.wdN.myworkdayjobs.com/{site}  vs  wdN.myworkdaysite.com/{tenant}/{site}
  const hostIsGateway = /^wd\d+$/i.test(hostLabel);
  const tenant = hostIsGateway ? segs.shift() : hostLabel;
  const site = segs.shift();
  if (!tenant || !site) {
    throw new Error(`Workday URL "${href}" is missing the tenant or career-site path — copy the full careers URL, e.g. https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`);
  }
  return { host: u.host, tenant, site, origin: u.origin };
}

export function url(href) {
  const { origin, tenant, site } = parseBoardUrl(href);
  return `${origin}/wday/cxs/${tenant}/${site}/jobs`;
}

export function matchUrl(u) {
  if (!/(^|\.)myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/i.test(u.hostname)) return null;
  const { tenant } = parseBoardUrl(u.href);
  return { slug: u.href, company: tenant };
}

export function extract(payload) {
  return Array.isArray(payload?.jobPostings) ? payload.jobPostings : [];
}

/**
 * Workday's list view dates jobs as "Posted 3 Days Ago" — no timestamp. We
 * turn that into an approximate date so `postedAfter` still works; exact
 * dates come from the detail call when descriptions are requested.
 */
export function approxPostedAt(text, now = Date.now()) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  if (/today|just posted/.test(t)) return new Date(now).toISOString();
  if (/yesterday/.test(t)) return new Date(now - 864e5).toISOString();
  const days = t.match(/(\d+)\+?\s*day/);
  if (days) return new Date(now - Number(days[1]) * 864e5).toISOString();
  const months = t.match(/(\d+)\+?\s*month/);
  if (months) return new Date(now - Number(months[1]) * 30 * 864e5).toISOString();
  return null;
}

export async function fetchAll({ slug, opts, get }) {
  const endpoint = url(slug);
  const { origin, tenant, site } = parseBoardUrl(slug);
  const limit = Math.min(opts.maxPerCompany ?? HARD_CAP, HARD_CAP);
  const items = [];

  // Workday reports the real `total` only on the first page (later pages say 0),
  // so paging is driven by batch size: a short page is the last page.
  for (let offset = 0; offset < limit; offset += PAGE) {
    const page = await get(endpoint, { method: 'POST', body: { appliedFacets: {}, limit: PAGE, offset, searchText: '' } });
    const batch = extract(page);
    items.push(...batch);
    if (batch.length < PAGE) break;
  }

  const capped = items.slice(0, limit);
  if (!opts.includeDescription) return capped.map((j) => ({ ...j, __board: { origin, tenant, site } }));

  // Descriptions and exact dates need one detail call per job.
  const detailed = [];
  for (const j of capped) {
    const board = { origin, tenant, site };
    try {
      const d = await get(`${origin}/wday/cxs/${tenant}/${site}${j.externalPath}`);
      detailed.push({ ...j, __board: board, __detail: d?.jobPostingInfo ?? null });
    } catch {
      detailed.push({ ...j, __board: board }); // a missing detail must not drop the job
    }
  }
  return detailed;
}

export function transform(j) {
  const { origin, site } = j.__board ?? {};
  const d = j.__detail ?? null;
  const primary = d?.location ?? (/^\d+\s+locations?$/i.test(j.locationsText ?? '') ? null : j.locationsText ?? null);
  const locations = [primary, ...(d?.additionalLocations ?? [])].filter(Boolean);
  return {
    externalId: String(d?.jobReqId ?? j.bulletFields?.[0] ?? j.externalPath),
    title: j.title,
    department: null,
    team: null,
    location: primary,
    locations: locations.length ? locations : undefined,
    workplaceType: null,
    employmentType: d?.timeType ?? null,
    compensation: null,
    url: d?.externalUrl ?? (origin && site ? `${origin}/${site}${j.externalPath}` : null),
    applyUrl: d?.externalUrl ?? (origin && site ? `${origin}/${site}${j.externalPath}/apply` : null),
    publishedAt: d?.startDate ?? approxPostedAt(j.postedOn),
    updatedAt: null,
    descriptionHtml: d?.jobDescription ?? null,
    descriptionText: d?.jobDescription ? htmlToText(d.jobDescription) : null,
  };
}
