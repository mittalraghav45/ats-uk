import { Actor, log } from 'apify';
import { runScrape } from './scrape.js';
import { boardStatusCsv } from './hints.js';
import { buildWebhookPayload, isDeliverableWebhookUrl, WEBHOOK_JOB_LIMIT } from './webhook.js';
import { fetchJson } from './http.js';

const CHARGE_EVENT = 'job-result';
const PUSH_CHUNK = 200;
const MONITOR_STORE = 'ats-monitor';
const WEBHOOK_TIMEOUT_MS = 15_000;

/** Apify record keys allow a restricted charset, so a free-text id is sanitised. */
function stateKey(monitorId) {
  const raw = String(monitorId ?? '').trim() || 'default';
  return raw.replace(/[^a-zA-Z0-9!\-_.'()]/g, '-').slice(0, 200) || 'default';
}

await Actor.init();

try {
  const input = (await Actor.getInput()) ?? {};
  let chargeWarned = false;

  // A bounded copy of what the run delivered, kept only for the webhook body.
  // Two arrays of at most 200 records each: small enough to hold for any board
  // size, which is why the cap is applied while collecting and not at the end.
  const webhookWanted = isDeliverableWebhookUrl(input.webhookUrl);
  const deliveredJobs = [];
  const deliveredRemoved = [];

  const sink = {
    log,
    async pushJobs(jobs) {
      if (webhookWanted) {
        for (const j of jobs) {
          const bucket = j?.status === 'removed' ? deliveredRemoved : deliveredJobs;
          if (bucket.length < WEBHOOK_JOB_LIMIT) bucket.push(j);
        }
      }
      for (let i = 0; i < jobs.length; i += PUSH_CHUNK) {
        const chunk = jobs.slice(i, i + PUSH_CHUNK);
        await Actor.pushData(chunk);
        // Removal notices are bookkeeping, not results: the buyer already paid
        // for that posting the day it appeared, so they are saved but not billed.
        const billable = chunk.filter((j) => j.status !== 'removed').length;
        if (!billable) continue;
        try {
          await Actor.charge({ eventName: CHARGE_EVENT, count: billable });
        } catch (e) {
          if (!chargeWarned) {
            chargeWarned = true;
            log.warning(`Charging skipped (${e.message}) — run is not pay-per-event; results are still saved.`);
          }
        }
      }
    },
  };

  // Monitor state lives in a named key-value store so it survives across runs
  // (the default store is wiped with each run). One record per monitorId lets
  // several schedules share the actor without diffing each other's boards.
  if (input.monitorMode && input.monitorMode !== 'off') {
    const store = await Actor.openKeyValueStore(MONITOR_STORE);
    const key = stateKey(input.monitorId);
    sink.loadState = async () => (await store.getValue(key)) ?? null;
    sink.saveState = async (state) => { await store.setValue(key, state); };
    log.info(`Monitor mode "${input.monitorMode}" — state record "${key}" in key-value store "${MONITOR_STORE}".`);
  }

  const summary = await runScrape(input, sink);
  await Actor.setValue('SUMMARY', summary);

  // BOARD-STATUS answers "why did this board give me nothing?" per input line,
  // in JSON for machines and in CSV for the spreadsheet the buyer is already
  // keeping. Written before any of the reporting below, so it exists even if
  // the run ends in the "everything failed" throw.
  await Actor.setValue('BOARD-STATUS', summary.boards);
  await Actor.setValue('BOARD-STATUS.csv', boardStatusCsv(summary.boards), { contentType: 'text/csv' });

  const okBoards = summary.boards.filter((b) => b.ok).length;
  const monitorMsg = summary.monitorMode
    ? ` | monitor: ${summary.newJobs} new, ${summary.unchangedJobs} already seen, ${summary.removedJobs} gone from the board`
    : '';
  // A run that stopped early because of the spend cap must say so in the one
  // place the user actually looks — otherwise a short result set reads as a
  // broken scraper.
  const capMsg = summary.cappedAtMaxTotalJobs
    ? ` | capped at ${summary.maxTotalJobs} by maxTotalJobs (${summary.capped} more job(s) matched but were not returned)`
    : '';
  const msg = `${summary.totalJobs} jobs from ${okBoards} board(s) — ${summary.totalDuplicates} duplicates removed, ${summary.totalFiltered} filtered out, ${summary.failures} board(s) failed${monitorMsg}${capMsg}`;
  await Actor.setStatusMessage(msg);
  log.info(`Done. ${msg}`);

  await deliverWebhook(input, summary, deliveredJobs, deliveredRemoved);

  if (summary.totalJobs === 0 && summary.failures > 0) {
    throw new Error(`No jobs extracted and ${summary.failures} board(s) failed — check the "companies" input. Details in the SUMMARY key-value record.`);
  }
} finally {
  await Actor.exit();
}

/**
 * POST the run's result to the customer's endpoint, and never let that decide
 * whether the run succeeded: the dataset is already saved and paid for, so a
 * dead endpoint is a warning, not a failure. One retry, 15s, https only.
 */
async function deliverWebhook(input, summary, jobs, removed) {
  const url = typeof input.webhookUrl === 'string' ? input.webhookUrl.trim() : '';
  if (!url) return;
  if (!isDeliverableWebhookUrl(url)) {
    log.warning(`webhookUrl "${url}" is not an https URL — nothing was sent. A webhook body carries the whole result set, so plain http is refused.`);
    return;
  }
  const payload = buildWebhookPayload({
    summary,
    jobs,
    removed,
    datasetId: process.env.APIFY_DEFAULT_DATASET_ID ?? null,
    runId: process.env.APIFY_ACTOR_RUN_ID ?? null,
  });
  try {
    // parse: 'text' because a webhook receiver answers with whatever it likes
    // — an empty body, "ok", HTML — and none of that is our business.
    await fetchJson(url, { method: 'POST', body: payload, timeoutMs: WEBHOOK_TIMEOUT_MS, retries: 1, parse: 'text' });
    log.info(`Webhook delivered to ${url} — ${payload.newJobs.length} job(s), ${payload.removed.length} removal(s).`);
  } catch (e) {
    log.warning(`Webhook POST to ${url} failed (${e.message}) — the run is unaffected and the results are saved.`);
  }
}
