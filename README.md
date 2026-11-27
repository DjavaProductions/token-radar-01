# Token Launch Radar — model radar-2

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/DjavaProductions/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/DjavaProductions/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

> Entry for the [make.fun bounty: Build the best token launch radar](https://make.fun/bounty/token-radar-01)

A ranked web dashboard of pre-token DeFi protocols by their implied launch value, built from a sealed DefiLlama snapshot. The model uses **category-calibrated peer multiples** (median mcap/TVL from live-token comparables in the same category) combined with chain diversity, growth, and maturity signals — all derived from the snapshot alone.

## Model: radar-2

**Four factors:**

1. **Category peer multiple** — median(mcap_usd / tvl_usd) across all live-token protocols in the same category (n = 94 comps from the snapshot). Gives a data-driven anchor for each sector: Dexs trade at ×0.34, Risk Curators at ×2.98, Cross-Chain Bridges at ×2.21, etc.
2. **Chain diversity bonus** — 3–4 chains ×1.15, 5–7 chains ×1.25, 8+ chains ×1.35.
3. **Growth multiplier** — clamped 7-day TVL change, weight 0.40.
4. **Maturity curve** — 0.60 at launch → 1.00 at ≥ 3 years old.

**Formula:**
```
implied = max(1, round(
  tvl_usd
  × peer_multiple(category)
  × chain_diversity_mult(chains)
  × growth_mult(change_7d)
  × maturity_mult(age_days)
))
```

## Board coverage

- **40 watchlist protocols** (≥ $50M TVL, no token) — all covered
- **180 early finds** below the floor — ranked by TVL, included for discovery value
- **220 total rows** in board.json

## Dashboard features

- 📊 Sortable/filterable board (by implied value, TVL, 7d change, age, rank)
- 🔍 Search by protocol name or slug
- 🗂️ Filter by category, chain, or watchlist-only
- 📄 Detail view per protocol: model breakdown (all 4 multipliers) + 7-step farm plan
- 💹 Live token reference panel (anchors the category multiples)
- ℹ️ Methodology page with the full calibration table
- Fully offline static HTML — no network required

## Running locally

```bash
mkdir out
MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
# Then open out/dashboard/index.html in a browser
```

## License

MIT — see [LICENSE](LICENSE)
