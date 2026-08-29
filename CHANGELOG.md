# Changelog

## 1.4.2 — 2026-08-27
- **Output schema** (`.actor/output_schema.json`): required by Apify to publish to the Store — declares where results live so Console and API consumers (including AI agents chaining Actors) can find them without guessing. Points at the existing `jobs` dataset view.

## 1.4.0 — 2026-08-27
- **Salary comparable across currencies**: `compensationAnnualUsd` (approximate annual USD from published currency/interval); `salaryMin` now compares on that scale — fixes monthly-EUR postings being wrongly dropped by annual floors.
- **Technology tags**: `technologies[]` from a curated ~280-term dictionary (no LLM, no external calls) + `technologyFilter`.
- **Full-text description filters**: `descriptionQuery` / `descriptionExclude` with documented boolean semantics; descriptions fetched for filtering are stripped from output unless `includeDescription`.
- **`excludeQuery`** on titles.
- **Geo & language**: best-effort `countryCode` (ISO-2, never guessed) + `countryFilter`; stopword-based `language` + `languageFilter`.
- **Lifecycle**: `repostedAt` on reposts, `closedAt` on removal records.
- **`BOARD-STATUS`** (JSON + CSV in the key-value store): per-company counts, errors and actionable hints — answers "why zero results" inside the run.
- **`webhookUrl`**: POST of summary + new/removed jobs at run end; webhook failure never fails the run.
- 109 unit/pipeline tests (was 65).

## 1.3.0 — 2026-08-27
- **Monitor mode** (`monitorMode: off|annotate|new-only`, `monitorId`, `emitRemoved`): scheduled runs emit only jobs new since the last run, plus free `status: "removed"` records for postings that vanished. Already-seen jobs are never re-billed. Failed boards never produce removals.
- **Repost detection**: `repostedCount` counts how many times the same role (company+title+location) was taken down and reposted — the classic ghost-job tell. `firstSeenAt` is sticky across runs.
- **Derived fields**: `seniority` (from title, null when no signal), `employmentTypeNorm`, `workplaceTypeNorm` — one vocabulary across all fourteen ATSes. New `seniorityFilter` input.
- **`maxTotalJobs`**: hard spending cap per run, reported in `SUMMARY` (`cappedAtMaxTotalJobs`, `capped`) — never a silent truncation.
- Two new sources, live-verified: **Pinpoint** (`postings.json`, fifth salary-bearing source) and **Teamtailor** (public RSS feed). Fourteen ATSes total, twelve slug-addressable.
- 65 unit/pipeline tests (was 33).

## 1.2.0 — 2026-08-27
- Two enterprise sources, live-verified: **Oracle HCM** (Oracle Recruiting Cloud, URL-addressed, paginated) and **Eightfold** (slug- or URL-addressed). Twelve ATSes total.
- **Ghost-job signals**: every job carries `daysOpen` and `isStale`, derived from the ATS posting date. New `maxDaysOpen` filter drops long-open roles before billing; `staleAfterDays` tunes the label.
- **Salary filters**: `hasSalary` and `salaryMin`, applied before billing.
- Fixed: Eightfold caps its page size below the requested `num`, which skipped whole blocks of jobs. Both paginated sources now advance by the batch actually returned, never by an assumed page size.
- 33 unit/pipeline tests (was 29).

## 1.1.0 — 2026-08-27
- Four new ATS sources, all live-verified: **Workday** (POST search API, paginated, URL-addressed), **Personio** (XML feed), **Breezy HR** (free-text salary parsed into `compensation`), **Rippling**. Ten ATSes total.
- **Careers-page URLs accepted as input** for every source; the adapter is picked from the hostname. Unrecognised URLs fail that board with a clear message instead of being probed as a slug.
- `maxJobsPerCompany` now stops pagination early instead of fetching pages that get discarded.
- Fixed: Workday reports `total` only on its first page, which truncated every board to 40 jobs. Paging is now driven by batch size.
- `includeRaw` no longer leaks adapter-internal keys.
- Pagination moved into the adapters behind a shared `fetchAll` contract; `http.js` gained POST and text/XML support.
- 29 unit/pipeline tests (was 18).

## 1.0.0 — 2026-08-27
- Initial release: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee — all six live-verified.
- Unified schema, cross-source dedupe, ATS auto-detection, SmartRecruiters pagination.
- Recruitee salary ranges mapped to `compensation`; hybrid/onsite/remote workplace type; `updatedAt`.
- Pay-per-event charging (`job-result`), per-board SUMMARY, 18 unit/pipeline tests.
