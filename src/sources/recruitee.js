/**
 * Recruitee public offers API (public, no auth).
 * GET https://{company}.recruitee.com/api/offers/
 * Live-verified 2026-08-27 (greenchoice board): { offers: [...] }; offer
 * fields include id, title, slug, department, city, country, location,
 * locations[{city,name,country}], remote, hybrid, on_site,
 * employment_type_code, careers_url, careers_apply_url, published_at,
 * created_at, updated_at, salary{min,max,period,currency}, description.
 * Note: unknown subdomains may answer 200 with the Tellent marketing page —
 * extract() returns [] there because it only reads a JSON `offers` array.
 */
export const source = 'recruitee';

export function url(slug) {
  return `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`;
}

export function matchUrl(u) {
  const m = u.hostname.match(/^([^.]+)\.recruitee\.com$/i);
  return m ? { slug: m[1], company: m[1] } : null;
}

export function extract(payload) {
  return Array.isArray(payload?.offers) ? payload.offers : [];
}

function pickCompensation(s) {
  const min = Number.parseFloat(s?.min);
  const max = Number.parseFloat(s?.max);
  if (!Number.isFinite(min) && !Number.isFinite(max)) return null;
  const range = [Number.isFinite(min) ? min : null, Number.isFinite(max) ? max : null];
  return {
    min: range[0],
    max: range[1],
    currency: s.currency ?? null,
    interval: s.period ?? null,
    summary: `${range.filter((x) => x !== null).join('–')} ${s.currency ?? ''}${s.period ? `/${s.period}` : ''}`.trim(),
  };
}

function pickWorkplaceType(j) {
  if (j.remote === true) return 'remote';
  if (j.hybrid === true) return 'hybrid';
  if (j.on_site === true) return 'onsite';
  return null;
}

export function transform(j) {
  const location = j.location || [j.city, j.country].filter(Boolean).join(', ') || null;
  const locations = Array.isArray(j.locations)
    ? j.locations.map((l) => [l?.city ?? l?.name, l?.country].filter(Boolean).join(', ')).filter(Boolean)
    : undefined;
  return {
    externalId: String(j.id ?? j.slug),
    title: j.title,
    department: typeof j.department === 'string' ? j.department : j.department?.name ?? null,
    team: null,
    location,
    locations,
    isRemote: j.remote === true || undefined,
    workplaceType: pickWorkplaceType(j),
    employmentType: j.employment_type_code ?? j.employment_type ?? null,
    compensation: pickCompensation(j.salary),
    url: j.careers_url ?? null,
    applyUrl: j.careers_apply_url ?? j.careers_url ?? null,
    publishedAt: j.published_at ?? j.created_at ?? null,
    updatedAt: j.updated_at ?? null,
    descriptionHtml: j.description ?? null,
  };
}
