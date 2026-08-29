/**
 * SmartRecruiters Posting API (public, no auth).
 * GET https://api.smartrecruiters.com/v1/companies/{company}/postings?limit=100&offset=N
 * Live-verified 2026-08-27 (smoke test): shape matches the documented
 * contract. { totalFound, content: [...] }; posting fields include id, uuid,
 * name, releasedDate, location{city,region,country,remote},
 * department{label}, typeOfEmployment{label}, company{name}.
 */
export const source = 'smartrecruiters';

export function url(slug, _opts, offset = 0) {
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100&offset=${offset}`;
}

export function matchUrl(u) {
  if (!/(^|\.)smartrecruiters\.com$/i.test(u.hostname)) return null;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  return seg ? { slug: seg, company: seg } : null;
}

export function extract(payload) {
  return Array.isArray(payload?.content) ? payload.content : [];
}

export function totalFound(payload) {
  return Number(payload?.totalFound ?? 0);
}

const PAGE = 100;
const HARD_CAP = 10_000;

export async function fetchAll({ slug, opts, get }) {
  const limit = Math.min(opts.maxPerCompany ?? HARD_CAP, HARD_CAP);
  const first = await get(url(slug, opts, 0));
  const items = extract(first);
  const total = Math.min(totalFound(first), limit);
  for (let offset = PAGE; offset < total; offset += PAGE) {
    const batch = extract(await get(url(slug, opts, offset)));
    if (!batch.length) break;
    items.push(...batch);
  }
  return items;
}

export function transform(j, { slug }) {
  const loc = j.location ?? {};
  const location = [loc.city, loc.region, loc.country].filter(Boolean).join(', ') || null;
  return {
    externalId: String(j.id ?? j.uuid),
    companyName: j.company?.name ?? null,
    title: j.name,
    department: j.department?.label ?? null,
    team: j.function?.label ?? null,
    location,
    isRemote: loc.remote === true || undefined,
    workplaceType: loc.remote === true ? 'remote' : null,
    employmentType: j.typeOfEmployment?.label ?? null,
    compensation: null,
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${j.id}`,
    applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${j.id}`,
    publishedAt: j.releasedDate ?? null,
    updatedAt: null,
  };
}
