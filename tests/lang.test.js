/**
 * language: the posting's language, read from the description text, and the
 * filter built on it. The snippets are the kind of prose real job ads open
 * with — the detector has never seen these words as a training set, it only
 * counts function words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runScrape } from '../src/scrape.js';
import { detectLanguage } from '../src/lang.js';
import { jobPassesFilters, parseLanguageFilter } from '../src/filters.js';

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

function ghBoard(slug, jobs) {
  return {
    jobs: jobs.map(({ title, content = '' }, n) => ({
      id: `${slug}-${n}`,
      title,
      absolute_url: `https://boards.greenhouse.io/${slug}/jobs/${n}`,
      location: { name: 'Berlin, Germany' },
      first_published: '2026-08-19T09:00:00-00:00',
      updated_at: '2026-08-19T09:00:00-00:00',
      company_name: slug,
      departments: [], offices: [], metadata: [], content,
    })),
  };
}
const ghUrl = (slug) => `boards/${slug}/jobs`;

const passes = (job, o) => jobPassesFilters(job, { parsedQuery: null, locationFilter: null, remoteOnly: false, postedAfterIso: null, ...o });

const SNIPPETS = {
  en: 'We are looking for a Senior Backend Engineer to join our platform team in London. You will work with the product and design teams to build and ship the services that our customers rely on every day. This role is for someone who has experience with distributed systems and who wants real ownership over what they build. Our team is small but growing fast, and you will have all the support you need from day one.',
  de: 'Wir suchen eine erfahrene Softwareentwicklerin oder einen erfahrenen Softwareentwickler für unser Team in Berlin. Du arbeitest gemeinsam mit dem Produktteam an der Weiterentwicklung unserer Plattform und bist für die Qualität des Codes verantwortlich. Bei uns wird nicht nur programmiert, sondern auch diskutiert, denn die besten Lösungen entstehen im Austausch. Wenn du dich in einem agilen Umfeld wohl fühlst und mit modernen Technologien arbeiten möchtest, freuen wir uns über deine Bewerbung.',
  fr: "Nous recherchons un ingénieur logiciel confirmé pour rejoindre notre équipe à Paris. Vous travaillerez avec les équipes produit et design sur des projets qui touchent des millions d'utilisateurs dans le monde. Ce poste est fait pour vous si vous aimez les défis techniques et que vous souhaitez avoir un impact réel sur le produit. Notre culture est fondée sur la confiance et sur le partage des connaissances entre tous les membres de nos équipes.",
  es: 'Buscamos una persona desarrolladora de software para unirse a nuestro equipo en Madrid. Trabajarás con el equipo de producto y con las personas de diseño en proyectos que llegan a millones de usuarios cada mes. Este puesto es para ti si te gustan los retos técnicos y si quieres tener un impacto real en el producto. Nuestra cultura está basada en la confianza y en el aprendizaje continuo entre todas las personas del equipo.',
  it: 'Cerchiamo una persona da inserire nel nostro team di sviluppo con sede a Milano. Lavorerai insieme al team di prodotto e a quello di design su progetti che raggiungono milioni di utenti ogni mese. Questa posizione è pensata per chi ama le sfide tecniche e per chi vuole avere un impatto reale sul prodotto della nostra azienda. La nostra cultura si basa sulla fiducia e sulla condivisione delle conoscenze tra tutte le persone del team.',
  nl: 'Wij zoeken een ervaren software engineer voor ons team in Amsterdam. Je werkt samen met het productteam en met de mensen van design aan projecten die elke maand door miljoenen gebruikers worden gebruikt. Deze functie is voor jou als je houdt van technische uitdagingen en als je echte impact wilt hebben op het product. Onze cultuur is gebaseerd op vertrouwen en op het delen van kennis met alle mensen in ons team.',
  sv: 'Vi söker en erfaren utvecklare till vårt team i Stockholm. Du kommer att arbeta tillsammans med produktteamet och med designers på projekt som används av miljontals människor varje månad. Den här rollen är för dig som gillar tekniska utmaningar och som vill ha en verklig påverkan på produkten. Vår kultur bygger på tillit och på att dela kunskap mellan alla i hela teamet, oavsett roll eller erfarenhet.',
};

// ---- detection --------------------------------------------------------------
test('lang: real posting prose lands on the right language', () => {
  for (const [expected, text] of Object.entries(SNIPPETS)) {
    assert.equal(detectLanguage(text), expected, `${expected} snippet`);
  }
});

test('lang: too little text is never enough, whatever it looks like', () => {
  assert.equal(detectLanguage('We are hiring a backend engineer for our team in Berlin.'), null, 'well under 30 words');
  assert.equal(detectLanguage('Wir suchen eine Entwicklerin für unser Team.'), null);
  assert.equal(detectLanguage(''), null);
  assert.equal(detectLanguage(null), null, 'no description at all is the common case');
  assert.equal(detectLanguage(undefined), null);
  // Long, but with nothing to count: a wall of technology names is not prose.
  assert.equal(detectLanguage('Python Django PostgreSQL Kubernetes Terraform AWS GCP Kafka Redis Docker Go Rust Java Scala Kotlin Swift Ruby Elixir Erlang Haskell React Angular Vue Svelte Next Nuxt Remix Astro Vite Webpack'), null);
});

test('lang: a posting published in two languages at once is reported as unknown', () => {
  // German boards routinely publish both versions in the same description
  // field. Picking whichever list edged ahead would be a coin toss, so it
  // returns null and the buyer can still read the text.
  const bilingual = `${SNIPPETS.de} ${SNIPPETS.en}`;
  assert.equal(detectLanguage(bilingual), null);
});

// ---- the filter -------------------------------------------------------------
test('languageFilter: comma is OR, and an undetected language cannot match', () => {
  const wanted = parseLanguageFilter('EN, de');
  assert.deepEqual([...wanted], ['en', 'de']);
  assert.equal(passes({ title: 'X', language: 'en' }, { languageIn: wanted }), true);
  assert.equal(passes({ title: 'X', language: 'de' }, { languageIn: wanted }), true);
  assert.equal(passes({ title: 'X', language: 'fr' }, { languageIn: wanted }), false);
  // Documented: only jobs whose language could be determined.
  assert.equal(passes({ title: 'X', language: null }, { languageIn: wanted }), false);
  assert.equal(passes({ title: 'X' }, { languageIn: wanted }), false);
  assert.equal(passes({ title: 'X', language: null }, { languageIn: null }), true, 'inactive filter keeps everything');
  assert.equal(parseLanguageFilter(''), null);
});

// ---- end to end -------------------------------------------------------------
test('pipeline: language is null until a description is fetched, then filters on it', async () => {
  // Mirrors the real API: Greenhouse only sends `content` when asked.
  const withText = ghBoard('acme', [
    { title: 'Backend Engineer', content: `<p>${SNIPPETS.en}</p>` },
    { title: 'Backend Engineer (m/w/d)', content: `<p>${SNIPPETS.de}</p>` },
  ]);
  const routes = [
    ['content=true', withText],
    [ghUrl('acme'), ghBoard('acme', [{ title: 'Backend Engineer' }, { title: 'Backend Engineer (m/w/d)' }])],
  ];

  // No description fetched: a title is never enough to name a language.
  const thin = collectSink();
  await runScrape({ companies: ['greenhouse:acme'], _nowMs: T0 }, thin, fakeFetch(routes));
  assert.deepEqual(thin.jobs.map((j) => j.language), [null, null]);

  // With the text, both are read — and the German one is not emitted.
  const english = collectSink();
  const warnings = [];
  english.log = { info() {}, warning: (m) => warnings.push(m) };
  await runScrape(
    { companies: ['greenhouse:acme'], includeDescription: true, languageFilter: 'en', _nowMs: T0 },
    english,
    fakeFetch(routes),
  );
  assert.deepEqual(english.jobs.map((j) => j.title), ['Backend Engineer']);
  assert.equal(english.jobs[0].language, 'en');
  assert.deepEqual(warnings, [], 'no warning needed: the description was fetched');
});

test('pipeline: languageFilter without a description warns instead of silently emptying the run', async () => {
  const sink = collectSink();
  const warnings = [];
  sink.log = { info() {}, warning: (m) => warnings.push(m) };
  const summary = await runScrape(
    { companies: ['greenhouse:acme'], languageFilter: 'en', _nowMs: T0 },
    sink,
    fakeFetch([[ghUrl('acme'), ghBoard('acme', [{ title: 'Backend Engineer' }])]]),
  );
  assert.equal(sink.jobs.length, 0);
  assert.equal(summary.totalFiltered, 1);
  assert.match(warnings.join('\n'), /languageFilter is set but no description is being fetched/);
});
