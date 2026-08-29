/**
 * Oracle Cloud HCM / Oracle Recruiting Cloud (public, no auth).
 * GET https://{host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
 *       ?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber={site},limit=N,offset=N
 * Live-verified 2026-08-27 (eeho.fa.us2.oraclecloud.com / CX_1, 2152 jobs):
 * items[0] = { TotalJobsCount, requisitionList: [ { Id, Title, PostedDate,
 * PostingEndDate, PrimaryLocation, PrimaryLocationCountry, WorkplaceType,
 * WorkplaceTypeCode, JobSchedule, JobType, Department, Organization,
 * ShortDescriptionStr, ExternalResponsibilitiesStr, ExternalQualificationsStr } ] }.
 *
 * Tenant host and site number are not derivable from a company name, so this
 * source is URL-only: paste the careers URL.
 */
import { htmlToText, looksRemote } from '../normalize.js';

export const source = 'oracle';
export const urlOnly = true;

const PAGE = 200;
const HARD_CAP = 10_000;

/** Careers URL -> {origin, site}; throws when the site number is absent. */
export function parseBoardUrl(href) {
  const u = new URL(href);
  const m = u.pathname.match(/\/sites\/([^/?#]+)/i);
  const site = m?.[1] ?? new URLSearchParams(u.search).get('siteNumber');
  if (!site) {
    throw new Error(`Oracle URL "${href}" is missing the site number — copy the full careers URL, e.g. https://tenant.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions`);
  }
  return { origin: u.origin, site, tenant: u.hostname.split('.')[0] };
}

export function url(href, _opts, offset = 0, limit = PAGE) {
  const { origin, site } = parseBoardUrl(href);
  return `${origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`
    + `?onlyData=true&expand=requisitionList`
    + `&finder=findReqs;siteNumber=${encodeURIComponent(site)},limit=${limit},offset=${offset},sortBy=POSTING_DATES_DESC`;
}

export function matchUrl(u) {
  if (!/(^|\.)oraclecloud\.com$/i.test(u.hostname)) return null;
  const { tenant } = parseBoardUrl(u.href);
  return { slug: u.href, company: tenant };
}

export function extract(payload) {
  const list = payload?.items?.[0]?.requisitionList;
  return Array.isArray(list) ? list : [];
}

export function totalFound(payload) {
  return Number(payload?.items?.[0]?.TotalJobsCount ?? 0);
}

export async function fetchAll({ slug, opts, get }) {
  const board = parseBoardUrl(slug);
  const limit = Math.min(opts.maxPerCompany ?? HARD_CAP, HARD_CAP);
  const items = [];
  let total = Infinity;
  // Advance by what the server returned, not by the page size we asked for:
  // an unannounced server-side cap would otherwise skip whole blocks of jobs.
  for (let guard = 0; items.length < Math.min(total, limit) && guard < 1_000; guard++) {
    const page = await get(url(slug, opts, items.length, PAGE));
    if (total === Infinity) total = totalFound(page) || 0;
    const batch = extract(page);
    if (!batch.length) break;
    items.push(...batch.map((j) => ({ ...j, __board: { origin: board.origin, site: board.site } })));
  }
  return items.slice(0, limit);
}

export function transform(j) {
  const { origin, site } = j.__board ?? {};
  const location = j.PrimaryLocation ?? j.PrimaryLocationCountry ?? null;
  const workplace = j.WorkplaceType ?? j.WorkplaceTypeCode ?? null;
  const html = [j.ShortDescriptionStr, j.ExternalResponsibilitiesStr, j.ExternalQualificationsStr].filter(Boolean).join('\n') || null;
  return {
    externalId: String(j.Id),
    title: j.Title,
    department: j.Department ?? j.Organization ?? j.JobFamily ?? null,
    team: j.BusinessUnit ?? null,
    location,
    locations: undefined,
    isRemote: /remote/i.test(workplace ?? '') || looksRemote(location, j.Title) || undefined,
    workplaceType: workplace,
    employmentType: j.JobSchedule ?? j.JobType ?? j.WorkerType ?? null,
    compensation: null,
    url: origin && site ? `${origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}` : null,
    applyUrl: origin && site ? `${origin}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}/apply` : null,
    publishedAt: j.PostedDate ?? null,
    updatedAt: null,
    descriptionHtml: html,
    descriptionText: html ? htmlToText(html) : null,
  };
}
