// PokeFeed (pokefeed.app/teams): listing cards carry the rental code + slug; detail pages embed a
// Showdown paste with full sets, plus "Regulation M-C · Doubles · <author> · <date>".
import { fetchText, nextFlight, stripTags, strictCode, makeMember, tierFor, regulationForDate, monthIndex, sleep } from '../lib/common.mjs';

const BASE = 'https://pokefeed.app';

export function parseShowdown(paste) {
  const blocks = String(paste || '').replace(/\r/g, '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim());
    const [head, item] = lines[0].split(/\s+@\s+/);
    const ability = (lines.find(l => /^Ability:/i.test(l)) || '').replace(/^Ability:\s*/i, '') || null;
    const moves = lines.filter(l => /^[-–]\s*/.test(l)).map(l => l.replace(/^[-–]\s*/, ''));
    return makeMember({ species: head, item: item || null, ability, moves });
  }).filter(m => m.species);
}

export async function collectPokeFeed({ needsDetail = () => true, delayMs = 1200, maxDetails = 80, log = () => {} } = {}) {
  const cards = new Map();
  let totalPages = 1, pagesFetched = 0;
  for (let page = 1; page <= Math.min(totalPages, 20); page++) {
    const html = await fetchText(`${BASE}/teams?perPage=50${page > 1 ? `&page=${page}` : ''}`);
    pagesFetched++;
    const flight = nextFlight(html);
    const tp = flight.match(/"totalPages":(\d+)/);
    if (tp) totalPages = Number(tp[1]);
    for (const art of html.split('<article').slice(1)) {
      const slug = (art.match(/href="\/teams\/([a-z0-9-]+)"/) || [])[1];
      const code = strictCode((art.match(/Copy rental code ([A-Za-z0-9 ]{10,12}) to clipboard/) || [])[1]);
      if (slug && code && !cards.has(code)) cards.set(code, slug);
    }
    await sleep(delayMs);
  }
  if (!cards.size) throw new Error('PokeFeed listing parsed 0 coded teams (layout changed)');
  const teams = [];
  let details = 0, detailErrors = 0, listedOnly = 0;
  for (const [code, slug] of cards) {
    const url = `${BASE}/teams/${slug}`;
    if (!needsDetail(code) || details >= maxDetails) { listedOnly++; teams.push({ code, seenOnly: true, source: { name: 'PokeFeed', url } }); continue; }
    try {
      const html = await fetchText(url); details++;
      const flight = nextFlight(html);
      const pm = flight.match(/"showdownPaste":"((?:[^"\\]|\\.)*)"/);
      const members = pm ? parseShowdown(JSON.parse(`"${pm[1]}"`)) : [];
      // "M-C · Doubles" · <author link or lazy $L ref> · "15 Oct 2026"
      const mm = flight.match(/"(M-[A-Z]) · (Singles|Doubles)"," · ",([\s\S]{0,400}?)," · ","(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})"/);
      let authorChunk = mm ? mm[3] : '';
      const lazy = authorChunk.match(/^"\$L([0-9a-z]+)"$/);
      if (lazy) authorChunk = (flight.match(new RegExp(`(?:^|\\n)${lazy[1]}:([^\\n]{0,600})`)) || [, ''])[1];
      const meta = mm ? [mm[0], mm[1], mm[2], ((authorChunk.match(/"href":"\/profile\/([^"]+)"/) || [])[1]) || null, mm[4], mm[5], mm[6]] : null;
      const title = stripTags((html.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1]).replace(/\s*\|\s*PokeFeed\s*$/, '').trim();
      let date = null;
      if (meta) { const mi = monthIndex(meta[5]); if (mi >= 0) date = `${meta[6]}-${String(mi + 1).padStart(2, '0')}-${meta[4].padStart(2, '0')}`; }
      if (members.length !== 6) { detailErrors++; continue; }
      const reg = meta ? meta[1] : regulationForDate(date);
      teams.push({
        code, title: title || slug, creator: meta && meta[3] ? decodeURIComponent(meta[3]) : null, format: meta ? meta[2].toLowerCase() : null,
        regulation: reg || null, regulationBasis: meta ? 'source-label' : reg ? 'inferred-from-submission-date' : 'unknown',
        members, event: null, source: { name: 'PokeFeed', url }, sourceDate: date, dataTier: tierFor(members),
      });
    } catch (err) { detailErrors++; }
    await sleep(delayMs);
  }
  log(`PokeFeed: ${pagesFetched} listing pages, ${cards.size} coded teams, ${details} detail pages`);
  return { teams, stats: { listingPages: pagesFetched, codedTeams: cards.size, detailPages: details, detailErrors, seenOnly: listedOnly } };
}
