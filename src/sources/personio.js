/**
 * Personio job feed (public, no auth) — XML, not JSON.
 * GET https://{slug}.jobs.personio.de/xml   (.com hosts resolve the same way)
 * Live-verified 2026-08-27: <workzag-jobs><position> with id, subcompany,
 * office, additionalOffices/office, department, recruitingCategory, name,
 * jobDescriptions/jobDescription{name,value}, employmentType, seniority,
 * schedule, yearsOfExperience, occupation, createdAt (ISO).
 * The feed carries no job URL, so it is built from the documented pattern.
 */
import { blocks, field, fields } from '../xml.js';

export const source = 'personio';

export function url(slug) {
  return /^https?:\/\//i.test(slug) ? slug : `https://${encodeURIComponent(slug)}.jobs.personio.de/xml`;
}

export function matchUrl(u) {
  const m = u.hostname.match(/^([^.]+)\.jobs\.personio\.(de|com)$/i);
  return m ? { slug: m[1], company: m[1] } : null;
}

export async function fetchAll({ slug, opts, get }) {
  const xml = await get(url(slug), { parse: 'text' });
  return blocks(xml, 'position').map((position) => ({ position, __slug: slug }));
}

/** Kept for symmetry with the JSON sources and for direct unit testing. */
export function extract(xml) {
  return blocks(String(xml ?? ''), 'position').map((position) => ({ position }));
}

export function transform(raw, { slug } = {}) {
  const p = raw.position ?? '';
  const id = field(p, 'id');
  const offices = [field(p, 'office'), ...fields(blocks(p, 'additionalOffices')[0] ?? '', 'office')].filter(Boolean);
  const descriptions = blocks(blocks(p, 'jobDescriptions')[0] ?? '', 'jobDescription');
  const html = descriptions
    .map((d) => {
      const name = field(d, 'name');
      const value = field(d, 'value');
      return value ? `${name ? `<h3>${name}</h3>` : ''}${value}` : null;
    })
    .filter(Boolean)
    .join('\n') || null;
  const board = raw.__slug ?? slug;
  const host = board && /^https?:\/\//i.test(board) ? new URL(board).origin : `https://${board}.jobs.personio.de`;

  return {
    externalId: String(id),
    companyName: field(p, 'subcompany'),
    title: field(p, 'name'),
    department: field(p, 'department'),
    team: field(p, 'recruitingCategory'),
    location: offices[0] ?? null,
    locations: offices.length ? offices : undefined,
    workplaceType: null,
    employmentType: field(p, 'schedule') ?? field(p, 'employmentType'),
    compensation: null,
    url: id ? `${host}/job/${id}` : null,
    applyUrl: id ? `${host}/job/${id}?display=apply` : null,
    publishedAt: field(p, 'createdAt'),
    updatedAt: null,
    descriptionHtml: html,
  };
}
