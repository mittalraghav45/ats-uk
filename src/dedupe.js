/** Cross-source and in-source dedup on company + title + location. */
const norm = (s) => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

export function dedupeKey(job) {
  return `${norm(job.company)}|${norm(job.title)}|${norm(job.location)}`;
}

export function makeDeduper() {
  const seen = new Set();
  let dropped = 0;
  return {
    keep(job) {
      const key = dedupeKey(job);
      if (seen.has(key)) { dropped++; return false; }
      seen.add(key);
      return true;
    },
    get dropped() { return dropped; },
  };
}
