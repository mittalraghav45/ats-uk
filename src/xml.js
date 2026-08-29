/**
 * Purpose-built reader for Personio's flat job feed — not a general XML
 * parser. The feed is machine-generated, one level deep per position, so
 * scanning for tag pairs is enough and keeps the actor dependency-free
 * (no browser, no parser library, which is what keeps runs cheap).
 */
import { decodeEntities } from './normalize.js';

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/** Inner XML of every <tag>…</tag> occurrence, in document order. */
export function blocks(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Text of the first direct <tag>, CDATA unwrapped and entities decoded. */
export function field(xml, tag) {
  const [inner] = blocks(xml, tag);
  if (inner === undefined) return null;
  const cdata = inner.match(CDATA);
  const text = cdata ? cdata[1] : decodeEntities(inner);
  const trimmed = text.trim();
  return trimmed || null;
}

/** Text of every <tag> occurrence (e.g. additionalOffices/office). */
export function fields(xml, tag) {
  return blocks(xml, tag)
    .map((inner) => {
      const cdata = inner.match(CDATA);
      return (cdata ? cdata[1] : decodeEntities(inner)).trim();
    })
    .filter(Boolean);
}
