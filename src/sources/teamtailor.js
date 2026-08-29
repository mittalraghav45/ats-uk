/**
 * Teamtailor public job feed (public, no auth) — RSS XML, not JSON.
 * GET https://{slug}.teamtailor.com/jobs.rss
 * Live-verified 2026-08-27 (career, storytel, anyfin boards):
 * <rss xmlns:tt="https://teamtailor.com/locations"><channel> with the company
 * name in the channel <title>, then one <item> per job:
 *   title, description (HTML, entity-escaped), pubDate (RFC 822), link,
 *   remoteStatus, guid (UUID), tt:locations > tt:location >
 *   {tt:name, tt:address, tt:zip, tt:city, tt:country},
 *   tt:department, tt:role, tt:division.
 * The whole board is in one response — no pagination — but descriptions are
 * inline, so a large board is a multi-MB document fetched once.
 * The feed carries no pay data: `compensation` is always null. It carries no
 * employment type either.
 * `link` points at the board's public career site, which may be a custom
 * domain (jobs.storytel.com) — those hosts are therefore NOT auto-detectable
 * from a URL; only {slug}.teamtailor.com is.
 */
import { blocks, field } from '../xml.js';

export const source = 'teamtailor';

export function url(slug) {
  return `https://${encodeURIComponent(slug)}.teamtailor.com/jobs.rss`;
}

export function matchUrl(u) {
  const m = u.hostname.match(/^([^.]+)\.teamtailor\.com$/i);
  return m ? { slug: m[1], company: m[1] } : null;
}

export async function fetchAll({ slug, get }) {
  return extract(await get(url(slug), { parse: 'text' }));
}

/** Splits the feed into per-item raws, carrying the channel-level company name. */
export function extract(xml) {
  const text = String(xml ?? '');
  const head = text.split('<item>')[0];
  const company = field(head, 'title');
  return blocks(text, 'item').map((item) => ({ item, __company: company }));
}

/**
 * Live-seen values are 'none' and 'hybrid'. Teamtailor also documents
 * 'fully' (fully remote) and 'temporary' (temporarily remote), which no
 * verified board used; anything unrecognised is passed through unchanged
 * rather than guessed into the wrong bucket.
 */
const WORKPLACE = { none: 'onsite', hybrid: 'hybrid', fully: 'remote', remote: 'remote' };

function placeName(loc) {
  const parts = [field(loc, 'tt:city'), field(loc, 'tt:country')].filter(Boolean);
  return parts.join(', ') || field(loc, 'tt:name');
}

export function transform(raw) {
  const it = raw.item ?? '';
  const status = field(it, 'remoteStatus')?.toLowerCase() ?? null;
  const workplaceType = status ? WORKPLACE[status] ?? status : null;
  const locations = blocks(blocks(it, 'tt:locations')[0] ?? '', 'tt:location').map(placeName).filter(Boolean);
  const link = field(it, 'link');
  return {
    externalId: String(field(it, 'guid')),
    companyName: raw.__company ?? null,
    title: field(it, 'title'),
    department: field(it, 'tt:department'),
    team: field(it, 'tt:role'),
    location: locations[0] ?? null,
    locations: locations.length ? locations : undefined,
    isRemote: workplaceType === 'remote' || undefined,
    workplaceType,
    employmentType: null, // not in the feed
    compensation: null, // not in the feed
    url: link,
    applyUrl: link,
    publishedAt: field(it, 'pubDate'),
    updatedAt: null,
    descriptionHtml: field(it, 'description'),
  };
}
