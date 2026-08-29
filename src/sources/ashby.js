/**
 * Ashby Job Board API (public, no auth).
 * GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
 * Live-verified 2026-08-27: { jobs: [...] }; fields include id, title,
 * department, team, employmentType, location, secondaryLocations,
 * publishedAt, isListed, isRemote, workplaceType, jobUrl, applyUrl,
 * descriptionHtml/Plain, compensation{compensationTierSummary, summaryComponents[]}.
 */
export const source = 'ashby';

export function url(slug) {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
}

export function matchUrl(u) {
  if (!/(^|\.)ashbyhq\.com$/i.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean).filter((s) => !/^(job-board|posting-api)$/i.test(s));
  return segs[0] ? { slug: segs[0], company: segs[0] } : null;
}

export function extract(payload) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.filter((j) => j.isListed !== false);
}

function pickCompensation(c) {
  if (!c) return null;
  const comp = (c.summaryComponents ?? []).find((x) => x?.compensationType === 'Salary') ?? (c.summaryComponents ?? [])[0];
  if (!comp && !c.compensationTierSummary && !c.scrapeableCompensationSalarySummary) return null;
  return {
    min: comp?.minValue ?? null,
    max: comp?.maxValue ?? null,
    currency: comp?.currencyCode ?? null,
    interval: comp?.interval ?? null,
    summary: c.scrapeableCompensationSalarySummary ?? c.compensationTierSummary ?? null,
  };
}

export function transform(j) {
  const secondary = (j.secondaryLocations ?? []).map((l) => l?.location ?? l).filter((x) => typeof x === 'string');
  return {
    externalId: String(j.id),
    title: j.title,
    department: j.department ?? null,
    team: j.team ?? null,
    location: j.location ?? null,
    locations: [j.location, ...secondary].filter(Boolean),
    isRemote: j.isRemote ?? undefined,
    workplaceType: j.workplaceType ?? null,
    employmentType: j.employmentType ?? null,
    compensation: pickCompensation(j.compensation),
    url: j.jobUrl,
    applyUrl: j.applyUrl ?? j.jobUrl,
    publishedAt: j.publishedAt ?? null,
    updatedAt: null,
    descriptionHtml: j.descriptionHtml ?? null,
    descriptionText: j.descriptionPlain ?? null,
  };
}
