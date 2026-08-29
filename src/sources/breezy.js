/**
 * Breezy HR public board (public, no auth).
 * GET https://{slug}.breezy.hr/json
 * Live-verified 2026-08-27: array of positions with id, friendly_id, name,
 * url, published_date (ISO), type{id,name}, department,
 * location{city,state{name},country{name},is_remote,name}, locations[],
 * salary (free-text string), company{name,friendly_id}.
 */
export const source = 'breezy';

export function url(slug) {
  return `https://${encodeURIComponent(slug)}.breezy.hr/json`;
}

export function matchUrl(u) {
  const m = u.hostname.match(/^([^.]+)\.breezy\.hr$/i);
  return m ? { slug: m[1], company: m[1] } : null;
}

export function extract(payload) {
  return Array.isArray(payload) ? payload : [];
}

function placeName(l) {
  if (!l) return null;
  const parts = [l.city, l.state?.name ?? l.state, l.country?.name ?? l.country].filter(Boolean);
  return l.name ?? (parts.join(', ') || null);
}

/** Breezy publishes salary as display text ("$90,000 – $120,000 / year"). */
export function parseSalary(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const nums = [...text.matchAll(/(\d[\d.,]*)\s*(k)?/gi)]
    .map((m) => {
      const n = Number.parseFloat(m[1].replace(/,/g, ''));
      return Number.isFinite(n) ? (m[2] ? n * 1000 : n) : null;
    })
    .filter((n) => n !== null && n > 0);
  const currency = /€|eur/i.test(text) ? 'EUR' : /£|gbp/i.test(text) ? 'GBP' : /\$|usd/i.test(text) ? 'USD' : null;
  const interval = /hour|hr\b/i.test(text) ? 'hour' : /month/i.test(text) ? 'month' : /day/i.test(text) ? 'day' : /year|annum|annual/i.test(text) ? 'year' : null;
  if (!nums.length && !currency) return null;
  return {
    min: nums.length ? Math.min(...nums) : null,
    max: nums.length > 1 ? Math.max(...nums) : null,
    currency,
    interval,
    summary: text.trim(),
  };
}

export function transform(j) {
  const primary = placeName(j.location);
  const all = Array.isArray(j.locations) ? j.locations.map(placeName).filter(Boolean) : [];
  return {
    externalId: String(j.id ?? j.friendly_id),
    companyName: j.company?.name ?? null,
    title: j.name,
    department: typeof j.department === 'string' ? j.department : j.department?.name ?? null,
    team: null,
    location: primary,
    locations: all.length ? all : undefined,
    isRemote: j.location?.is_remote === true || undefined,
    workplaceType: j.location?.is_remote === true ? 'remote' : null,
    employmentType: j.type?.name ?? j.type?.id ?? null,
    compensation: parseSalary(j.salary),
    url: j.url ?? null,
    applyUrl: j.url ? `${j.url}/apply` : null,
    publishedAt: j.published_date ?? null,
    updatedAt: null,
    descriptionHtml: j.description ?? null,
  };
}
