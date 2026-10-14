# ATS UK Job Scraper

Independent UK software-vacancy discovery project. No dependency on JobMatch Portal or the other UK scraper. See [UPSTREAM.md](UPSTREAM.md) and [original documentation](README.upstream.md).

## Run locally

```sh
python uk/run.py  # Python 3.10+ and Node.js 20+; no npm install required
```

Run commands from this repository root. Set `--out PATH` for a separate result directory. Local execution has no paid API, Apify, proxy or hosting dependency. Do not run upstream `npm start` for the ATS project: the UK runner is deliberately separate.

## Coverage

Uses upstream runScrape and its 14 public ATS adapters directly. It does not import the Apify entry point or invoke paid actors. Initial boards: University of Edinburgh, Leicestershire County Council, Stripe, OpenAI, Monzo and Deliveroo. Edit companies in uk/config.json to add supported university, NHS or council career URLs. NHS Jobs/Trac, jobs.ac.uk and many council systems are not supported by these adapters; only the configured compatible university/council boards have direct coverage; NHS and DWP remain unsupported directly. Workday and Oracle require exact career URLs; do not guess slugs.

## Outputs

`results/jobs.json` and `results/jobs.csv` contain ONLY explicit/conditional sponsorship matches, with universities, councils, DWP and NHS prioritised. `review.json` contains unknown/refused/conflicting matches, which are not presented as sponsored opportunities. Fields: title, employer, location, salary, posting_date, application_url, matching_score, sponsorship_status, matched_skills, evidence_url and verbatim sponsorship_evidence. Missing salary/dates stay null; they are not fabricated. `summary.json` contains counts/errors; `rejected.json` explains exclusions. `raw.json` preserves input for review. ATS also writes `boards.json`. Logs: `run.log`.

## Matching and safeguards

UK location required. Prioritises JavaScript, TypeScript, React, Node.js, PHP, C#, ASP.NET, Blazor, Docker, basic Python and AI. Excludes senior/staff/principal/lead/management, level III+, internships/apprenticeships, mobile titles and explicit security clearance references. Experience exclusions are conservative heuristics, not complete natural-language understanding. UK city matching has an explicit non-UK country guard but ambiguous city names need review. Remote anywhere/EMEA is not sufficient evidence of UK eligibility.

Score = 35 + 7 per JavaScript/TypeScript/React/Node.js/PHP match + 4 per C#/ASP.NET/Blazor/Docker match + 2 per Python/AI match + 10 for junior/associate/graduate title + 10 for explicit sponsorship (5 for conditional), capped at 100. It is a ranking heuristic, not a percentage chance of getting hired. Other software stacks can remain at lower scores.

Sponsorship: `available`, `conditional`, `not_available`, `unknown`, or `conflicting`, derived only from the individual vacancy description returned by the board/ATS. An employer sponsor-register entry never establishes availability. Education/event sponsorship and export licences are ignored. Transfer-only support is conditional. Every result requires human review; a missing description cannot establish sponsorship or clearance suitability. These are vacancy extracts, not immigration eligibility decisions or direct employer confirmations.

Deduplication uses normalised application URLs (tracking removed) plus employer/title/city. Different postings with the same employer/title/city can be conservatively collapsed. Deduplication is per run, not cross-run change tracking. JSON writes are atomic. Failures are logged; one source failure does not invalidate others. Empty results are not proof there are no vacancies. ATS source calls have bounded retry/backoff/timeouts; JobSpy searches have a 100-second process limit. No proxy bypass.

## Tests

```sh
python -m unittest discover -s uk -p 'test_*.py'
```

ATS upstream tests additionally: `node --test tests/*.test.js` (no Apify install needed).

## GitHub execution

`.github/workflows/uk-search.yml` is manual-only, with a 15-minute timeout and read-only repository permissions. Its hosted job is disabled on private repositories to avoid consuming billable private-repository execution. No schedule is enabled. Results are downloadable workflow artifacts retained for 7 days. Local execution remains available for either visibility. Do not enable paid runners or services without approval.

## Initial delivery status

Local builds and live samples are included. This repository is an independent upstream fork with UK additions. GitHub Actions supports manual runs; see VALIDATION.md for measured coverage and limitations.

Committed sample outputs are in `sample-results/`; each live run writes fresh outputs to ignored `results/`.

User skill levels: .NET/Blazor and Docker are portfolio/project skills; Python is basic knowledge and AI is currently being learned. Skill matches do not claim professional experience.

DWP and other public-sector employers are not assumed to sponsor. Clearance exclusions still apply. Sector classification is a best-effort employer-name heuristic; direct vacancy evidence remains decisive. A valid empty sponsorship shortlist is expected when no vacancy explicitly supports sponsorship.
