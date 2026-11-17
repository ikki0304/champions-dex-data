#!/usr/bin/env node
// Champions Dex team-code collector.
// Refreshes team-codes.json from public community sources, merging without ever deleting teams.
// Usage: node scripts/collect-team-codes.mjs [--full] [--dry-run]
//   --full      deep crawl (all OP.GG pages, previous-regulation Victory Road pages). Also runs automatically
//               on Sundays' first run (UTC) or when COLLECT_FULL=1.
//   --dry-run   do everything but write files.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { currentRegulation, isValidTeamCode, normalizeTeamCode, normalizeSpecies, speciesSetKey, speciesKey, tierFor, isoDate } from './lib/common.mjs';
import { collectOpgg } from './sources/opgg.mjs';
import { collectReplicaDex } from './sources/replicadex.mjs';
import { collectVictoryRoad } from './sources/victoryroad.mjs';
import { collectPokeFeed } from './sources/pokefeed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'team-codes.json');
const LOG_FILE = path.join(ROOT, 'collector-log.json');
const MAX_LOG_RUNS = 30;

const args = new Set(process.argv.slice(2));
const now = new Date();
const today = isoDate(now);
const FULL = args.has('--full') || process.env.COLLECT_FULL === '1' || process.env.COLLECT_FULL === 'true' || (now.getUTCDay() === 0 && now.getUTCHours() < 6);
const DRY = args.has('--dry-run');
const log = msg => console.log(`[collector] ${msg}`);

function validateDataset(payload) {
  const issues = [];
  const seen = new Set();
  payload.teams.forEach((team, index) => {
    if (!isValidTeamCode(team.code)) issues.push(`team ${index}: invalid code ${team.code}`);
    const code = normalizeTeamCode(team.code);
    if (seen.has(code)) issues.push(`duplicate code ${code}`);
    seen.add(code);
    if (!Array.isArray(team.members) || team.members.length !== 6) issues.push(`team ${code}: expected 6 members`);
    (team.members || []).forEach(m => { if (!m.species) issues.push(`team ${code}: member without species`); });
    if (!['A', 'B', 'C'].includes(team.dataTier)) issues.push(`team ${code}: invalid dataTier ${team.dataTier}`);
    if (team.dataTier === 'A' && (team.members || []).some(m => !m.item)) issues.push(`team ${code}: Tier A team missing an item`);
  });
  return issues;
}

const memberRichness = m => (m.item ? 4 : 0) + (m.ability ? 2 : 0) + (Array.isArray(m.moves) && m.moves.length ? 1 : 0);
const richness = t => (t.dataTier === 'A' ? 100 : 0) + (t.members || []).reduce((s, m) => s + memberRichness(m), 0);

function buildNewTeam(c) {
  const team = { code: c.code, title: c.title, creator: c.creator ?? null, format: c.format ?? null, regulation: c.regulation ?? null };
  if (c.archetype) team.archetype = c.archetype;
  Object.assign(team, {
    members: c.members, event: c.event ?? null, source: c.source,
    firstSeen: c.sourceDate && c.sourceDate <= today ? c.sourceDate : today, lastSeen: today, dataTier: tierFor(c.members),
  });
  if (c.pasteUrl) team.pasteUrl = c.pasteUrl;
  team.regulationBasis = c.regulationBasis || 'unknown'; // never "verified": codes can only be confirmed in-game
  return team;
}

/** Merge a fresher candidate into an existing team. Never deletes, never downgrades, never invents. */
function mergeInto(team, c, counters) {
  let changed = false;
  if (!team.lastSeen || team.lastSeen < today) { team.lastSeen = today; changed = true; }
  if (!team.firstSeen) { team.firstSeen = c.sourceDate && c.sourceDate <= today ? c.sourceDate : today; changed = true; }
  if (c.seenOnly) return changed;
  for (const k of ['creator', 'format', 'regulation']) if (team[k] == null && c[k] != null) { team[k] = c[k]; changed = true; }
  if (!team.event && c.event) { team.event = c.event; changed = true; }
  if (!Array.isArray(c.members) || c.members.length !== 6) return changed;
  if (speciesSetKey(team.members) !== speciesSetKey(c.members)) { counters.speciesConflicts.push(team.code); return changed; }
  const wasTier = team.dataTier;
  team.members = team.members.map(m => {
    const cm = c.members.find(x => speciesKey(x.species) === speciesKey(m.species));
    if (!cm) return m;
    const next = { ...m };
    if (!next.item && cm.item) next.item = cm.item;
    if (!next.ability && cm.ability) next.ability = cm.ability;
    if ((!Array.isArray(next.moves) || !next.moves.length) && Array.isArray(cm.moves) && cm.moves.length) next.moves = cm.moves;
    if (JSON.stringify(next) !== JSON.stringify(m)) changed = true;
    return next;
  });
  const newTier = tierFor(team.members);
  if (wasTier !== 'A' && newTier === 'A') {
    team.dataTier = 'A';
    if (!String(team.source && team.source.name).includes(c.source.name)) team.source = { name: `${team.source.name} + ${c.source.name}`, url: c.source.url || team.source.url };
    if (c.pasteUrl && !team.pasteUrl) team.pasteUrl = c.pasteUrl;
    counters.enriched.push(team.code);
    changed = true;
  }
  return changed;
}

async function main() {
  const startedAt = new Date().toISOString();
  const payload = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  let runLog = { runs: [] };
  try { runLog = JSON.parse(await readFile(LOG_FILE, 'utf8')); } catch { /* first run */ }
  const before = payload.teams.length;
  // Canonical species spelling (e.g. "Rotom-Heat" -> "Heat Rotom") so filters and Team Builder resolve consistently.
  let speciesRenamed = 0;
  for (const team of payload.teams) for (const m of team.members || []) {
    const canon = normalizeSpecies(m.species);
    if (canon && canon !== m.species) { m.species = canon; speciesRenamed++; }
  }
  const byCode = new Map(payload.teams.map(t => [normalizeTeamCode(t.code), t]));
  const needsEnrichment = code => !byCode.has(code) || byCode.get(code).dataTier !== 'A';
  const latestOpgg = payload.teams.filter(t => t.source && t.source.name === 'OP.GG' && t.firstSeen).map(t => t.firstSeen).sort().pop();
  const sinceIso = latestOpgg ? new Date(Date.parse(`${latestOpgg}T00:00:00Z`) - 3 * 86400000).toISOString() : null;
  log(`mode=${FULL ? 'full' : 'incremental'} teams before=${before}`);

  const sources = [
    ['OP.GG', () => collectOpgg({ full: FULL, sinceIso, maxPages: FULL ? 120 : 15, log })],
    ['ReplicaDex', () => collectReplicaDex({ log })],
    ['Victory Road', () => collectVictoryRoad({ full: FULL, needsPaste: needsEnrichment, log })],
    ['PokeFeed', () => collectPokeFeed({ needsDetail: needsEnrichment, log })],
  ];
  const t0 = Date.now();
  const results = await Promise.allSettled(sources.map(async ([name, fn]) => {
    const s = Date.now();
    const r = await fn();
    return { ...r, ms: Date.now() - s };
  }));

  const sourceSummary = {};
  const candidates = [];
  results.forEach((r, i) => {
    const name = sources[i][0];
    if (r.status === 'fulfilled') {
      sourceSummary[name] = { ok: true, candidates: r.value.teams.length, ms: r.value.ms, stats: r.value.stats };
      for (const t of r.value.teams) candidates.push({ ...t, _src: name });
    } else {
      sourceSummary[name] = { ok: false, error: String(r.reason && r.reason.message || r.reason).slice(0, 300) };
      log(`${name} FAILED: ${sourceSummary[name].error}`);
    }
  });
  const okCount = Object.values(sourceSummary).filter(s => s.ok).length;
  const warnings = [];
  const counters = { enriched: [], speciesConflicts: [], invalid: 0 };
  const newCodes = [];
  const perSourceNew = {};
  let changedTeams = 0;

  // Richest candidates first so a brand-new team is created from the fullest set available.
  candidates.sort((a, b) => (b.seenOnly ? -1 : richness(b)) - (a.seenOnly ? -1 : richness(a)));
  for (const c of candidates) {
    const code = normalizeTeamCode(c.code);
    if (!isValidTeamCode(code) || code !== c.code) { counters.invalid++; continue; }
    const existing = byCode.get(code);
    if (existing) { if (mergeInto(existing, c, counters)) changedTeams++; continue; }
    if (c.seenOnly || !Array.isArray(c.members) || c.members.length !== 6 || c.members.some(m => !m.species)) continue;
    const team = buildNewTeam(c);
    payload.teams.push(team);
    byCode.set(code, team);
    newCodes.push(code);
    perSourceNew[c._src] = (perSourceNew[c._src] || 0) + 1;
  }
  for (const [name, n] of Object.entries(perSourceNew)) sourceSummary[name].newTeams = n;

  const regulationCurrent = currentRegulation(now, payload.regulationCurrent, warnings);
  const issues = validateDataset(payload);
  if (issues.length) throw new Error(`Merged dataset failed validation (${issues.length} issues): ${issues.slice(0, 5).join('; ')}`);
  if (payload.teams.length < before) throw new Error('Refusing to write: team count decreased');

  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  const contentChanged = newCodes.length > 0 || changedTeams > 0 || speciesRenamed > 0 || regulationCurrent !== payload.regulationCurrent;
  const out = {
    version: `auto-${stamp}`,
    updatedAt: now.toISOString(),
    lastChangedAt: contentChanged ? now.toISOString() : (payload.lastChangedAt || payload.updatedAt),
    regulationCurrent,
    collector: { schedule: 'every 6 hours (GitHub Actions)', sourcesOk: okCount, sourcesTotal: sources.length, log: 'collector-log.json' },
    teams: payload.teams,
  };
  const tierA = out.teams.filter(t => t.dataTier === 'A').length;
  const summary = {
    startedAt, finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, mode: FULL ? 'full' : 'incremental',
    sourcesOk: okCount, sources: sourceSummary,
    totals: { before, after: out.teams.length, newTeams: newCodes.length, teamsUpdated: changedTeams, enrichedToTierA: counters.enriched.length, tierA, tierB: out.teams.length - tierA },
    newCodes: newCodes.slice(0, 100), enrichedCodes: counters.enriched.slice(0, 100),
    speciesConflicts: [...new Set(counters.speciesConflicts)].slice(0, 50), invalidCandidates: counters.invalid, speciesRenamed,
    regulationCurrent, warnings,
  };
  runLog.runs = [summary, ...(runLog.runs || [])].slice(0, MAX_LOG_RUNS);
  log(JSON.stringify(summary.totals));
  if (okCount === 0) {
    if (!DRY) await writeFile(LOG_FILE, `${JSON.stringify(runLog, null, 1)}\n`);
    console.error('[collector] ALL sources failed — team-codes.json left untouched.');
    process.exit(1);
  }
  if (!DRY) {
    await writeFile(DATA_FILE, `${JSON.stringify(out, null, 1)}\n`);
    await writeFile(LOG_FILE, `${JSON.stringify(runLog, null, 1)}\n`);
  }
  log(`done: ${okCount}/${sources.length} sources ok${DRY ? ' (dry run, nothing written)' : ''}`);
}

main().catch(err => { console.error(`[collector] fatal: ${err.stack || err}`); process.exit(1); });
