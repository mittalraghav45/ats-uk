/**
 * Workable public widget API (public, no auth).
 * GET https://apply.workable.com/api/v1/widget/accounts/{account}?details=true
 * Live-verified 2026-08-27: { name, description, jobs: [...] }; job fields
 * include title, shortcode, employment_type, telecommuting, department,
 * url, application_url, published_on, created_at, country, city, state,
 * locations[{country,countryCode,city,region,hidden}], description.
 */
export const source = 'workable';

export function url(slug, { includeDescription }) {
  return `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}${includeDescription ? '?details=true' : ''}`;
}

export function matchUrl(u) {
  if (!/(^|\.)workable\.com$/i.test(u.hostname)) return null;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  return seg ? { slug: seg, company: seg } : null;
}

export function extract(payload) {
  return Array.isArray(payload?.jobs) ? payload.jobs.map((j) => ({ ...j, __companyName: payload.name ?? null })) : [];
}

export function transform(j) {
  const parts = [j.city, j.state, j.country].filter(Boolean);
  const locs = (j.locations ?? []).filter((l) => !l.hidden).map((l) => [l.city, l.region, l.country].filter(Boolean).join(', ')).filter(Boolean);
  return {
    externalId: String(j.shortcode ?? j.code ?? j.url),
    companyName: j.__companyName,
    title: j.title,
    department: j.department ?? null,
    team: null,
    location: parts.join(', ') || locs[0] || null,
    locations: locs.length ? locs : undefined,
    isRemote: j.telecommuting === true || undefined,
    workplaceType: j.telecommuting === true ? 'remote' : null,
    employmentType: j.employment_type ?? null,
    compensation: null,
    url: j.url,
    applyUrl: j.application_url ?? j.url,
    publishedAt: j.published_on ?? j.created_at ?? null,
    updatedAt: null,
    descriptionHtml: j.description ?? null,
  };
}
