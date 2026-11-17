// ReplicaDex (replicadex.com.br): the homepage embeds its whole dataset as serialized objects
// ({title:"..",author:"..",code:"..",type:"Doubles",regulation:"M-A",pokemon:[{name,item,ability,moves}],createdAt:".."}).
// Note: ReplicaDex labels every team "M-A", even recent ones; we keep the site's label as-is (regulationBasis: source-label).
import { fetchText, strictCode, makeMember, tierFor, isoDate } from '../lib/common.mjs';

const URL_HOME = 'https://replicadex.com.br/';
const STR = '"((?:[^"\\\\]|\\\\.)*)"';
const unq = s => { try { return JSON.parse(`"${s}"`); } catch { return s; } };
const field = (block, name) => { const m = block.match(new RegExp(`(?:^|[,{])${name}:${STR}`)); return m ? unq(m[1]) : null; };

export async function collectReplicaDex({ log = () => {} } = {}) {
  const html = await fetchText(URL_HOME);
  const teams = [];
  let blocks = 0, skipped = 0;
  // Each team object starts at `{title:"` and ends at `archivedAt:`.
  const re = /\{title:"(?:[^"\\]|\\.)*",author:[\s\S]*?archivedAt:[^,}]*\}/g;
  let m;
  while ((m = re.exec(html))) {
    blocks++;
    const b = m[0];
    const code = strictCode(field(b, 'code'));
    if (!code) { skipped++; continue; }
    const members = [];
    const pre = /\{dex:\d+,name:"((?:[^"\\]|\\.)*)"([\s\S]*?)moves:(?:\$R\[\d+\]=)?\[((?:"(?:[^"\\]|\\.)*",?)*)\]\}/g;
    let p;
    while ((p = pre.exec(b))) {
      const rest = p[2];
      const val = n => { const x = rest.match(new RegExp(`(?:^|,)${n}:${STR}`)); return x ? unq(x[1]) : null; };
      const moves = [...p[3].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => unq(x[1]));
      members.push(makeMember({ species: unq(p[1]), item: val('item'), ability: val('ability'), moves }));
    }
    if (members.length !== 6) { skipped++; continue; }
    const type = (field(b, 'type') || '').toLowerCase();
    const createdAt = field(b, 'createdAt');
    const archetypes = (b.match(/archetypes:(?:\$R\[\d+\]=)?\[((?:"(?:[^"\\]|\\.)*",?)*)\]/) || [])[1];
    const arch = archetypes ? [...archetypes.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(x => unq(x[1])) : [];
    const author = field(b, 'author');
    teams.push({
      code, title: field(b, 'title') || 'Untitled team', creator: author && author !== 'Unknown' ? author : null,
      format: type === 'doubles' ? 'doubles' : type === 'singles' ? 'singles' : null,
      regulation: field(b, 'regulation'), regulationBasis: 'source-label',
      archetype: arch.length ? arch.join(', ') : undefined,
      members, event: null, source: { name: 'ReplicaDex', url: URL_HOME }, sourceDate: createdAt ? isoDate(createdAt) : null, dataTier: tierFor(members),
    });
  }
  if (!blocks) throw new Error('ReplicaDex homepage no longer embeds team objects (layout changed)');
  log(`ReplicaDex: ${blocks} objects, ${teams.length} teams, ${skipped} skipped`);
  return { teams, stats: { objects: blocks, teams: teams.length, skipped, note: 'ReplicaDex labels all teams M-A; label kept as published' } };
}
