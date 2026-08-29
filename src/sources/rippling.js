/**
 * Rippling ATS public board (public, no auth).
 * GET https://api.rippling.com/platform/api/ats/v1/board/{slug}/jobs
 * Live-verified 2026-08-27: array of { uuid, name, department{id,label},
 * url, workLocation{id,label} }. The list carries no date, salary or
 * description — those are not published on this endpoint.
 */
import { looksRemote } from '../normalize.js';

export const source = 'rippling';

export function url(slug) {
  return `https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(slug)}/jobs`;
}

export function matchUrl(u) {
  const m = u.pathname.match(/^\/(?:board|[^/]+\/jobs)\/([^/]+)/i);
  if (/(^|\.)ats\.rippling\.com$/i.test(u.hostname)) {
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? { slug: seg, company: seg } : null;
  }
  return /(^|\.)rippling\.com$/i.test(u.hostname) && m ? { slug: m[1], company: m[1] } : null;
}

export function extract(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.jobs) ? payload.jobs : [];
}

export function transform(j) {
  const location = j.workLocation?.label ?? j.workLocation?.id ?? null;
  return {
    externalId: String(j.uuid ?? j.id),
    title: j.name ?? j.title,
    department: j.department?.label ?? j.department?.id ?? null,
    team: null,
    location,
    isRemote: looksRemote(location, j.name) || undefined,
    workplaceType: null,
    employmentType: j.employmentType ?? null,
    compensation: null,
    url: j.url ?? null,
    applyUrl: j.url ?? null,
    publishedAt: j.createdAt ?? null,
    updatedAt: null,
    descriptionHtml: j.description ?? null,
  };
}
