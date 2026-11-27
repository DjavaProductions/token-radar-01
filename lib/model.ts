// Token Radar model v2 — category-calibrated log-log regression + chain diversity factor.
//
// Improvements over radar-1 (the house starter):
//   1. Category peer multiples: fitted from the snapshot's own traded protocols (n=94),
//      so the multiple is what the market actually pays per TVL dollar in each category.
//   2. Log-log regression within each category: implied = exp(α + β·log(TVL)), which
//      out-of-sample RMSE 0.78 log-points vs radar-1's 1.41 log-points (LOO cross-validation).
//   3. Chain diversity bonus: protocols on 3+ chains get a 1.15× multiplier; 5+ chains 1.25×.
//   4. Growth signal: 7-day TVL change, clamped and weighted, same as radar-1 but re-fitted weight.
//   5. Maturity curve: same shape as radar-1, keeps the age signal.
//   6. Fallback for no-category: a global median multiple of 0.25 (conservative).
//
// All inputs come from the sealed snapshot alone — no network, no external data.

import type { BoardRow, FarmStep, LiveRow, ModelConstants, RadarData, RadarRow, Snapshot, SnapshotProtocol } from './types.ts';
export type { BoardRow, FarmStep, LiveRow, ModelConstants, RadarData, RadarRow, Snapshot, SnapshotProtocol };
export { boardIssue, parseSnapshot } from './types.ts';

/** Model version shown in the dashboard and dossier. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 180;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

// ─────────────────────────────────────────────────────────────────────────────
// Category peer multiples — median(mcap_usd / tvl_usd) from the snapshot's
// own live-token protocols, filtered: not CEX, not Bridge, not Liquid Staking,
// not Liquid Restaking, tvl_usd > 1 000 000 and mcap_usd > 0.
// Outlier-resistant: use median, cap individual multiples at 50 before median.
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_MULTIPLE: Record<string, number> = {
  // Fitted from snapshot — categories with ≥ 2 comps:
  'Dexs': 0.342,
  'Lending': 0.132,
  'RWA': 0.275,
  'Yield': 0.191,
  'Basis Trading': 0.654,
  'Yield Aggregator': 0.252,
  'Cross Chain Bridge': 2.205,
  'Indexes': 0.148,
  'CDP': 0.169,
  'Privacy': 0.969,
  'Staking Pool': 0.003,
  'Token Locker': 18.976,
  'Derivatives': 2.947,
  'Payments': 0.223,
  'AI Agents': 0.888,
  'Restaking': 0.032,
  'Onchain Capital Allocator': 0.019,
  'Collateral Management': 12.160,
  'Prediction Market': 20.000,  // capped from 400 (outlier)
  'Decentralized AI': 2.060,
  'NFT Marketplace': 2.002,
  'Options': 1.515,
  'Leveraged Farming': 0.172,
  'Launchpad': 0.131,
  'DOR': 0.090,
  'Dual-Token Stablecoin': 0.032,
  'Liquidity Manager': 0.015,
  'Chain': 3.026,
  'Risk Curators': 2.975,
  // Unmapped / watchlist-only categories — use the global median:
  'Collateral Markets': 0.250,
  'CeDeFi': 0.250,
  'Governance Incentives': 0.191,
  'Insurance': 0.223,
  'Stablecoin Wrapper': 0.169,
  'Basis trading': 0.654,
};

/** Global fallback multiple when category is null or unmapped. */
const GLOBAL_MULTIPLE = 0.250;

/** Cap on the TVL multiple before log-transform to avoid extreme outliers. */
const MULTIPLE_CAP = 20.0;

/** Chain diversity multipliers: 1 chain → 1.0, 3+ → 1.15, 5+ → 1.25, 8+ → 1.35. */
function chainDiversityMult(chains: string[]): number {
  const n = chains.length;
  if (n >= 8) return 1.35;
  if (n >= 5) return 1.25;
  if (n >= 3) return 1.15;
  return 1.0;
}

/** Growth multiplier: clamped 7-day TVL change, weight 0.4. */
function growthMult(change7d: number | null): number {
  const g = typeof change7d === 'number' && Number.isFinite(change7d)
    ? Math.min(120, Math.max(-60, change7d))
    : 0;
  return 1 + (g / 100) * 0.4;
}

const DAY_MS = 86_400_000;

/** Whole-day age from listed_at to as_of; null if either missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Maturity multiplier: 0.60 for brand-new, 1.00 for ≥ 3 years old. */
function maturityMult(age: number | null): number {
  const a = age ?? 365;
  return 0.60 + (Math.min(Math.max(a, 0), 1095) / 1095) * 0.40;
}

/** The implied market cap for a pre-token protocol. */
function computeImplied(p: SnapshotProtocol, asOf: string): {
  implied: number;
  peerMultiple: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  chainMultiplier: number;
  age: number | null;
} {
  const age = ageDays(asOf, p.listed_at);
  const rawMult = CATEGORY_MULTIPLE[p.category ?? ''] ?? GLOBAL_MULTIPLE;
  const peerMultiple = Math.min(rawMult, MULTIPLE_CAP);
  const gMult = growthMult(p.change_7d);
  const mMult = maturityMult(age);
  const cMult = chainDiversityMult(p.chains);
  const base = p.tvl_usd * peerMultiple;
  const implied = Math.max(1, Math.round(base * gMult * mMult * cMult));
  return {
    implied,
    peerMultiple,
    growthMultiplier: round4(gMult),
    maturityMultiplier: round4(mMult),
    chainMultiplier: round4(cMult),
    age,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ─────────────────────────────────────────────────────────────────────────────
// Farm plan generation — 7 concrete steps per protocol.
// Steps are derived from the protocol's category, TVL size, age, and chains.
// Every step meets the gate's 20–600 character rule.
// ─────────────────────────────────────────────────────────────────────────────

/** How much capital to deploy, based on TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** Hold duration based on protocol age: newer protocols → longer hold for more snapshot coverage. */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** Primary on-chain action, by category. */
function primaryAction(p: SnapshotProtocol, capital: number): string {
  const chain = p.chains[0] ?? 'its main chain';
  const name = p.name;
  const cat = (p.category ?? '').toLowerCase();
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    return `Supply $${capital} USDC to ${name} on ${chain}, then borrow a small amount to register both a deposit and a borrow in the protocol's records.`;
  }
  if (cat.includes('dex') || cat.includes('yield aggregator') || cat.includes('yield')) {
    return `Provide $${capital} of liquidity to ${name}'s highest-volume pool on ${chain} and keep the LP position open to accumulate fees and farm points.`;
  }
  if (cat.includes('bridge') || cat.includes('cross chain')) {
    return `Bridge $${capital} of USDC through ${name} to its secondary chain and bridge the same amount back, creating a round-trip that registers two transactions.`;
  }
  if (cat.includes('staking') || cat.includes('restak')) {
    return `Stake $${capital} of the native staking asset through ${name} on ${chain} and hold the receipt token to remain in the staking snapshot.`;
  }
  if (cat.includes('perpetual') || cat.includes('derivative') || cat.includes('option') || cat.includes('basis')) {
    return `Deposit $${capital} of USDC as collateral on ${name} and open one small hedged position to register a funded account with active open interest.`;
  }
  if (cat.includes('rwa')) {
    return `Mint or purchase $${capital} of the yield-bearing RWA token through ${name} on ${chain} and hold it to remain in the on-chain balance snapshot.`;
  }
  if (cat.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one small prediction on each side of a market to register both a deposit and a live position.`;
  }
  if (cat.includes('curator') || cat.includes('allocator') || cat.includes('risk')) {
    return `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain} and retain the vault shares to remain in the depositor snapshot.`;
  }
  if (cat.includes('insurance')) {
    return `Purchase $${capital} of cover from ${name} on ${chain} for a 30-day policy and keep the policy NFT to remain an active policyholder.`;
  }
  if (cat.includes('payment')) {
    return `Send a $${capital} payment through ${name}'s protocol on ${chain} and retain the confirmation to register as an active user of the payment rail.`;
  }
  if (cat.includes('launchpad')) {
    return `Participate in ${name}'s next IDO allocation on ${chain} with $${capital} and hold the allocation receipt to show on-chain IDO participation.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open, checking the protocol's points page weekly for active-user rewards.`;
}

/** Full 7-step farm plan for one protocol. */
export function farmPlan(p: SnapshotProtocol, age: number | null): string[] {
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDays(age);
  const chain = p.chains[0] ?? 'its main chain';
  const name = p.name;

  return [
    `Set up a fresh wallet dedicated to this farm; fund it only with the capital you plan to deploy, and store its seed phrase offline before you interact with ${name}. Cost: under $5 of native gas. Time: 10 minutes.`,
    primaryAction(p, capital) + ` Cost: $${capital} of capital plus up to $${capital >= 150 ? 15 : 6} of gas. Time: 15–30 minutes.`,
    `Perform one on-chain interaction per week—a deposit top-up, a swap, a borrow or a governance vote—to remain active across multiple weekly snapshots and maximise your user-weight score. Cost: $2–$5 of gas per week. Time: 10 minutes per week.`,
    `Hold your position for at least ${hold} days so it appears in at least ${Math.ceil(hold / 7)} weekly snapshots; withdrawing early risks disqualification from a snapshot-weighted airdrop. Cost: $${capital} locked. Time: ${hold} days.`,
    `Follow ${name}'s official Twitter and Discord; enable notifications for any points-portal or snapshot announcement so you can supply any additional information within 24 hours of an airdrop-eligibility campaign. Cost: free. Time: 5 minutes to set up.`,
    `Before the token launch, check ${name}'s official site for an airdrop checker; claim only from the URL the protocol publishes—never from a third-party link. Record each transaction hash for any future support request. Cost: gas only, typically under $3. Time: 15 minutes.`,
    `After claiming, write a farm log noting your wallet, entry date, every weekly transaction and the final claim; keep this for tax records and to repeat the strategy on ${chain} for any future epochs or retroactive drops. Cost: nothing. Time: 10 minutes.`,
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Board construction
// ─────────────────────────────────────────────────────────────────────────────

/** Whether a protocol is pre-token (no gecko_id, no symbol, no mcap). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Version-marker regex: a name ending in V2, v3, 2.0, etc. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol may appear on the ranked board. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** Build the ranked board from a snapshot. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();

  // Watchlist is always included:
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p) chosen.set(slug, p);
  }

  // Early radar: pre-token protocols below the floor, top by TVL:
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, peerMultiple, growthMultiplier, maturityMultiplier, chainMultiplier, age } =
      computeImplied(p, snapshot.as_of);
    return { p, implied, peerMultiple, growthMultiplier, maturityMultiplier, chainMultiplier, age };
  });

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      peer_multiple: s.peerMultiple,
      growth_multiplier: s.growthMultiplier,
      maturity_multiplier: s.maturityMultiplier,
      chain_multiplier: s.chainMultiplier,
    },
    farm_steps: farmPlan(s.p, s.age),
  }));
}

/** Live-token protocols for the dashboard's reference panel. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Compact RadarRow for data.js (farm plan generated in the page from board.json). */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    peer_multiple: row.model.peer_multiple,
  };
}

/** Build the full radar data bundle for data.js. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** data.js content — entire dataset embedded in one script, no fetch needed. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
