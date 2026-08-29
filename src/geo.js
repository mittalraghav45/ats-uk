/**
 * Best-effort country of a posting, as an ISO 3166-1 alpha-2 code.
 *
 * Why this exists: no ATS publishes a country field. What they publish is a
 * free-text location in fourteen different house styles — "Amsterdam,
 * Netherlands", "Rotterdam, Zuid-Holland, Nederland", "US, CA, Remote",
 * "India, Bengaluru", "Berlin, BE, de" — and a buyer who wants "only German
 * jobs" has to write that parser themselves. So we write it once.
 *
 * The rule of the whole module is the rule of `enrich.js`: **no guessing**.
 * "London" is a city in England, Ontario and Kentucky, so it returns null.
 * "Remote" returns null. A wrong country code is worse than a missing one,
 * because a missing one is visible in the data and a wrong one is not.
 *
 * What is matched, in order of trust:
 *   1. country **names**, English and the common native spellings (Deutschland,
 *      Österreich, Nederland, Sverige, Polska, Brasil, España, Éire, ...);
 *   2. the "City, STATE" shape with a US state — the one subdivision system
 *      common enough in ATS data to be worth reading (see US_STATE_ABBR);
 *   3. ISO **alpha-3** codes as a whole token (DEU, GBR, USA);
 *   4. ISO **alpha-2** codes, and only in a position where a country can
 *      plausibly be meant (see `countryCodeFromString`).
 *
 * Cities are deliberately never matched: "Milan" is also a town in Michigan,
 * and the moment a dictionary contains cities it starts inventing countries.
 *
 * Pure module: no I/O, no clock, no SDK.
 */

/**
 * ISO-2 -> [alpha-3 or null, ...names]. Names are matched after
 * normalisation (lowercased, de-accented, punctuation collapsed), so
 * "Türkiye" and "Turkiye", "U.S." and "US" all land on the same key.
 */
const COUNTRIES = {
  AD: ['AND', 'Andorra'],
  AE: ['ARE', 'United Arab Emirates', 'UAE', 'Emirates'],
  AF: ['AFG', 'Afghanistan'],
  AL: ['ALB', 'Albania', 'Shqiperia'],
  AM: ['ARM', 'Armenia'],
  AO: ['AGO', 'Angola'],
  AR: ['ARG', 'Argentina'],
  AT: ['AUT', 'Austria', 'Osterreich'],
  AU: ['AUS', 'Australia'],
  AW: ['ABW', 'Aruba'],
  AZ: ['AZE', 'Azerbaijan'],
  BA: ['BIH', 'Bosnia and Herzegovina', 'Bosnia', 'Bosna i Hercegovina'],
  BB: ['BRB', 'Barbados'],
  BD: ['BGD', 'Bangladesh'],
  BE: ['BEL', 'Belgium', 'Belgique', 'Belgie', 'Belgien'],
  BF: ['BFA', 'Burkina Faso'],
  BG: ['BGR', 'Bulgaria', 'Balgariya'],
  BH: ['BHR', 'Bahrain'],
  BI: ['BDI', 'Burundi'],
  BJ: ['BEN', 'Benin'],
  BN: ['BRN', 'Brunei'],
  BO: ['BOL', 'Bolivia'],
  BR: ['BRA', 'Brazil', 'Brasil'],
  BS: ['BHS', 'Bahamas'],
  BT: ['BTN', 'Bhutan'],
  BW: ['BWA', 'Botswana'],
  BY: ['BLR', 'Belarus'],
  BZ: ['BLZ', 'Belize'],
  CA: ['CAN', 'Canada'],
  CD: ['COD', 'Democratic Republic of the Congo', 'DR Congo'],
  CF: ['CAF', 'Central African Republic'],
  CG: ['COG', 'Republic of the Congo', 'Congo'],
  CH: ['CHE', 'Switzerland', 'Schweiz', 'Suisse', 'Svizzera', 'Svizra'],
  CI: ['CIV', "Cote d'Ivoire", 'Ivory Coast'],
  CL: ['CHL', 'Chile'],
  CM: ['CMR', 'Cameroon'],
  CN: ['CHN', 'China', 'Zhongguo', "People's Republic of China", 'PRC'],
  CO: ['COL', 'Colombia'],
  CR: ['CRI', 'Costa Rica'],
  CU: ['CUB', 'Cuba'],
  CW: ['CUW', 'Curacao'],
  CY: ['CYP', 'Cyprus', 'Kypros'],
  CZ: ['CZE', 'Czechia', 'Czech Republic', 'Cesko'],
  DE: ['DEU', 'Germany', 'Deutschland'],
  DJ: ['DJI', 'Djibouti'],
  DK: ['DNK', 'Denmark', 'Danmark'],
  DO: ['DOM', 'Dominican Republic'],
  DZ: ['DZA', 'Algeria', 'Algerie'],
  EC: ['ECU', 'Ecuador'],
  EE: ['EST', 'Estonia', 'Eesti'],
  EG: ['EGY', 'Egypt'],
  ER: ['ERI', 'Eritrea'],
  ES: ['ESP', 'Spain', 'Espana'],
  ET: ['ETH', 'Ethiopia'],
  FI: ['FIN', 'Finland', 'Suomi'],
  FJ: ['FJI', 'Fiji'],
  FO: ['FRO', 'Faroe Islands', 'Foroyar'],
  FR: ['FRA', 'France'],
  GA: ['GAB', 'Gabon'],
  GB: ['GBR', 'United Kingdom', 'UK', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'],
  GG: ['GGY', 'Guernsey'],
  GH: ['GHA', 'Ghana'],
  GI: ['GIB', 'Gibraltar'],
  GL: ['GRL', 'Greenland', 'Gronland', 'Kalaallit Nunaat'],
  GM: ['GMB', 'Gambia'],
  GN: ['GIN', 'Guinea'],
  GP: ['GLP', 'Guadeloupe'],
  GR: ['GRC', 'Greece', 'Hellas', 'Ellada'],
  GT: ['GTM', 'Guatemala'],
  GY: ['GUY', 'Guyana'],
  HK: ['HKG', 'Hong Kong'],
  HN: ['HND', 'Honduras'],
  HR: ['HRV', 'Croatia', 'Hrvatska'],
  HU: ['HUN', 'Hungary', 'Magyarorszag'],
  ID: ['IDN', 'Indonesia'],
  IE: ['IRL', 'Ireland', 'Eire'],
  IL: ['ISR', 'Israel'],
  IM: ['IMN', 'Isle of Man'],
  IN: ['IND', 'India'],
  IQ: ['IRQ', 'Iraq'],
  IR: ['IRN', 'Iran'],
  // The native "Ísland" normalises to "island", which is an English word that
  // shows up inside plenty of place names — left out on purpose.
  IS: ['ISL', 'Iceland'],
  IT: ['ITA', 'Italy', 'Italia'],
  JM: ['JAM', 'Jamaica'],
  JO: ['JOR', 'Jordan'],
  JP: ['JPN', 'Japan'],
  KE: ['KEN', 'Kenya'],
  KG: ['KGZ', 'Kyrgyzstan'],
  KH: ['KHM', 'Cambodia'],
  KR: ['KOR', 'South Korea', 'Republic of Korea', 'Korea'],
  KW: ['KWT', 'Kuwait'],
  KZ: ['KAZ', 'Kazakhstan'],
  LA: ['LAO', 'Laos'],
  LB: ['LBN', 'Lebanon'],
  LI: ['LIE', 'Liechtenstein'],
  LK: ['LKA', 'Sri Lanka'],
  LR: ['LBR', 'Liberia'],
  LS: ['LSO', 'Lesotho'],
  LT: ['LTU', 'Lithuania', 'Lietuva'],
  LU: ['LUX', 'Luxembourg', 'Luxemburg', 'Letzebuerg'],
  LV: ['LVA', 'Latvia', 'Latvija'],
  LY: ['LBY', 'Libya'],
  MA: ['MAR', 'Morocco', 'Maroc'],
  MC: ['MCO', 'Monaco'],
  MD: ['MDA', 'Moldova'],
  ME: ['MNE', 'Montenegro', 'Crna Gora'],
  MG: ['MDG', 'Madagascar'],
  MK: ['MKD', 'North Macedonia', 'Macedonia'],
  ML: ['MLI', 'Mali'],
  MM: ['MMR', 'Myanmar'],
  MN: ['MNG', 'Mongolia'],
  MO: ['MAC', 'Macao', 'Macau'],
  MQ: ['MTQ', 'Martinique'],
  MR: ['MRT', 'Mauritania'],
  MT: ['MLT', 'Malta'],
  MU: ['MUS', 'Mauritius'],
  MV: ['MDV', 'Maldives'],
  MW: ['MWI', 'Malawi'],
  MX: ['MEX', 'Mexico'],
  MY: ['MYS', 'Malaysia'],
  MZ: ['MOZ', 'Mozambique'],
  // 'NA' is excluded from code matching (BLOCKED_CODES) because it reads as
  // "not available" far more often than it reads as Namibia.
  NA: ['NAM', 'Namibia'],
  NC: ['NCL', 'New Caledonia'],
  NE: ['NER', 'Niger'],
  NG: ['NGA', 'Nigeria'],
  NI: ['NIC', 'Nicaragua'],
  NL: ['NLD', 'Netherlands', 'The Netherlands', 'Nederland', 'Holland'],
  NO: ['NOR', 'Norway', 'Norge', 'Noreg'],
  NP: ['NPL', 'Nepal'],
  NZ: ['NZL', 'New Zealand', 'Aotearoa'],
  OM: ['OMN', 'Oman'],
  PA: ['PAN', 'Panama'],
  PE: ['PER', 'Peru'],
  PF: ['PYF', 'French Polynesia'],
  PG: ['PNG', 'Papua New Guinea'],
  PH: ['PHL', 'Philippines', 'Pilipinas'],
  PK: ['PAK', 'Pakistan'],
  PL: ['POL', 'Poland', 'Polska'],
  PR: ['PRI', 'Puerto Rico'],
  PT: ['PRT', 'Portugal'],
  PY: ['PRY', 'Paraguay'],
  QA: ['QAT', 'Qatar'],
  RE: ['REU', 'Reunion'],
  RO: ['ROU', 'Romania'],
  RS: ['SRB', 'Serbia', 'Srbija'],
  RU: ['RUS', 'Russia', 'Russian Federation', 'Rossiya'],
  RW: ['RWA', 'Rwanda'],
  SA: ['SAU', 'Saudi Arabia'],
  SD: ['SDN', 'Sudan'],
  SE: ['SWE', 'Sweden', 'Sverige'],
  SG: ['SGP', 'Singapore'],
  SI: ['SVN', 'Slovenia', 'Slovenija'],
  SK: ['SVK', 'Slovakia', 'Slovensko'],
  SL: ['SLE', 'Sierra Leone'],
  SM: ['SMR', 'San Marino'],
  SN: ['SEN', 'Senegal'],
  SO: ['SOM', 'Somalia'],
  SR: ['SUR', 'Suriname'],
  SS: ['SSD', 'South Sudan'],
  SV: ['SLV', 'El Salvador'],
  SZ: ['SWZ', 'Eswatini', 'Swaziland'],
  TD: ['TCD', 'Chad'],
  TG: ['TGO', 'Togo'],
  TH: ['THA', 'Thailand'],
  TJ: ['TJK', 'Tajikistan'],
  TM: ['TKM', 'Turkmenistan'],
  TN: ['TUN', 'Tunisia', 'Tunisie'],
  TR: ['TUR', 'Turkey', 'Turkiye'],
  TT: ['TTO', 'Trinidad and Tobago'],
  TW: ['TWN', 'Taiwan'],
  TZ: ['TZA', 'Tanzania'],
  UA: ['UKR', 'Ukraine', 'Ukraina'],
  UG: ['UGA', 'Uganda'],
  US: ['USA', 'United States', 'United States of America', 'U.S.', 'U.S.A.'],
  UY: ['URY', 'Uruguay'],
  UZ: ['UZB', 'Uzbekistan'],
  VE: ['VEN', 'Venezuela'],
  VN: ['VNM', 'Vietnam', 'Viet Nam'],
  YT: ['MYT', 'Mayotte'],
  ZA: ['ZAF', 'South Africa', 'Suid-Afrika'],
  ZM: ['ZMB', 'Zambia'],
  ZW: ['ZWE', 'Zimbabwe'],
};

/**
 * Names we refuse to resolve because two plausible readings exist and nothing
 * in the string tells them apart. "Atlanta, Georgia" is the US state,
 * "Tbilisi, Georgia" is the country, and a dictionary cannot know which one a
 * bare "Georgia" meant — so it says null, which is the honest answer.
 * (GE and JE are therefore absent from COUNTRIES entirely.)
 */
export const AMBIGUOUS_NAMES = new Set(['georgia', 'jersey']);

/**
 * US state **abbreviations**, read only as the trailing half of a two-part
 * "City, XX" string — "Kansas City, MO", "Miami, FL". That narrow shape is the
 * whole point: a dozen of these sigles are also ISO-2 country codes (MO is
 * Macao, IL is Israel, DE is Germany), so anywhere else the country reading
 * wins and "Berlin, BE, de" still comes out DE.
 *
 * The residual collision is real and deliberate: "Tel Aviv, IL" reads as US.
 * Two parts and a sigle that means both is genuinely undecidable, and the US
 * reading is by far the more frequent one in ATS data. Any third part, or any
 * country name anywhere in the string, overrides it.
 */
const US_STATE_ABBR = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia',
  'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm',
  'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa',
  'wv', 'wi', 'wy',
]);

/**
 * Spelled-out US state names. These collide with nothing (except Georgia, see
 * AMBIGUOUS_NAMES), so a trailing "…, Texas" is safe to read as the United
 * States however many parts the string has.
 */
const US_STATE_NAMES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'district of columbia', 'florida', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas',
  'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
  // 'georgia' is deliberately absent: see AMBIGUOUS_NAMES.
]);

/** Two-letter codes never read as a country code, whatever their position. */
const BLOCKED_CODES = new Set(['NA']);

/**
 * Lowercase, strip accents, collapse punctuation to single spaces. Applied to
 * both the dictionary and the input so "Österreich" == "Osterreich" and
 * "U.S." == "US".
 */
function normName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NAME_TO_ISO2 = new Map();
const ISO3_TO_ISO2 = new Map();
const ISO2_CODES = new Set(Object.keys(COUNTRIES));
for (const [iso2, [iso3, ...names] ] of Object.entries(COUNTRIES)) {
  if (iso3) ISO3_TO_ISO2.set(iso3.toUpperCase(), iso2);
  for (const name of names) {
    const key = normName(name);
    if (key && !AMBIGUOUS_NAMES.has(key)) NAME_TO_ISO2.set(key, iso2);
  }
}

/**
 * Two-letter codes that are also a US state abbreviation, and therefore only
 * trusted in the trailing slot where a country belongs by convention. This is
 * exactly the "US, CA, Remote" trap: there, CA is California.
 */
const AMBIGUOUS_CODES = new Set([...ISO2_CODES].filter((c) => US_STATE_ABBR.has(c.toLowerCase())));

/** "Berlin, Germany (Remote)" -> ['Berlin', 'Germany', 'Remote'] */
function splitParts(s) {
  return String(s ?? '')
    .split(/[,;|/()[\]•·\n]+|\s+[-–—]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function codeOfToken(token, { allowAmbiguous }) {
  const t = token.trim();
  if (/^[A-Za-z]{3}$/.test(t)) return ISO3_TO_ISO2.get(t.toUpperCase()) ?? null;
  if (!/^[A-Za-z]{2}$/.test(t)) return null;
  const up = t.toUpperCase();
  if (BLOCKED_CODES.has(up) || !ISO2_CODES.has(up)) return null;
  if (!allowAmbiguous && AMBIGUOUS_CODES.has(up)) return null;
  return up;
}

/**
 * One location string -> ISO-2, or null.
 *
 * Position matters, because the ATS conventions disagree about it:
 * SmartRecruiters and Workable put the country **last** ("Amsterdam,
 * Netherlands"), Workday often puts it **first** ("India, Bengaluru"), and
 * Oracle writes "US, CA, Remote" where the country is first and the middle
 * token is a state. So names are tried last-part first, then first-part, then
 * the middle; bare codes are trusted last (they are the weakest evidence) and
 * an ambiguous two-letter code only in the trailing slot.
 */
export function countryCodeFromString(location) {
  const parts = splitParts(location);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  const first = parts[0];
  const middle = parts.slice(1, -1);

  // 1. Country names: the only evidence strong enough to trust anywhere.
  for (const part of [last, first, ...middle]) {
    const hit = NAME_TO_ISO2.get(normName(part));
    if (hit) return hit;
  }

  // 2. A trailing US state, with something in front of it, is the United
  //    States. A bare "Washington" or "Delaware" says nothing on its own, so
  //    both readings need at least two parts; the abbreviation reading is
  //    narrowed further to exactly "City, XX" (see US_STATE_ABBR).
  if (parts.length >= 2 && US_STATE_NAMES.has(normName(last))) return 'US';
  if (parts.length === 2 && US_STATE_ABBR.has(normName(last))) return 'US';

  // 3./4. Codes. Trailing slot first (the conventional country slot, so even
  //       CA/DE/IN are accepted there), then the leading slot for codes that
  //       cannot be mistaken for a US state.
  return codeOfToken(last, { allowAmbiguous: true })
    ?? codeOfToken(first, { allowAmbiguous: false })
    ?? null;
}

/**
 * @param {string|null|undefined} location the job's primary location string
 * @param {string[]} [locations] the additional location strings, if any
 * @returns {string|null} ISO 3166-1 alpha-2, uppercase, or null when the
 *   string carries no country we can read without guessing. Null is a normal,
 *   frequent answer — "Remote" and "London" are both genuinely countryless.
 */
export function countryCodeOf(location, locations) {
  const candidates = [location, ...(Array.isArray(locations) ? locations : [])];
  for (const c of candidates) {
    const hit = countryCodeFromString(c);
    if (hit) return hit;
  }
  return null;
}
