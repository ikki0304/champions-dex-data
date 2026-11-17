// Shared helpers for the Champions Dex team-code collector.
// Self-contained copy of the code/species rules used by the app (team-codes-lib.js in ikki0304/champions-dex).

export const USER_AGENT = 'ChampionsDexCollector/1.0 (+https://github.com/ikki0304/champions-dex-data; public Replica Team code index, runs every 6h)';

// ---- Regulation calendar (official Pokémon Champions dates, UTC). Add the next set here when it is announced.
export const REGULATIONS = Object.freeze([
  { id: 'M-A', start: '2026-04-08T02:00:00Z', endExclusive: '2026-06-17T02:00:00Z' },
  { id: 'M-B', start: '2026-06-17T02:00:00Z', endExclusive: '2026-09-09T02:00:00Z' },
  { id: 'M-C', start: '2026-09-09T02:00:00Z', endExclusive: '2026-12-02T02:00:00Z' }, // ends 2 Dec 2026 01:59 UTC
]);

/** Regulation window containing `date` (Date | ISO string | YYYY-MM-DD), or null when outside every known window. */
export function regulationForDate(date) {
  if (!date) return null;
  const t = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : new Date(date).getTime();
  if (!Number.isFinite(t)) return null;
  const hit = REGULATIONS.find(r => t >= Date.parse(r.start) && t < Date.parse(r.endExclusive));
  return hit ? hit.id : null;
}

/** Current regulation for the run. Unknown future window => keep last known value and warn (never guess). */
export function currentRegulation(now, lastKnown, warnings) {
  const id = regulationForDate(now);
  if (id) return id;
  warnings.push(`No known regulation window covers ${new Date(now).toISOString()}; keeping last known "${lastKnown}". Add the new set to REGULATIONS in scripts/lib/common.mjs.`);
  return lastKnown || null;
}

// ---- Codes
export const normalizeTeamCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isValidTeamCode = value => /^[A-Z0-9]{10}$/.test(normalizeTeamCode(value));
/** Strict: the raw value must itself be 10 alphanumerics once spaces/line breaks are removed (no other junk). */
export function strictCode(raw) {
  const compact = String(raw || '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{10}$/.test(compact) ? compact : null;
}

// ---- Species / item keys (mirrors team-codes-lib.js)
export const slugify = value => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function speciesKey(value) {
  let name = String(value || '').trim();
  name = name.replace(/^mega\s+/i, '').replace(/\s+(x|y|z)$/i, '');
  let key = slugify(name);
  if (key.startsWith('rotom-')) key = `${key.slice('rotom-'.length)}-rotom`;
  if (key.endsWith('-hisui')) key = `hisuian-${key.slice(0, -'-hisui'.length)}`;
  if (key.endsWith('-alola')) key = `alolan-${key.slice(0, -'-alola'.length)}`;
  if (key.endsWith('-galar')) key = `galarian-${key.slice(0, -'-galar'.length)}`;
  key = key.replace(/^(indeedee|basculegion|meowstic)-(f|m|female|male)$/, '$1');
  key = key.replace(/-(eternal|masterpiece|teatime)$/, '');
  key = key.replace(/-(f|m|female|male)$/, '');
  return key;
}
export const speciesSetKey = members => (members || []).map(m => speciesKey(m && m.species)).sort().join('|');

const REGIONAL = { hisui: 'Hisuian', alola: 'Alolan', galar: 'Galarian', paldea: 'Paldean' };
/** Normalise a display species name into the app's conventions ("Mega Charizard Y", "Hisuian Arcanine", "Indeedee-F"). */
export function normalizeSpecies(raw) {
  let name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  // Showdown "Nickname (Species) (M)" forms, and site qualifiers like "Arcanine (Hisuian)" / "Rotom (Wash)" / "Indeedee (Female)"
  name = name.replace(/[\u2018\u2019]/g, "'");
  name = name.replace(/\s*\((M|F)\)\s*$/, '');
  const paren = name.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (paren) {
    const base = paren[1].trim();
    const q = paren[2].trim();
    const plainBase = base.replace(/^Paldean\s+/i, '');
    const reg = q.match(/^(Hisui|Alola|Galar|Paldea)(?:n|an)?$/i);
    const gender = q.match(/^(Female|Male)$/i);
    if (reg) name = `${base}-${reg[1]}`;
    else if (gender) name = /^(Indeedee|Basculegion|Meowstic)$/i.test(base) ? `${base}-${gender[1][0].toUpperCase()}` : base;
    else if (/^(Heat|Wash|Frost|Fan|Mow)$/i.test(q) && /^Rotom$/i.test(base)) name = `Rotom-${q}`;
    else if (/^Combat Breed$/i.test(q)) name = `Paldean ${plainBase}`;
    else if (/^(Blaze|Aqua) Breed$/i.test(q)) name = `(${q.split(' ')[0]}) Paldean ${plainBase}`;
    else if (/^(\w+) Plumage$/i.test(q)) name = `${q} ${base}`;
    else if (/^Eternal( Flower)?$/i.test(q)) name = `${base}-Eternal`;
    else if (/^Toxtricity$/i.test(base) && /^(Amped|Low[\s-]?Key)( Form)?$/i.test(q)) name = /^amped/i.test(q) ? 'Amped Toxtricity' : 'Low Key Toxtricity';
    else if (/\b(Family|Forme?|Breed|Style|Mode|Size|Cloak|Pattern|Flower|Swirl|Cream)\b/i.test(q) || /\s/.test(q)
      || /^(Shield|Blade|Hero|Zero|Dusk|Midnight|Midday|Average|Small|Large|Super|Amped|Low Key)$/i.test(q)) name = base;
    else name = q; // Showdown nickname: "(Species)" holds the real species
  }
  if (/^Lycanroc\b/i.test(name)) name = 'Lycanroc';
  if (/^Alcremie\b/i.test(name)) name = 'Alcremie';
  if (/^Maushold\b/i.test(name)) name = 'Maushold';
  // Victory Road sprite titles: "Charizard Mega Y", "Staraptor Mega", "Arcanine Hisui", "Indeedee F", "Kommo O"
  let m = name.match(/^(.+?)\s+Mega(?:\s+([XYZ]))?$/i);
  if (m) name = `Mega ${m[1]}${m[2] ? ` ${m[2].toUpperCase()}` : ''}`;
  m = name.match(/^(Mega\s+)?(.+?)[\s-](Hisui|Alola|Galar|Paldea)$/i);
  if (m) name = `${m[1] || ''}${REGIONAL[m[3].toLowerCase()]} ${m[2]}`;
  m = name.match(/^(Indeedee|Basculegion|Meowstic)[\s-](F|M)$/i);
  if (m) name = `${m[1]}-${m[2].toUpperCase()}`;
  if (/^kommo[\s-]o$/i.test(name)) name = 'Kommo-o';
  m = name.match(/^Toxtricity[\s-](Amped|Low[\s-]?Key)$/i);
  if (m) name = /^amped$/i.test(m[1]) ? 'Amped Toxtricity' : 'Low Key Toxtricity';
  m = name.match(/^Rotom[\s-](Heat|Wash|Frost|Fan|Mow)$/i);
  if (m) name = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} Rotom`;
  return name;
}

const cleanText = v => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s && !/^(none|null|undefined|-|—)$/i.test(s) ? s : null;
};
export function makeMember({ species, item = null, ability = null, moves = null }) {
  const mv = Array.isArray(moves) ? moves.map(cleanText).filter(Boolean) : [];
  return { species: normalizeSpecies(species), item: cleanText(item), ability: cleanText(ability), moves: mv.length ? mv : null };
}
export const tierFor = members => (Array.isArray(members) && members.length === 6 && members.every(m => m.item) ? 'A' : 'B');

// ---- HTML helpers
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}
export const stripTags = s => decodeEntities(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

/** Concatenate Next.js RSC flight chunks (self.__next_f.push([1,"..."])) into one decoded string. */
export function nextFlight(html) {
  let out = '';
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { out += JSON.parse(`"${m[1]}"`); } catch { /* skip malformed chunk */ } }
  return out;
}
/** Parse the JSON value that starts right after `marker` in `text` (balanced brackets, string-aware). */
export function jsonAfter(text, marker, from = 0) {
  const at = text.indexOf(marker, from);
  if (at < 0) return null;
  let i = at + marker.length;
  while (/\s/.test(text[i])) i++;
  const open = text[i];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) return null;
  let depth = 0, inStr = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(i, j + 1)); } catch { return null; } } }
  }
  return null;
}

// ---- Polite HTTP
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function fetchText(url, { timeoutMs = 25000, retries = 2, accept = 'text/html,application/json;q=0.9,*/*;q=0.8' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en' }, signal: ctl.signal, redirect: 'follow' });
      if (res.status === 404) { const e = new Error(`HTTP 404 ${url}`); e.status = 404; throw e; }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (err.status === 404) break;
      await sleep(1500 * (attempt + 1));
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}
export async function fetchJson(url, opts) { return JSON.parse(await fetchText(url, { ...opts, accept: 'application/json' })); }

export const isoDate = d => new Date(d).toISOString().slice(0, 10);
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const monthIndex = name => MONTHS.findIndex(m => m.startsWith(String(name || '').toLowerCase().slice(0, 3)));
/** "November 1st" (no year) -> YYYY-MM-DD, choosing the latest year that is not in the future. */
export function dateFromMonthDay(text, now = new Date()) {
  const m = String(text || '').match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (!m) return null;
  const mi = monthIndex(m[1]);
  if (mi < 0) return null;
  let y = now.getUTCFullYear();
  let d = new Date(Date.UTC(y, mi, Number(m[2])));
  if (d.getTime() > now.getTime() + 2 * 86400000) d = new Date(Date.UTC(y - 1, mi, Number(m[2])));
  return isoDate(d);
}

/** Loose event dates seen on Victory Road: "August 28th", "18 June 2026", "25 July", "18 Apr 2026", "September 10th, 2026". */
export function parseLooseDate(text, now = new Date()) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  let m = t.match(/(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.?,? (\d{4})/);
  if (m && monthIndex(m[2]) >= 0) return `${m[3]}-${pad(monthIndex(m[2]) + 1)}-${pad(m[1])}`;
  m = t.match(/([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})/);
  if (m && monthIndex(m[1]) >= 0) return `${m[3]}-${pad(monthIndex(m[1]) + 1)}-${pad(m[2])}`;
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\b/);
  if (m && monthIndex(m[2]) >= 0) return dateFromMonthDay(`${m[2]} ${m[1]}`, now);
  return dateFromMonthDay(t, now);
}
