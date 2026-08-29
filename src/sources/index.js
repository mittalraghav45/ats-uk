import * as greenhouse from './greenhouse.js';
import * as lever from './lever.js';
import * as ashby from './ashby.js';
import * as workable from './workable.js';
import * as smartrecruiters from './smartrecruiters.js';
import * as recruitee from './recruitee.js';
import * as workday from './workday.js';
import * as personio from './personio.js';
import * as breezy from './breezy.js';
import * as rippling from './rippling.js';
import * as oracle from './oracle.js';
import * as eightfold from './eightfold.js';
import * as pinpoint from './pinpoint.js';
import * as teamtailor from './teamtailor.js';

export const SOURCES = {
  greenhouse, lever, ashby, workable, smartrecruiters, recruitee,
  workday, personio, breezy, rippling, oracle, eightfold, pinpoint, teamtailor,
};
export const SOURCE_NAMES = Object.keys(SOURCES);

/** Sources a bare company slug can be probed against (Workday needs a URL). */
export const AUTODETECTABLE = SOURCE_NAMES.filter((n) => !SOURCES[n].urlOnly);

/** Careers URL -> {ats, slug, company}; null when no adapter claims the host. */
export function matchUrl(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  for (const ats of SOURCE_NAMES) {
    const hit = SOURCES[ats].matchUrl?.(u);
    if (hit) return { ats, ...hit };
  }
  return null;
}
