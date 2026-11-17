// Victory Road: Replica Teams tables (current + previous-regulation pages) and the event pages they link,
// whose top-cut tables carry both the Replica code and an open-team-sheet vrpaste. Paste sets are merged
// only when the paste's 6 species match the table's 6 species.
import { fetchText, fetchJson, stripTags, decodeEntities, strictCode, makeMember, normalizeSpecies, speciesKey, tierFor, regulationForDate, parseLooseDate, sleep } from '../lib/common.mjs';

const MAIN = 'https://victoryroad.pro/champions-replica/';
const PREV_PAGES = [
  { url: 'https://victoryroad.pro/champions-replica-m-b/', regulation: 'M-B' },
  { url: 'https://victoryroad.pro/champions-replica-m-a/', regulation: 'M-A' },
];
const PASTE_API = id => `https://vrpaste-backend.vercel.app/api/paste/${id}?lang=english`;

function parseTables(html) {
  const out = [];
  for (const table of html.match(/<table[\s\S]*?<\/table>/g) || []) {
    const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(h => stripTags(h[1]).toLowerCase());
    const col = (...names) => headers.findIndex(h => names.includes(h));
    const iPlayer = col('player'), iTeam = col('team'), iCode = col('code', 'replica'), iPaste = col('paste', 'ots'), iBest = col('best results'), iRank = col('#');
    if (iTeam < 0 || iCode < 0) continue;
    for (const row of table.match(/<tr>[\s\S]*?<\/tr>/g) || []) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]);
      if (cells.length < headers.length) continue;
      const code = strictCode(stripTags(cells[iCode]));
      if (!code) continue;
      const species = [...cells[iTeam].matchAll(/<img[^>]*\btitle="([^"]+)"/g)].map(x => normalizeSpecies(decodeEntities(x[1])));
      const playerCell = iPlayer >= 0 ? cells[iPlayer] : '';
      const player = stripTags((playerCell.match(/<b>([\s\S]*?)<\/b>/) || [, playerCell])[1]).split('\n')[0].trim() || null;
      const pasteM = iPaste >= 0 ? cells[iPaste].match(/href="(https?:\/\/(?:www\.)?vrpastes\.com\/([A-Za-z0-9]+))"/) : null;
      let best = null;
      if (iBest >= 0) {
        const c = cells[iBest];
        const bold = (c.match(/<b>([\s\S]*?)<\/b>/) || [, c])[1];
        const parts = bold.split(/<br\s*\/?>/i).map(stripTags).filter(Boolean);
        const link = bold.match(/<a[^>]*href="(https:\/\/victoryroad\.pro\/[^"]+)"/);
        const when = (stripTags(c.replace(bold, '')).match(/\(([^()]*\d[^()]*)\)/) || [])[1];
        best = { eventUrl: link ? link[1] : null, eventName: parts[0] || null, placing: parts[1] || null, when: when || null };
      }
      const rank = iRank >= 0 ? stripTags(cells[iRank]) : null;
      out.push({ code, species, player, pasteUrl: pasteM ? pasteM[1] : null, pasteId: pasteM ? pasteM[2] : null, best, rank });
    }
  }
  return out;
}

function eventMeta(html) {
  const text = stripTags(html).replace(/\s+/g, ' ');
  const title = stripTags((html.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]).replace(/\s*[–-]\s*Victory Road\s*$/, '').trim();
  const reg = (text.match(/Regulation Set (M-[A-Z])/) || [])[1] || null;
  // "Date 31 October–1 November 2026" / "Date 28–30 August 2026": keep the final day.
  const dm = text.match(/Date\s*((?:\d{1,2}\s*[A-Za-z]*\s*[–-]\s*)?\d{1,2} [A-Za-z]{3,9} \d{4})/);
  const date = dm ? parseLooseDate(dm[1].replace(/^.*[–-]\s*/, '')) : null;
  return { title, regulation: reg, date };
}

const placingFromRank = rank => {
  const n = Number(rank);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 1) return 'Champion';
  if (n === 2) return 'Finalist';
  for (const cut of [4, 8, 16, 32, 64]) if (n <= cut) return `Top ${cut}`;
  return `#${n}`;
};

export async function collectVictoryRoad({ full = false, maxEvents = 25, delayMs = 1200, needsPaste = () => true, log = () => {} } = {}) {
  const now = new Date();
  const rows = new Map(); // code -> merged row info
  const pages = [{ url: MAIN, regulation: null }, ...(full ? PREV_PAGES : [])];
  const eventUrls = new Set();
  let fetched = 0, pastesFetched = 0, pastesMerged = 0, pasteMismatch = 0, pasteErrors = 0;
  const mismatchSamples = [];
  for (const page of pages) {
    let html;
    try { html = await fetchText(page.url); fetched++; } catch (err) { if (page.url === MAIN) throw err; log(`VR: ${page.url} failed: ${err.message}`); continue; }
    const parsed = parseTables(html);
    if (page.url === MAIN && !parsed.length) throw new Error('Victory Road replica table parsed 0 codes (layout changed)');
    for (const r of parsed) {
      const date = r.best && r.best.when ? parseLooseDate(r.best.when, now) : null;
      if (r.best && r.best.eventUrl && /victoryroad\.pro\/(20\d\d-|vr-)/.test(r.best.eventUrl)) eventUrls.add(r.best.eventUrl);
      if (!rows.has(r.code)) rows.set(r.code, { ...r, date, pageRegulation: page.regulation, sourceUrl: page.url });
    }
    await sleep(delayMs);
  }
  // Event pages (top-cut tables with codes + OTS pastes)
  const events = [...eventUrls].slice(0, full ? 60 : maxEvents);
  for (const url of events) {
    try {
      const html = await fetchText(url); fetched++;
      const meta = eventMeta(html);
      for (const r of parseTables(html)) {
        const existing = rows.get(r.code);
        if (existing) {
          if (!existing.pasteId && r.pasteId) { existing.pasteId = r.pasteId; existing.pasteUrl = r.pasteUrl; }
          if (!existing.eventRegulation) existing.eventRegulation = meta.regulation;
          if (!existing.date && meta.date) existing.date = meta.date;
        } else {
          rows.set(r.code, { ...r, best: { eventUrl: url, eventName: meta.title, placing: placingFromRank(r.rank), when: null }, date: meta.date, eventRegulation: meta.regulation, sourceUrl: url });
        }
      }
    } catch (err) { log(`VR event ${url} failed: ${err.message}`); }
    await sleep(delayMs);
  }
  const teams = [];
  for (const r of rows.values()) {
    if (r.species.length !== 6) continue;
    let members = r.species.map(species => makeMember({ species }));
    let source = { name: 'Victory Road', url: MAIN };
    let pasteUrl;
    let pasteRegulation = null;
    if (r.pasteId && needsPaste(r.code)) {
      try {
        const paste = await fetchJson(PASTE_API(r.pasteId)); pastesFetched++;
        pasteRegulation = (String(paste.format || '').match(/Regulation Set (M-[A-Z])/) || [])[1] || null;
        const sets = Array.isArray(paste.teams) ? paste.teams : [];
        const tableKeys = members.map(m => speciesKey(m.species)).sort().join('|');
        const pasteKeys = sets.map(s => speciesKey(normalizeSpecies(s.species || s.name))).sort().join('|');
        if (sets.length === 6 && tableKeys === pasteKeys) {
          members = members.map(m => {
            const s = sets.find(x => speciesKey(normalizeSpecies(x.species || x.name)) === speciesKey(m.species));
            return makeMember({ species: m.species, item: s.item, ability: s.ability, moves: s.moves });
          });
          source = { name: 'Victory Road (Replica Teams) + VR Pastes', url: r.pasteUrl };
          pasteUrl = r.pasteUrl;
          pastesMerged++;
        } else { pasteMismatch++; if (mismatchSamples.length < 10) mismatchSamples.push({ code: r.code, table: tableKeys, paste: pasteKeys }); }
      } catch (err) { pasteErrors++; }
      await sleep(400);
    }
    const reg = r.pageRegulation || r.eventRegulation || pasteRegulation || regulationForDate(r.date);
    const basis = r.pageRegulation || r.eventRegulation || pasteRegulation ? 'source-label' : reg ? 'inferred-from-event-date' : 'unknown';
    const eventName = r.best && r.best.eventName;
    const team = {
      code: r.code, title: [r.player, eventName].filter(Boolean).join(' — ') || 'Victory Road team', creator: r.player, format: 'doubles',
      regulation: reg || null, regulationBasis: basis, members,
      event: eventName ? { name: eventName, date: r.date || null, placing: (r.best && r.best.placing) || null } : null,
      source, sourceDate: r.date || null, dataTier: tierFor(members),
    };
    if (pasteUrl) team.pasteUrl = pasteUrl;
    teams.push(team);
  }
  log(`Victory Road: ${fetched} pages, ${teams.length} teams, pastes merged ${pastesMerged}/${pastesFetched}`);
  return { teams, stats: { pagesFetched: fetched, eventPages: events.length, teams: teams.length, pastesFetched, pastesMerged, pasteSpeciesMismatch: pasteMismatch, mismatchSamples, pasteErrors } };
}
