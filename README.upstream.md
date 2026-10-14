# ATS Job Scraper — Workday, Oracle, Greenhouse, Lever & 10 more in one API

Extract **job postings from 14 applicant tracking systems** — **Workday, Oracle HCM, Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Personio, Breezy, Rippling, Eightfold, Pinpoint and Teamtailor** — in a single run, and get back **one unified, deduplicated JSON schema** with salary data, technology tags, seniority and ghost-job signals.

No cookies. No proxies. No LinkedIn. Every source is a **public, sanctioned job-board endpoint**, so runs are fast, stable and cheap, and the data is public corporate information (no personal data).

## Why this scraper instead of fourteen separate ones

- **One schema for all fourteen ATSes.** `title`, `company`, `location`, `isRemote`, `employmentType`, `compensation`, `publishedAt`, `url`, `applyUrl` — identical field names whether the job lives on Workday or Ashby. Plus derived fields (`seniority`, `employmentTypeNorm`, `workplaceTypeNorm`) so you never post-process fourteen vocabularies.
- **Enterprise boards included.** Workday and Oracle HCM are where most large-company jobs actually live, and most scrapers skip both. Boards are walked to the end, not to the first two pages.
- **Monitor mode.** Schedule the actor and get **only the jobs that are new since the last run** — plus records for the ones that disappeared. Already-seen jobs are neither re-emitted nor re-billed.
- **Ghost-job signals.** Every job carries `daysOpen` and `isStale`; monitor mode adds `firstSeenAt` and `repostedCount` — the role that keeps being reposted every two weeks is flagged, not hidden.
- **Paste a careers URL and it just works.** `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`, `https://boards.greenhouse.io/stripe`, `https://acme.breezy.hr` — the right adapter is picked from the hostname.
- **Salary you can filter on — and compare.** Lever, Ashby, Recruitee, Breezy and Pinpoint pay ranges map to one `compensation` object, plus `compensationAnnualUsd` (approximate annual USD equivalent) so a €6,000/month posting and a $150k/year posting are finally comparable. `hasSalary` and `salaryMin` filter *before* you are charged. Only employer-published pay — never estimates.
- **Technology tags.** `technologies` extracts a curated dictionary of ~280 languages, frameworks, clouds and tools from each posting (`technologyFilter` to match). No LLM, no external calls — deterministic and free.
- **Full-text filters that don't lie.** `descriptionQuery` / `descriptionExclude` search the posting body with documented boolean semantics (comma = OR, space = AND) — and when you filter on descriptions without wanting them in the dataset, they are fetched for the filter and stripped from the output.
- **ATS auto-detection.** Don't know the ATS? Pass the bare slug (`stripe`) and the actor probes all twelve slug-addressable boards in parallel.

## What you pay for — and what you don't

Pay per job returned — a fraction of what typical job-data APIs charge per record. Five things are **never charged**:

- **Duplicates.** Deduplication runs *before* billing, not after.
- **Jobs your filters rejected.** Every filter — title, location, remote, date, salary, seniority, staleness — is applied before the meter.
- **Jobs you already received.** In monitor mode, previously delivered jobs are not re-emitted and not re-billed. Removal records are free.
- **Failed boards.** A board that errors returns no rows, so it costs nothing — and the run tells you which board failed and why.
- **Anything past your cap.** `maxTotalJobs` is a hard spending cap per run; `maxJobsPerCompany` stops pagination early rather than fetching and discarding.

No silent truncation: the `SUMMARY` record reports per board how many jobs were found, kept, filtered and deduplicated — and whether a cap was hit.

## Monitor mode: new and removed jobs, on a schedule

Set `monitorMode` and run the actor on a schedule (hourly, daily — your call):

- **`new-only`** — the dataset contains only jobs that appeared since the last run. First run seeds the state; every later run is pure signal.
- **`annotate`** — every job is emitted, enriched with `isNew`, `firstSeenAt` and `repostedCount`.
- **`emitRemoved: true`** — jobs that vanished from a board are emitted as `{ status: "removed", ... }` records (never billed). A removal is your close-date signal.
- **`repostedCount` and `repostedAt`** — how many times this exact role (company + title + location) has been taken down and reposted, and when it last came back. The classic ghost-job tell.
- Removal records carry both `removedAt` and `closedAt` (same value, both names) — a close-date feed you can build history on.

State is kept per `monitorId` in a named key-value store, so different schedules don't interfere. A failed board never marks its jobs as removed. **Keep the input stable between monitor runs**: changing filters or caps mid-stream makes jobs legitimately enter/leave your feed and shows up as new/removed churn.

## What you get

```json
{
  "id": "1f0e5b2a9c4d7e88",
  "source": "ashby",
  "company": "openai",
  "companyName": "OpenAI",
  "title": "Machine Learning Engineer",
  "department": "Research",
  "team": "Training",
  "location": "San Francisco",
  "locations": ["San Francisco", "New York"],
  "isRemote": false,
  "workplaceType": "Hybrid",
  "workplaceTypeNorm": "hybrid",
  "employmentType": "FullTime",
  "employmentTypeNorm": "fulltime",
  "seniority": null,
  "compensation": { "min": 200000, "max": 300000, "currency": "USD", "interval": "1 YEAR", "summary": "$200K – $300K" },
  "url": "https://jobs.ashbyhq.com/openai/...",
  "applyUrl": "https://jobs.ashbyhq.com/openai/.../application",
  "publishedAt": "2026-08-10T00:00:00.000Z",
  "updatedAt": null,
  "daysOpen": 17,
  "isStale": false,
  "countryCode": "US",
  "language": "en",
  "technologies": ["AWS", "PyTorch", "Python"],
  "compensationAnnualUsd": { "min": 200000, "max": 300000 }
}
```

Monitor mode adds `isNew`, `firstSeenAt`, `repostedCount`. Toggle `includeDescription` for the full posting text, `includeRaw` for the untouched ATS payload. Derived fields are honest: `seniority` is `null` when the title gives no signal — never guessed.

## Input in 10 seconds

```json
{
  "companies": [
    "greenhouse:stripe",
    "ashby:openai",
    "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
    "acme-corp"
  ],
  "query": "engineer",
  "excludeQuery": "internship, staffing",
  "descriptionQuery": "kubernetes, terraform",
  "technologyFilter": "Python, Go",
  "seniorityFilter": "senior, staff, principal",
  "countryFilter": "US, NL",
  "remoteOnly": true,
  "maxDaysOpen": 30,
  "salaryMin": 150000,
  "maxTotalJobs": 500
}
```

Three ways to name a board, mix them freely:

| Form | Example | When |
|---|---|---|
| `ats:slug` | `greenhouse:stripe` | You know the ATS |
| careers URL | `https://acme.breezy.hr` | You have the link |
| bare slug | `stripe` | You know neither — all twelve slug-based boards are probed |

**Filters** — all applied before billing: `query` / `excludeQuery` (comma = OR, space = AND), `descriptionQuery` / `descriptionExclude`, `technologyFilter`, `seniorityFilter`, `locationFilter`, `countryFilter`, `languageFilter`, `remoteOnly`, `postedAfter`, `maxDaysOpen`, `hasSalary`, `salaryMin` (annual USD), `maxJobsPerCompany`, `maxTotalJobs`.

## Supported ATS platforms

| ATS | Target form | Salary | Notes |
|---|---|---|---|
| **Workday** | careers URL | – | Enterprise. Tenant IDs aren't guessable, so paste the board URL |
| **Oracle HCM** | careers URL | – | Oracle Recruiting Cloud. Paste the `/sites/{SITE}/` URL |
| **Greenhouse** | slug / URL | – | |
| **Lever** | slug / URL | ✅ | |
| **Ashby** | slug / URL | ✅ | Richest compensation data |
| **Workable** | slug / URL | – | |
| **SmartRecruiters** | slug / URL | – | Paginated |
| **Recruitee** | slug / URL | ✅ | |
| **Personio** | slug / URL | – | XML feed, strong in Europe |
| **Breezy HR** | slug / URL | ✅ | Free-text ranges parsed |
| **Rippling** | slug / URL | – | List view carries no dates |
| **Eightfold** | slug / URL | – | Enterprise talent platform |
| **Pinpoint** | slug / URL | ✅ | No posting dates in the public feed |
| **Teamtailor** | slug / URL | – | RSS feed; 13,000+ companies, strong in Europe |

## Integrations

The dataset is plain JSON on the Apify platform, so everything downstream just works: **n8n**, **Make**, **Zapier** (Apify app → dataset items), a built-in **`webhookUrl`** that POSTs the run's new/removed jobs straight to your endpoint when the run finishes (a webhook failure never fails the run), CSV/Excel export, and the **Apify MCP server** — AI agents can call this actor as a tool and query hiring data mid-conversation. Stable field names are designed for LLM pipelines.

## Common uses

- **Job boards & aggregators** — fresh postings straight from the source, with stale roles filtered out and closed roles detected by monitor mode.
- **Recruiting & sourcing** — monitor competitors' hiring by team, title and seniority; a new posting is a buying signal.
- **Sales intelligence** — a company hiring "Head of Payments" is about to buy payments tooling. Schedule monitor mode and act on `isNew` the hour it appears.
- **Salary benchmarking** — collect published ranges at scale from the five ATSes that expose them, filtered by floor.
- **Labor-market research** — lifecycle data (`firstSeenAt`, removal records, `repostedCount`) instead of raw snapshots.

## When a company returns zero jobs

Every run writes a **`BOARD-STATUS`** record (JSON + CSV) to the key-value store: one row per company with found/kept/filtered/deduplicated counts, the error if the board failed, and a **hint** — a wrong slug tells you the URL forms to check, a fully-filtered board tells you which filter ate the jobs. No guessing, no "why is my dataset empty" mystery: the answer is in the run.

## Coverage & freshness

Data comes from each company's live job board at run time — if it's on the board, you get it, and closed roles are gone the moment the company closes them. All fourteen adapters are verified against live boards.

Honest caveats:

- Workday's list view dates jobs as "Posted 3 Days Ago", so `publishedAt` is approximated unless you enable `includeDescription`, which fetches the exact date per job.
- Rippling and Pinpoint publish no posting dates on their public feeds, so `daysOpen` is `null` there (monitor mode's `firstSeenAt` still tracks them).
- `isStale` is a **heuristic**, not a verdict: it means "open at least 60 days" (configurable via `staleAfterDays`). Some long-open roles are genuinely open.
- `seniority` is inferred from the title only, and is `null` when there is no explicit signal.
- `countryCode` and `language` are best-effort and honest: `null` when the location or text is ambiguous ("London" alone names no country), never guessed. Language detection needs the description text.
- `compensationAnnualUsd` uses approximate exchange rates updated at release time — comparison-grade, not payroll-grade.

## FAQ

**How do I find a company's board slug?** It's in the careers-page URL: `boards.greenhouse.io/{slug}`, `jobs.lever.co/{slug}`, `jobs.ashbyhq.com/{slug}`, `apply.workable.com/{slug}`, `careers.smartrecruiters.com/{Company}`, `{slug}.recruitee.com`, `{slug}.jobs.personio.de`, `{slug}.breezy.hr`, `{slug}.eightfold.ai`, `{slug}.pinpointhq.com`, `{slug}.teamtailor.com`. Or just paste the whole URL — or the bare company name and let auto-detection try all twelve.

**How do I scrape a Workday or Oracle board?** Paste the careers URL, e.g. `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite` or `https://tenant.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions`. Their tenant IDs can't be derived from a company name, which is why a slug alone won't do.

**How do I get only new jobs every day?** Set `monitorMode: "new-only"`, schedule the actor daily, and every run's dataset contains exactly the postings that appeared since the previous run. Add `emitRemoved: true` to also get close signals.

**How do I filter out ghost jobs?** Set `maxDaysOpen` (e.g. `30`), and in monitor mode watch `repostedCount` — a role that keeps being reposted is the classic ghost pattern. Every job also carries `daysOpen` and `isStale` so you can decide for yourself.

**Why do I get fewer jobs than the careers site shows?** The `SUMMARY` and `BOARD-STATUS` records account for every job: found vs kept vs filtered vs deduplicated, per board. If a number surprises you, the breakdown is already in your run — most often it's your own filters or the dedup doing exactly what they promise.

**Does this scrape LinkedIn or Indeed?** No — deliberately. Those platforms block and litigate, and scraping them risks your account. This actor uses only the ATS boards companies publish on purpose. That's why it needs no proxies and doesn't break.

**What happens when an ATS changes its API?** Each adapter is isolated and contract-tested against fixtures captured from live boards; fixes ship without touching the rest. Open an issue on the actor page and it gets picked up.
