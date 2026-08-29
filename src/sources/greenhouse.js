/**
 * Greenhouse Job Board API (public, no auth).
 * GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
 * Live-verified 2026-08-27: top-level { jobs: [...] }; job fields include
 * id, title, absolute_url, location.name, updated_at, first_published,
 * departments[], offices[], company_name, content (entity-encoded HTML).
 */
import { decodeEntities, looksRemote } from '../normalize.js';

export const source = 'greenhouse';

export function url(slug, { includeDescription }) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs${includeDescription ? '?content=true' : ''}`;
}

export function matchUrl(u) {
  if (!/(^|\.)(boards|job-boards)\.greenhouse\.io$|(^|\.)greenhouse\.io$/i.test(u.hostname)) return null;
  const seg = u.pathname.split('/').filter(Boolean).filter((s) => !/^(embed|boards)$/i.test(s))[0];
  return seg ? { slug: seg, company: seg } : null;
}

export function extract(payload) {
  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

export function transform(j) {
  const location = j.location?.name ?? null;
  const offices = (j.offices ?? []).map((o) => o?.name).filter(Boolean);
  return {
    externalId: String(j.id),
    companyName: j.company_name ?? null,
    title: j.title,
    department: j.departments?.[0]?.name ?? null,
    team: null,
    location,
    locations: offices.length ? offices : undefined,
    isRemote: looksRemote(location, ...offices, j.title),
    workplaceType: null,
    employmentType: j.metadata?.find?.((m) => /employment/i.test(m?.name ?? ''))?.value ?? null,
    compensation: null,
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    publishedAt: j.first_published ?? null,
    updatedAt: j.updated_at ?? null,
    descriptionHtml: j.content ? decodeEntities(j.content) : null,
  };
}
