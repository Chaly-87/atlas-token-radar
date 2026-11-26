// ATLAS — an independent token-launch radar for token-radar-01.
//
// Written from scratch for this bounty. No code, prompt, dataset or identifier comes from any
// other system of the owner's: the only inputs are the sealed snapshot and the parameters below.
//
// The model reads three facts DefiLlama already records for every protocol — how much value it
// custodies (TVL), how fast that value moved in the last seven days, and how long it has run
// without a token — and turns them into a claim about what a token would be worth if the
// protocol's record stayed as it is. A sector multiple is the bridge between TVL and fully
// diluted value: it is what the market already pays per dollar of TVL in that kind of business.
//
//   implied_fdv = TVL x sector_multiple x growth_multiplier x maturity_multiplier x breadth
//
// Every row also carries a launch probability from the same figures, so a reader can weigh a
// big protocol that may never launch against a smaller one that is already positioning for it.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Params {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_span: number;
  maturity_months: number;
  unknown_months: number;
  breadth_step: number;
  breadth_max: number;
  odds_bias: number;
  odds_tvl: number;
  odds_growth: number;
  odds_months: number;
  odds_watchlist: number;
  odds_floor: number;
  odds_cap: number;
}

export const PARAMS: Params = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.88,
  maturity_span: 0.32,
  maturity_months: 36,
  unknown_months: 12,
  breadth_step: 0.025,
  breadth_max: 5,
  odds_bias: -1.6,
  odds_tvl: 0.62,
  odds_growth: 0.015,
  odds_months: 0.018,
  odds_watchlist: 0.25,
  odds_floor: 0.03,
  odds_cap: 0.9,
};

export const MODEL_ID = 'atlas-1';

// What the market pays per dollar of TVL, by the category DefiLlama puts the protocol in.
// One table, applied to every protocol in that category: no name is ever special-cased.
const SECTOR: Record<string, number> = {
  Dexs: 4.2,
  Dex: 4.2,
  Lending: 3.4,
  Perps: 5.2,
  Derivatives: 5.0,
  Options: 3.8,
  Synthetics: 3.4,
  Yield: 3.2,
  'Yield Aggregator': 3.2,
  'Leveraged Farming': 2.6,
  CDP: 4.6,
  RWA: 6.5,
  Restaking: 4.8,
  'Liquid Restaking': 4.8,
  Staking: 3.6,
  'Staking Pool': 3.6,
  Farm: 2.2,
  Gaming: 2.6,
  'NFT Marketplace': 2.0,
  Payments: 4.0,
  Insurance: 2.6,
  Service: 2.8,
  'Algo-Stables': 3.0,
  'Cross Chain': 3.6,
  'Prediction Market': 4.4,
  Launchpad: 3.0,
  'Telegram Bot': 2.4,
  'Onchain Capital Allocator': 2.8,
  'Basis Trading': 3.0,
  SoFi: 3.0,
  CEX: 2.0,
  Bridge: 3.0,
  'Canonical Bridge': 3.0,
};

const SECTOR_DEFAULT = 2.8;

export function sectorMultiple(category: string | null): number {
  if (category === null) return SECTOR_DEFAULT;
  return SECTOR[category] ?? SECTOR_DEFAULT;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const DAY = 86_400_000;

/** A protocol that records no token at all: no market cap, no CoinGecko id, no ticker. */
export function preToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A product of a token that already trades, or a versioned pool: never a launch of its own. */
export function derivative(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (VERSIONED.test(p.name)) return true;
  if (WRAPPED.test(p.name)) return true;
  const lower = p.name.toLowerCase();
  return EXCHANGES.some((x) => lower.startsWith(x));
}

/** Whole days from the snapshot's date back to the day DefiLlama began tracking the protocol. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY));
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export interface Scored {
  multiplier: number;
  growthPct: number;
  growthMultiplier: number;
  maturityMultiplier: number;
  breadthMultiplier: number;
  age: number | null;
  months: number;
  implied: number;
  odds: number;
  weighted: number;
}

/** Every multiplier the board shows, and the two numbers a reader acts on. */
export function score(p: Protocol, asOf: string, watched: boolean, params: Params = PARAMS): Scored {
  const age = ageDays(asOf, p.listed_at);
  const months = age === null ? params.unknown_months : Math.min(age / 30.44, 240);
  const growthPct = clamp(p.change_7d ?? 0, params.growth_floor, params.growth_cap);
  const growthMultiplier = 1 + (growthPct / 100) * params.growth_weight;
  const maturityMultiplier = params.maturity_floor + (Math.min(months, params.maturity_months) / params.maturity_months) * params.maturity_span;
  const breadthMultiplier = 1 + Math.min(Math.max(p.chains.length - 1, 0), params.breadth_max) * params.breadth_step;
  const multiplier = sectorMultiple(p.category);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiplier * growthMultiplier * maturityMultiplier * breadthMultiplier));

  const z =
    params.odds_bias +
    params.odds_tvl * Math.log10(Math.max(p.tvl_usd, 1) / 1e7) +
    params.odds_growth * growthPct +
    params.odds_months * Math.min(months, params.maturity_months) +
    (watched ? params.odds_watchlist : 0);
  const odds = clamp(1 / (1 + Math.exp(-z)), params.odds_floor, params.odds_cap);
  const weighted = Math.max(1, Math.round(implied * odds));

  return {
    multiplier,
    growthPct: Math.round(growthPct * 100) / 100,
    growthMultiplier: Math.round(growthMultiplier * 1e4) / 1e4,
    maturityMultiplier: Math.round(maturityMultiplier * 1e4) / 1e4,
    breadthMultiplier: Math.round(breadthMultiplier * 1e4) / 1e4,
    age,
    months: Math.round(months * 10) / 10,
    implied,
    odds: Math.round(odds * 1e4) / 1e4,
    weighted,
  };
}

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  risk_weighted_usd: number;
  model: {
    sector_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    months_without_token: number;
  };
  farm_steps: string[];
}

const RANKABLE_CATEGORIES = new Set(['CEX']);

/** The board: every pre-token protocol the snapshot carries, best implied value first. */
export function board(snapshot: Snapshot, params: Params = PARAMS): Row[] {
  const watched = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => preToken(p) && !derivative(p) && (p.category === null || !RANKABLE_CATEGORIES.has(p.category)));
  const scored = chosen.map((p) => ({ p, s: score(p, snapshot.as_of, watched.has(p.slug), params) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((e, i) => ({
    rank: i + 1,
    slug: e.p.slug,
    name: e.p.name,
    category: e.p.category,
    chains: e.p.chains,
    tvl_usd: e.p.tvl_usd,
    change_7d: e.p.change_7d,
    mcap_usd: null,
    listed_at: e.p.listed_at,
    gecko_id: null,
    symbol: null,
    token_status: 'pre-token',
    watchlist: watched.has(e.p.slug),
    age_days: e.s.age,
    implied_value_usd: e.s.implied,
    launch_odds: e.s.odds,
    risk_weighted_usd: e.s.weighted,
    model: {
      sector_multiple: e.s.multiplier,
      growth_pct: e.s.growthPct,
      growth_multiplier: e.s.growthMultiplier,
      maturity_multiplier: e.s.maturityMultiplier,
      breadth_multiplier: e.s.breadthMultiplier,
      months_without_token: e.s.months,
    },
    farm_steps: plan(e.p, e.s.months, i + 1),
  }));
}

/* ------------------------------------------------------------------ farm plans */

function capitalFor(tvl: number): number {
  if (tvl >= 5e9) return 300;
  if (tvl >= 1e9) return 200;
  if (tvl >= 2e8) return 120;
  if (tvl >= 5e7) return 80;
  return 50;
}

function holdFor(months: number): number {
  if (months < 6) return 60;
  if (months < 12) return 45;
  return 30;
}

function action(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (/lend|cdp|collateral|money market/.test(c)) return `Supply $${capital} of USDC to ${p.name} on ${chain} and keep the position open`;
  if (/dex|liquidity|yield|farm/.test(c)) return `Add $${capital} of liquidity to ${p.name}'s deepest pool on ${chain} and keep it in range`;
  if (/perp|deriv|option|synthet/.test(c)) return `Deposit $${capital} of USDC as margin on ${p.name} and open one small hedge`;
  if (/rwa|real world/.test(c)) return `Mint or buy $${capital} of ${p.name}'s yield asset on ${chain} and hold it`;
  if (/restak|staking|stake/.test(c)) return `Stake $${capital} of the chain's staking asset through ${p.name} and keep the receipt token`;
  if (/bridge|cross chain/.test(c)) return `Bridge $${capital} of USDC to ${chain} through ${p.name} and use the funds inside its app`;
  if (/predict/.test(c)) return `Fund $${capital} on ${p.name} and take one position in a market you follow`;
  if (/stable/.test(c)) return `Mint or deposit $${capital} of the stable asset through ${p.name} on ${chain}`;
  if (/insur/.test(c)) return `Buy $${capital} of cover from ${p.name} on ${chain} and keep the policy active`;
  if (/launchpad/.test(c)) return `Hold $${capital} of the chain's base asset on ${p.name} and take part in one launch`;
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open`;
}

/** Five steps: the money in, the qualifying action, the hold, the claim, the record. */
export function plan(p: Protocol, months: number, rank: number): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdFor(months);
  const gas = capital >= 200 ? 9 : 5;
  return [
    `Open a wallet used only for farming and fund it with $${capital} plus about $${gas} for gas; never reuse a wallet that holds savings. Cost: $${gas} of gas. Time: 10 minutes.`,
    `${action(p, capital, chain)}. Cost: $${capital} of capital, about $${gas} of gas. Time: 15 minutes to set up.`,
    `Make one more qualifying action inside ${p.name} after a week (a deposit, a borrow, a swap or a vote), because most allocations count activity across snapshots. Cost: about $2 of gas. Time: 10 minutes.`,
    `Hold for at least ${hold} days and keep the position visible; rank ${rank} on this board is a starting point, not a promise that a token appears. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Check ${p.name}'s own site for a claim page before you withdraw, and claim only from the link the protocol publishes. Cost: no fee to check; never pay to claim. Time: 10 minutes.`,
  ];
}

/* ------------------------------------------------------------------ dashboard data */

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_id: string;
  params: Params;
  sector: Record<string, number>;
  counts: { protocols: number; pre_token: number; watchlist: number; board: number; live: number };
  aggregates: { median_implied: number; top10_share: number; median_odds: number; tvl_sum: number };
  categories: string[];
  chains: string[];
  rows: Row[];
  live: { slug: string; name: string; category: string | null; tvl_usd: number; mcap_usd: number | null; change_7d: number | null }[];
}

export function radarData(snapshot: Snapshot, rows: Row[], params: Params = PARAMS): RadarData {
  const implied = rows.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const median = implied.length === 0 ? 0 : implied[Math.floor(implied.length / 2)]!;
  const total = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const top10 = rows.slice(0, 10).reduce((s, r) => s + r.implied_value_usd, 0);
  const odds = rows.map((r) => r.launch_odds).sort((a, b) => a - b);
  const live = snapshot.protocols
    .filter((p) => !preToken(p) && p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 30)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
  const categories = [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_id: MODEL_ID,
    params,
    sector: SECTOR,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: rows.length,
      watchlist: snapshot.watchlist.length,
      board: rows.length,
      live: live.length,
    },
    aggregates: {
      median_implied: median,
      top10_share: total === 0 ? 0 : Math.round((top10 / total) * 1e4) / 1e4,
      median_odds: odds.length === 0 ? 0 : odds[Math.floor(odds.length / 2)]!,
      tvl_sum: rows.reduce((s, r) => s + r.tvl_usd, 0),
    },
    categories,
    chains,
    rows,
    live,
  };
}

/* ------------------------------------------------------------------ input handling */

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('the snapshot is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('the snapshot has no as_of date');
  if (typeof o.floor_usd !== 'number' || !Number.isFinite(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('the snapshot has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('the snapshot has no protocols');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('the snapshot has no watchlist');
  const protocols = (o.protocols as unknown[]).map((v, i) => {
    if (typeof v !== 'object' || v === null) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: typeof o.source === 'string' ? o.source : '', floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** The gate's rows, checked before the program writes anything: a board that fails here never ships. */
export function boardIssues(rows: Row[], snapshot: Snapshot): string[] {
  const issues: string[] = [];
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) issues.push(`missing ${missing.length} watchlist slugs: ${missing.slice(0, 4).join(', ')}`);
  if (rows.length < 100) issues.push(`only ${rows.length} rows, the gate takes 100 at least`);
  if (rows.length > 4000) issues.push(`too many rows: ${rows.length}`);
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) issues.push(`rank ${i + 1} is ${r.rank}`);
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) issues.push(`row ${i + 1} outranks row ${i}`);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) issues.push(`${r.slug} implied value`);
    if (r.implied_value_usd > 1e14) issues.push(`${r.slug} implied value past the cap`);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) issues.push(`${r.slug} has ${r.farm_steps.length} steps`);
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) issues.push(`${r.slug} step length ${t.length}`);
    }
  });
  if (new Set(rows.map((r) => r.slug)).size !== rows.length) issues.push('a slug repeats');
  if (rows.length > 1 && new Set(rows.map((r) => r.implied_value_usd)).size === 1) issues.push('every row has the same implied value');
  return issues;
}
