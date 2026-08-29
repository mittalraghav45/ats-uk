/**
 * Language of a posting, detected from its description text.
 *
 * Why this exists: a buyer scraping European boards gets a pile of German,
 * French and Dutch postings mixed into the English ones, and nothing in any
 * ATS payload says which is which. Knowing the language is what makes "only
 * the English-language roles" a filter instead of a manual pass.
 *
 * How: stopword counting. The 20-30 most frequent function words of a language
 * ("der/die/das", "de/het/een", "il/la/che") are short, closed-class and
 * dominate any real prose, so counting them is enough to separate the ten
 * languages we cover — with none of the weight of an n-gram model or a
 * dependency. What it cannot do is read a *title*: "Senior Product Manager"
 * is the same string in Berlin and in Boston, so the title is never used.
 *
 * The same rule as everywhere else in this codebase: **no guessing**. A short
 * text, a text with no description at all, or a genuinely bilingual posting
 * (plenty of German boards publish both languages in one field) returns null.
 *
 * Pure module: no I/O, no clock, no SDK.
 */

/**
 * The supported codes, in the order they are reported. ISO 639-1.
 */
export const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'sv', 'da'];

/**
 * ~25 high-frequency function words per language. Words shared between two
 * languages are not a problem — they raise both counts, and the margin rule
 * below is what decides — but each list keeps enough *distinctive* words
 * ("und" vs "en", "che" vs "que") that real prose separates cleanly.
 */
const STOPWORDS = {
  en: ['the', 'and', 'you', 'for', 'with', 'our', 'are', 'will', 'your', 'that', 'this', 'have', 'from', 'about', 'their', 'they', 'what', 'work', 'team', 'role', 'who', 'not', 'but', 'all', 'been'],
  de: ['der', 'die', 'das', 'und', 'ist', 'für', 'mit', 'von', 'den', 'ein', 'eine', 'im', 'zu', 'auf', 'nicht', 'sich', 'auch', 'werden', 'wir', 'sie', 'dem', 'des', 'oder', 'bei', 'über'],
  fr: ['le', 'la', 'les', 'des', 'une', 'est', 'vous', 'nous', 'pour', 'dans', 'avec', 'sur', 'plus', 'par', 'qui', 'que', 'sont', 'aux', 'ses', 'ces', 'votre', 'notre', 'être', 'ainsi', 'leur'],
  es: ['el', 'la', 'los', 'las', 'una', 'con', 'para', 'por', 'que', 'del', 'como', 'más', 'nuestro', 'nuestra', 'tus', 'sus', 'este', 'esta', 'ser', 'son', 'está', 'tiene', 'desde', 'entre', 'cada'],
  it: ['il', 'lo', 'la', 'gli', 'del', 'della', 'che', 'con', 'per', 'una', 'nostra', 'nostro', 'sono', 'anche', 'come', 'più', 'nel', 'nella', 'sarà', 'alla', 'dei', 'delle', 'tuo', 'tua', 'ogni'],
  nl: ['het', 'een', 'van', 'en', 'is', 'op', 'voor', 'met', 'die', 'niet', 'zijn', 'aan', 'als', 'maar', 'ook', 'worden', 'wordt', 'je', 'we', 'ons', 'onze', 'bij', 'naar', 'over', 'wij'],
  pt: ['de', 'da', 'do', 'das', 'dos', 'uma', 'com', 'para', 'por', 'que', 'não', 'como', 'mais', 'nossa', 'nosso', 'você', 'são', 'está', 'seu', 'sua', 'nas', 'nos', 'pelo', 'pela', 'entre'],
  pl: ['nie', 'się', 'jest', 'oraz', 'dla', 'przez', 'jako', 'które', 'który', 'która', 'będzie', 'praca', 'pracy', 'naszych', 'naszym', 'wraz', 'jeśli', 'także', 'tym', 'lub', 'aby', 'być', 'masz', 'nasz', 'twoje'],
  // Swedish and Danish share so many function words verbatim ('som', 'med',
  // 'på', 'den', 'det', 'vi', 'du', 'har', 'kan', 'om', 'eller', 'hos', 'dig')
  // that keeping them would leave every Scandinavian posting a tie, and a tie
  // is reported as unknown. So both lists are pruned down to the words the two
  // languages spell *differently* — och/og, är/er, inte/ikke, mycket/meget —
  // which is exactly the evidence that tells them apart.
  sv: ['och', 'att', 'för', 'är', 'till', 'av', 'inte', 'ett', 'från', 'vår', 'våra', 'också', 'här', 'när', 'där', 'hur', 'deras', 'dina', 'mycket', 'ska', 'vill', 'över', 'samt', 'vara', 'mellan'],
  da: ['og', 'at', 'for', 'er', 'til', 'af', 'ikke', 'fra', 'vores', 'også', 'her', 'hvor', 'deres', 'dine', 'meget', 'skal', 'vil', 'over', 'være', 'dette', 'denne', 'disse', 'mellem', 'under', 'efter'],
};

const LOOKUP = new Map();
for (const [lang, words] of Object.entries(STOPWORDS)) {
  for (const w of words) {
    const bucket = LOOKUP.get(w);
    if (bucket) bucket.push(lang);
    else LOOKUP.set(w, [lang]);
  }
}

/** Below this many words the counts are noise, whatever they say. */
const MIN_WORDS = 30;
/** The winner needs this many hits before it is evidence at all. */
const MIN_HITS = 6;
/** …and this much more than the runner-up, or the text is called ambiguous. */
const MIN_MARGIN = 2;

/**
 * @param {string|null|undefined} text the description text (the hidden one is
 *   fine — `descriptionTextOf(job)` returns it either way)
 * @returns {string|null} an ISO 639-1 code from LANGUAGES, or null when the
 *   text is missing, too short, or does not commit to one language. Null is a
 *   normal answer and appears on every board that publishes no description.
 */
export function detectLanguage(text) {
  if (typeof text !== 'string') return null;
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < MIN_WORDS) return null;

  const counts = new Map();
  for (const w of words) {
    const langs = LOOKUP.get(w);
    if (!langs) continue;
    for (const lang of langs) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  if (!counts.size) return null;

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || LANGUAGES.indexOf(a[0]) - LANGUAGES.indexOf(b[0]));
  const [topLang, topHits] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  if (topHits < MIN_HITS) return null;
  // A bilingual posting, or a language we do not cover that happens to share
  // function words with one we do, lands here — and is reported as unknown
  // rather than as whichever list edged ahead by one word.
  if (topHits < runnerUp * MIN_MARGIN) return null;
  return topLang;
}
