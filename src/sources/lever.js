/**
 * Lever Postings API (public, no auth).
 * GET https://api.lever.co/v0/postings/{site}?mode=json
 * Live-verified 2026-08-27: array of postings; fields include id, text,
 * country, workplaceType, hostedUrl, applyUrl, createdAt (ms epoch),
 * description(Plain), categories{commitment,department,location,team,allLocations},
 * salaryRange{min,max,currency,interval}, salaryDescriptionPlain.
 */
export const source = 'lever';

export function url(slug) {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
}

export function matchUrl(u) {
  if (!/(^|\.)lever\.co$/i.test(u.hostname)) return null;
  const seg = u.pathname.split('/').filter(Boolean)[0];
  return seg ? { slug: seg, company: seg } : null;
}

export function extract(payload) {
  return Array.isArray(payload) ? payload : [];
}

export function transform(j) {
  const cats = j.categories ?? {};
  const salary = j.salaryRange && (j.salaryRange.min != null || j.salaryRange.max != null) ? {
    min: j.salaryRange.min ?? null,
    max: j.salaryRange.max ?? null,
    currency: j.salaryRange.currency ?? null,
    interval: j.salaryRange.interval ?? null,
    summary: j.salaryDescriptionPlain?.trim() || null,
  } : null;
  return {
    externalId: String(j.id),
    title: j.text,
    department: cats.department ?? null,
    team: cats.team ?? null,
    location: cats.location ?? null,
    locations: Array.isArray(cats.allLocations) && cats.allLocations.length ? cats.allLocations : undefined,
    isRemote: j.workplaceType === 'remote' || undefined,
    workplaceType: j.workplaceType ?? null,
    employmentType: cats.commitment ?? null,
    compensation: salary,
    url: j.hostedUrl,
    applyUrl: j.applyUrl ?? j.hostedUrl,
    publishedAt: j.createdAt ?? null,
    updatedAt: null,
    descriptionHtml: j.description ?? null,
    descriptionText: j.descriptionPlain ?? null,
  };
}
