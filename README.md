# Champions Dex — live data

Public data files consumed by the Champions Dex app at runtime.

| File | What it is |
| --- | --- |
| `team-codes.json` | Replica Team codes with their six Pokémon (and items/abilities/moves where the source publishes them). |
| `collector-log.json` | Transparency log of the last 30 collector runs: per-source counts, new codes, failures, warnings. |
| `app-version.json` | Latest app release manifest used by the in-app update check. |

## How the team list stays fresh

`.github/workflows/collect.yml` runs `scripts/collect-team-codes.mjs` **every 6 hours** (and on demand via *Run workflow*).
It reads these public, credited community sources, each isolated so one broken site never blocks the others:

- **OP.GG** community Replica Teams (only builds that carry an in-game Team ID; sample builds are skipped)
- **ReplicaDex** (replicadex.com.br) — note: the site labels every team "M-A", even recent ones; the label is kept as published
- **Victory Road** Replica Teams tables + linked event pages; open team sheets from VR Pastes are merged only when all six species match
- **PokeFeed** team pages (Showdown paste on each detail page)

Merge rules: teams are never deleted; teams seen again get a new `lastSeen`; new teams get `firstSeen` from the source date
(or the run date); species-only teams are upgraded to full sets only when a source publishes all six items for the *same six
species*; richer data is never overwritten with poorer data, and nothing is invented. Every code is validated as exactly
10 letters/digits.

Regulation: sources that state a regulation keep their label (`regulationBasis: "source-label"`); otherwise it is inferred
from the submission/event date within the official windows in `scripts/lib/common.mjs` (`"inferred-from-…"`). Nothing is
marked verified — a code can only be confirmed inside Pokémon Champions. When the current window (M-C, until
2 Dec 2026 01:59 UTC) ends and the next set is not yet configured, the last known regulation is kept and a warning is logged.

The workflow fails only when **every** source fails, so a total outage is noticed. A deep crawl (all OP.GG pages, previous-regulation
Victory Road pages) runs on Sundays' first run or via *Run workflow → full*.

Local run: `node scripts/collect-team-codes.mjs [--full] [--dry-run]` (Node 20+, no dependencies).
