/**
 * countryCode: the ISO-2 read out of the free-text location, and the filter
 * built on it. The cases below are the real string shapes our fourteen
 * adapters produce, not invented ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../src/scrape.js';
import { countryCodeOf, countryCodeFromString } from '../src/geo.js';
import { jobPassesFilters, parseCountryFilter } from '../src/filters.js';

// ---- shared harness (same shape as pipeline.test.js) ------------------------
function fakeFetch(routes) {
  const impl = async (url) => {
    for (const [pattern, payload] of routes) {
      if (url.includes(pattern)) {
        if (typeof payload === 'number') return { ok: false, status: payload, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => payload, text: async () => String(payload) };
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return impl;
}

function collectSink() {
  const jobs = [];
  return { jobs, pushJobs: async (batch) => { jobs.push(...batch); }, log: { info() {}, warning() {} } };
}

const T0 = Date.parse('2026-08-20T00:00:00.000Z');

/** A greenhouse-shaped board whose postings sit in the given locations. */
function ghBoard(slug, locations) {
  return {
    jobs: locations.map((location, n) => ({
      id: `${slug}-${n}`,
      title: `Engineer ${n}`,
      absolute_url: `https://boards.greenhouse.io/${slug}/jobs/${n}`,
      location: { name: location },
      first_published: '2026-08-19T09:00:00-00:00',
      updated_at: '2026-08-19T09:00:00-00:00',
      company_name: slug,
      departments: [], offices: [], metadata: [], content: '',
    })),
  };
}
const ghUrl = (slug) => `boards/${slug}/jobs`;

const passes = (job, o) => jobPassesFilters(job, { parsedQuery: null, locationFilter: null, remoteOnly: false, postedAfterIso: null, ...o });

// ---- the real ATS strings ---------------------------------------------------
test('geo: the country name is read wherever the ATS decided to put it', () => {
  // Trailing country — SmartRecruiters, Workable, Recruitee, Greenhouse.
  assert.equal(countryCodeFromString('Amsterdam, Netherlands'), 'NL');
  assert.equal(countryCodeFromString('Milan, Italy'), 'IT');
  assert.equal(countryCodeFromString('Stockholm, Sweden'), 'SE');
  assert.equal(countryCodeFromString('Brisbane,Queensland,Australia'), 'AU', 'no spaces after the commas');

  // Native spellings, which EU boards publish untranslated.
  assert.equal(countryCodeFromString('Rotterdam, Zuid-Holland, Nederland'), 'NL');
  assert.equal(countryCodeFromString('München, Deutschland'), 'DE');
  assert.equal(countryCodeFromString('Wien, Österreich'), 'AT');
  assert.equal(countryCodeFromString('Zürich, Schweiz'), 'CH');
  assert.equal(countryCodeFromString('Bruxelles, Belgique'), 'BE');
  assert.equal(countryCodeFromString('Warszawa, Polska'), 'PL');
  assert.equal(countryCodeFromString('São Paulo, Brasil'), 'BR');
  assert.equal(countryCodeFromString('København, Danmark'), 'DK');
  assert.equal(countryCodeFromString('Dublin, Éire'), 'IE');

  // Leading country — Workday writes "Country, City".
  assert.equal(countryCodeFromString('India, Bengaluru'), 'IN');
  assert.equal(countryCodeFromString('Japan, Tokyo'), 'JP');
});

test('geo: bare ISO codes are read only where a country can be meant', () => {
  // Oracle's shape. The country is the *first* token and the middle one is a
  // US state: reading 'CA' here as Canada is the classic bug.
  assert.equal(countryCodeFromString('US, CA, Remote'), 'US');
  // SmartRecruiters lower-cases the country code and puts it last.
  assert.equal(countryCodeFromString('Berlin, BE, de'), 'DE');
  assert.equal(countryCodeFromString('Dublin, IE'), 'IE', 'IE is no US state, so the country reading is safe');
  assert.equal(countryCodeFromString('San Francisco, CA, USA'), 'US', 'alpha-3 in the trailing slot');
  assert.equal(countryCodeFromString('Paris, FRA'), 'FR');
  assert.equal(countryCodeFromString('Remote, N/A'), null, "'NA' is 'not available' far more often than Namibia");
});

test('geo: a trailing US state is the United States, and only in that shape', () => {
  // Documented last resort: the sigles collide with ISO-2 codes (MO is Macao),
  // so they are only read as a state in a plain two-part "City, XX" string.
  assert.equal(countryCodeFromString('Kansas City, MO'), 'US');
  assert.equal(countryCodeFromString('Miami, FL'), 'US');
  assert.equal(countryCodeFromString('New York, NY'), 'US');
  assert.equal(countryCodeFromString('Austin, Texas'), 'US', 'spelled-out states too');
  assert.equal(countryCodeFromString('Austin, Texas, United States'), 'US');
  // Three parts: the trailing token is read as a country code again, which is
  // what keeps "Berlin, BE, de" German.
  assert.equal(countryCodeFromString('Berlin, Mitte, de'), 'DE');
  assert.equal(countryCodeFromString('Washington'), null, 'a state name alone says nothing');
});

test('geo: null whenever the string does not actually say', () => {
  assert.equal(countryCodeFromString('London'), null, 'a city is a city — London is also in Ontario and Kentucky');
  assert.equal(countryCodeFromString('Remote'), null);
  assert.equal(countryCodeFromString('Anywhere in Europe'), null);
  assert.equal(countryCodeFromString(''), null);
  assert.equal(countryCodeFromString(null), null);
  assert.equal(countryCodeFromString(undefined), null);
  // Georgia is a country and a US state, and nothing in either string decides
  // it. Both readings would be a guess, so neither is made.
  assert.equal(countryCodeFromString('Atlanta, Georgia'), null);
  assert.equal(countryCodeFromString('Tbilisi, Georgia'), null);
});

test('geo: parentheses and dashes are separators, not part of the name', () => {
  assert.equal(countryCodeFromString('Berlin, Germany (Remote)'), 'DE');
  assert.equal(countryCodeFromString('Remote (Spain)'), 'ES');
  assert.equal(countryCodeFromString('Lisbon - Portugal'), 'PT');
});

test('geo: countryCodeOf falls back to the other locations of a multi-site posting', () => {
  assert.equal(countryCodeOf('Remote', ['Remote', 'Berlin, Germany']), 'DE');
  assert.equal(countryCodeOf(null, ['Paris, France']), 'FR');
  assert.equal(countryCodeOf('Remote', []), null);
  assert.equal(countryCodeOf('Remote', undefined), null);
  assert.equal(countryCodeOf('Milan, Italy', ['Berlin, Germany']), 'IT', 'the primary location wins');
});

// ---- the filter -------------------------------------------------------------
test('countryFilter: comma is OR, case-insensitive, and an unreadable country cannot match', () => {
  const wanted = parseCountryFilter('de, at, ch');
  assert.deepEqual([...wanted], ['DE', 'AT', 'CH']);
  assert.equal(passes({ title: 'X', countryCode: 'DE' }, { countryIn: wanted }), true);
  assert.equal(passes({ title: 'X', countryCode: 'CH' }, { countryIn: wanted }), true);
  assert.equal(passes({ title: 'X', countryCode: 'FR' }, { countryIn: wanted }), false);
  // The documented rule: only jobs whose country could be determined.
  assert.equal(passes({ title: 'X', countryCode: null }, { countryIn: wanted }), false);
  assert.equal(passes({ title: 'X' }, { countryIn: wanted }), false, 'and a missing field is not a free pass either');
  assert.equal(passes({ title: 'X', countryCode: null }, { countryIn: null }), true, 'inactive filter keeps everything');
  assert.equal(parseCountryFilter('  '), null);
  assert.equal(parseCountryFilter(undefined), null);
});

// ---- end to end -------------------------------------------------------------
test('pipeline: every emitted job carries countryCode, and countryFilter uses it', async () => {
  const board = ghBoard('acme', ['Amsterdam, Netherlands', 'Berlin, Germany', 'Remote']);

  const all = collectSink();
  await runScrape({ companies: ['greenhouse:acme'], _nowMs: T0 }, all, fakeFetch([[ghUrl('acme'), board]]));
  assert.deepEqual(all.jobs.map((j) => j.countryCode), ['NL', 'DE', null], 'present and null, not absent');

  const dutch = collectSink();
  const summary = await runScrape(
    { companies: ['greenhouse:acme'], countryFilter: 'nl', _nowMs: T0 },
    dutch,
    fakeFetch([[ghUrl('acme'), board]]),
  );
  assert.deepEqual(dutch.jobs.map((j) => j.location), ['Amsterdam, Netherlands']);
  assert.equal(summary.totalFiltered, 2, 'the German one and the countryless one');
});
