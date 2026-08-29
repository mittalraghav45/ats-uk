/**
 * Minimal HTTP client: timeout, bounded retries with exponential
 * backoff + jitter, and typed "not found" so auto-detection can probe
 * boards without treating a 404 as a failure.
 * Supports POST (Workday's search endpoint) and text bodies (Personio's XML
 * feed); every request is a read, so retrying a POST is safe.
 */
export class HttpError extends Error {
  constructor(message, { status = 0, url = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
  get notFound() { return this.status === 404; }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchJson(url, {
  timeoutMs = 20_000,
  retries = 2,
  headers = {},
  method = 'GET',
  body = null,
  parse = 'json',
  fetchImpl = globalThis.fetch,
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          accept: parse === 'text' ? 'application/xml, text/xml, */*' : 'application/json',
          'user-agent': 'ats-job-scraper/1.1 (+https://apify.com)',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      });
      if (res.ok) {
        return parse === 'text' ? await res.text() : await res.json();
      }
      const err = new HttpError(`HTTP ${res.status} for ${url}`, { status: res.status, url });
      if (!RETRYABLE.has(res.status)) throw err;
      lastErr = err;
    } catch (e) {
      if (e instanceof HttpError && !RETRYABLE.has(e.status)) throw e;
      lastErr = e instanceof HttpError ? e : new HttpError(`${e.name === 'AbortError' ? 'Timeout' : e.message} for ${url}`, { url });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) {
      const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/** Convenience wrapper for the one source that publishes XML instead of JSON. */
export function fetchText(url, opts = {}) {
  return fetchJson(url, { ...opts, parse: 'text' });
}
