// OP.GG community Replica Teams. Listing pages server-render a `teamCodes` array with full slots
// (pokemon/item/ability/moves as slugs) plus key->name lists. Builds with teamId === null are
// sample builds without an in-game code and are excluded.
import { fetchText, nextFlight, jsonAfter, strictCode, makeMember, tierFor, regulationForDate, sleep, isoDate } from '../lib/common.mjs';

const BASE = 'https://op.gg/pokemon-champions/replica-teams';
const NAME_RE = /"key":"([a-z0-9-]+)"((?:,"[A-Za-z_]+":(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null))*?),"name":"((?:[^"\\]|\\.)*)"/g;

function harvestNames(flight, names) {
  let m;
  NAME_RE.lastIndex = 0;
  while ((m = NAME_RE.exec(flight))) { try { if (!names.has(m[1])) names.set(m[1], JSON.parse(`"${m[3]}"`)); } catch { /* ignore */ } }
}
const SMALL = new Set(['of', 'the', 'and']);
const titleSlug = slug => String(slug || '').split('-').map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
  .replace(/^U Turn$/, 'U-turn').replace(/^Will O Wisp$/, 'Will-O-Wisp').replace(/^Freeze Dry$/, 'Freeze-Dry').replace(/^Double Edge$/, 'Double-Edge').replace(/^X Scissor$/, 'X-Scissor').replace(/^V Create$/, 'V-create').replace(/^Soft Boiled$/, 'Soft-Boiled');

export async function collectOpgg({ full = false, sinceIso = null, maxPages = 120, minPages = 2, delayMs = 1500, log = () => {} } = {}) {
  const names = new Map();
  const raw = [];
  let pages = 0, sampleBuilds = 0, invalidCodes = 0, unmapped = new Set();
  const cutoff = full ? null : (sinceIso ? Date.parse(sinceIso) : Date.now() - 7 * 86400000);
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(page === 1 ? BASE : `${BASE}?page=${page}`);
    pages++;
    const flight = nextFlight(html);
    const arr = jsonAfter(flight, '"teamCodes":');
    if (!Array.isArray(arr)) { if (page === 1) throw new Error('OP.GG listing no longer exposes teamCodes (layout changed)'); break; }
    if (!arr.length) break;
    harvestNames(flight, names);
    raw.push(...arr);
    const oldest = Math.min(...arr.map(t => Date.parse(t.createdAt)).filter(Number.isFinite));
    if (cutoff && page >= minPages && oldest < cutoff) break;
    await sleep(delayMs);
  }
  const nameOf = (slug, kind) => {
    if (!slug) return null;
    if (names.has(slug)) return names.get(slug);
    unmapped.add(`${kind}:${slug}`);
    return titleSlug(slug);
  };
  const teams = [];
  for (const t of raw) {
    if (!t.teamId) { sampleBuilds++; continue; }
    const code = strictCode(t.teamId);
    if (!code) { invalidCodes++; continue; }
    const slots = Array.isArray(t.slots) ? t.slots : [];
    if (slots.length !== 6) continue;
    const members = slots.map(s => makeMember({ species: nameOf(s.pokemon, 'pokemon'), item: nameOf(s.item, 'item'), ability: nameOf(s.ability, 'ability'), moves: (s.moves || []).map(mv => nameOf(mv, 'move')) }));
    const created = t.createdAt ? isoDate(t.createdAt) : null;
    const reg = regulationForDate(t.createdAt);
    teams.push({
      code, title: (t.title || '').trim() || 'Untitled team', creator: (t.author && t.author.nickname) || null,
      format: t.battleFormat === 'DOUBLE' ? 'doubles' : t.battleFormat === 'SINGLE' ? 'singles' : null,
      regulation: reg, regulationBasis: reg ? 'inferred-from-submission-date' : 'unknown',
      members, event: null, source: { name: 'OP.GG', url: `${BASE}/${code}` }, sourceDate: created, dataTier: tierFor(members),
    });
  }
  log(`OP.GG: ${pages} pages, ${raw.length} builds, ${teams.length} with codes, ${sampleBuilds} sample builds skipped`);
  return { teams, stats: { pages, builds: raw.length, withCodes: teams.length, sampleBuildsSkipped: sampleBuilds, invalidCodes, unmappedNames: [...unmapped].slice(0, 30) } };
}
