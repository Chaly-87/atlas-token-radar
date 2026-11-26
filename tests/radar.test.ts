// Tests for lib/radar.ts: the value model, the launch-odds logistic and the board's ordering.
//
// Expected numbers are derived by hand from the documented model in the file's header:
//
//   implied = TVL x sector multiple x growth x maturity x breadth
//   odds    = clamp(logistic(bias + tvl + growth + months + watchlist), 0.03, 0.9)
//
// with PARAMS as shipped (growth weight 0.5, growth clamp -60..150, maturity 0.88..1.20 over
// 36 months, breadth +2.5% per extra chain capped at five, unknown age 12 months).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { board, defaultSector, median, PARAMS, radarData, score, sectorMultiple } from '../lib/radar.ts';
import type { Params, Protocol, Snapshot } from '../lib/radar.ts';

const AS_OF = '2026-01-01';

function protocol(overrides: Partial<Protocol> = {}): Protocol {
  return {
    slug: 'example',
    name: 'Example',
    category: 'Dexs',
    chains: ['Ethereum'],
    tvl_usd: 1e7,
    change_7d: 0,
    mcap_usd: null,
    listed_at: null,
    gecko_id: null,
    symbol: null,
    ...overrides,
  };
}

function snapshot(protocols: Protocol[], watchlist: string[] = []): Snapshot {
  return { as_of: AS_OF, source: 'test', floor_usd: 1e6, protocols, watchlist };
}

function params(overrides: Partial<Params> = {}): Params {
  return { ...PARAMS, ...overrides };
}

describe('sectorMultiple', () => {
  it('reads the sector table for a known category', () => {
    assert.equal(sectorMultiple('Dexs'), 4.2);
    assert.equal(sectorMultiple('Lending'), 3.4);
    assert.equal(sectorMultiple('Bridge'), 3.0);
    assert.equal(sectorMultiple('RWA'), 6.5);
  });

  it('falls back to the default multiple for an unknown or missing category', () => {
    assert.equal(sectorMultiple('Not A Real Category'), 2.8);
    assert.equal(sectorMultiple(null), 2.8);
  });
});

describe('defaultSector', () => {
  it('flags only the categories the sector table does not hold', () => {
    assert.equal(defaultSector('Dexs'), false);
    assert.equal(defaultSector('Service'), false); // a known category that happens to map to 2.8
    assert.equal(defaultSector('Not A Real Category'), true);
    assert.equal(defaultSector(null), true);
  });
});

describe('median', () => {
  it('reads zero for an empty list and the only value for a one-element list', () => {
    assert.equal(median([]), 0);
    assert.equal(median([7]), 7);
    assert.equal(median([4_144_000]), 4_144_000);
  });

  it('takes the central value when the count is odd', () => {
    assert.equal(median([3, 4.5, 10]), 4.5);
    assert.equal(median([1, 2, 3, 4, 100]), 3);
  });

  it('averages the two central values when the count is even, rounding the mean', () => {
    assert.equal(median([1, 2]), 2); // 1.5 rounds up
    assert.equal(median([4, 9]), 7); // 6.5 rounds up
    assert.equal(median([1, 2, 3, 4]), 3); // (2 + 3) / 2 = 2.5, rounded up
    assert.equal(median([4_144_000, 8_288_000, 12_432_000, 16_576_000]), 10_360_000);
  });

  it('rounds through the rounding function it is given', () => {
    assert.equal(median([1, 2], Math.floor), 1);
    assert.equal(median([1, 1.5], (n) => Math.round(n * 10) / 10), 1.3);
  });
});

describe('score: implied value', () => {
  it('multiplies TVL by the sector, growth, maturity and breadth factors', () => {
    // TVL 10M x Dexs 4.2 x growth 1 (0%) x maturity 0.88 + 12/36 x 0.32 = 0.9867 x breadth 1.
    const s = score(protocol(), AS_OF, false);
    assert.equal(s.multiplier, 4.2);
    assert.equal(s.growthPct, 0);
    assert.equal(s.growthMultiplier, 1);
    assert.equal(s.maturityMultiplier, 0.9867);
    assert.equal(s.breadthMultiplier, 1);
    assert.equal(s.months, 12);
    assert.equal(s.age, null);
    assert.equal(s.implied, 41_440_000);
    assert.equal(s.odds, 0.2004);
    assert.equal(s.weighted, 8_303_223);
  });

  it('clamps growth to the -60..+150 percent band and weights it at 0.5', () => {
    const up = score(protocol({ change_7d: 400 }), AS_OF, false);
    assert.equal(up.growthPct, 150);
    assert.equal(up.growthMultiplier, 1.75);

    const down = score(protocol({ change_7d: -400 }), AS_OF, false);
    assert.equal(down.growthPct, -60);
    assert.equal(down.growthMultiplier, 0.7);

    const mid = score(protocol({ change_7d: 20 }), AS_OF, false);
    assert.equal(mid.growthPct, 20);
    assert.equal(mid.growthMultiplier, 1.1);
  });

  it('treats a missing change_7d as no growth', () => {
    const s = score(protocol({ change_7d: null }), AS_OF, false);
    assert.equal(s.growthPct, 0);
    assert.equal(s.growthMultiplier, 1);
  });

  it('runs maturity from 0.88 at launch to 1.20 after 36 months without a token', () => {
    const fresh = score(protocol({ listed_at: AS_OF }), AS_OF, false);
    assert.equal(fresh.age, 0);
    assert.equal(fresh.months, 0);
    assert.equal(fresh.maturityMultiplier, 0.88);

    // 365 days is just under 12 months: 0.88 + (365/30.44)/36 x 0.32.
    const year = score(protocol({ listed_at: '2025-01-01' }), AS_OF, false);
    assert.equal(year.age, 365);
    assert.equal(year.months, 12);
    assert.ok(Math.abs(year.maturityMultiplier - 0.9866) < 1e-9);
    assert.ok(year.implied > 41_430_000 && year.implied < 41_440_000);

    const old = score(protocol({ listed_at: '2005-01-01' }), AS_OF, false);
    assert.equal(old.age, 7670);
    assert.equal(old.months, 240);
    assert.equal(old.maturityMultiplier, 1.2);
  });

  it('adds 2.5 percent of breadth per extra chain, capped at five extra chains', () => {
    assert.equal(score(protocol({ chains: [] }), AS_OF, false).breadthMultiplier, 1);
    assert.equal(score(protocol({ chains: ['Ethereum'] }), AS_OF, false).breadthMultiplier, 1);
    assert.equal(score(protocol({ chains: ['a', 'b', 'c'] }), AS_OF, false).breadthMultiplier, 1.05);
    assert.equal(score(protocol({ chains: ['a', 'b', 'c', 'd', 'e', 'f'] }), AS_OF, false).breadthMultiplier, 1.125);
    assert.equal(score(protocol({ chains: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }), AS_OF, false).breadthMultiplier, 1.125);
  });

  it('rounds to a whole dollar and never reports less than one', () => {
    // TVL 1 x 4.2 x 0.7 x 0.88 x 1 = 2.59 dollars.
    const tiny = score(protocol({ tvl_usd: 1, change_7d: -60, chains: [], listed_at: AS_OF }), AS_OF, false);
    assert.equal(tiny.implied, 3);
    assert.equal(tiny.weighted, 1);

    const zero = score(protocol({ tvl_usd: 0 }), AS_OF, false);
    assert.equal(zero.implied, 1);

    for (const tvl of [1, 999, 1e6, 1e7, 1e9, 1e12]) {
      assert.ok(Number.isSafeInteger(score(protocol({ tvl_usd: tvl }), AS_OF, false).implied));
    }
  });

  it('scales the implied value with TVL when every other input is held fixed', () => {
    const one = score(protocol({ tvl_usd: 1e9 }), AS_OF, false).implied;
    const two = score(protocol({ tvl_usd: 2e9 }), AS_OF, false).implied;
    assert.ok(two > one);
    assert.ok(Math.abs(two / one - 2) < 1e-9);
  });

  it('takes its weights from the params it is given', () => {
    const noGrowth = score(protocol({ change_7d: 100 }), AS_OF, false, params({ growth_weight: 0 }));
    assert.equal(noGrowth.growthPct, 100);
    assert.equal(noGrowth.growthMultiplier, 1);

    const flatMaturity = score(protocol({ listed_at: '2005-01-01' }), AS_OF, false, params({ maturity_span: 0 }));
    assert.equal(flatMaturity.maturityMultiplier, 0.88);

    const wide = score(protocol({ tvl_usd: 1e7 }), AS_OF, false, params({ maturity_months: 12 }));
    assert.equal(wide.months, 12);
    assert.equal(wide.maturityMultiplier, 1.2);
  });
});

describe('score: launch odds', () => {
  it('is the logistic of the bias plus the TVL, growth, months and watchlist terms', () => {
    // -1.6 + 0.62 x log10(1e9/1e7) + 0.015 x 20 + 0.018 x 29.862 = -1.6 + 1.24 + 0.3 + 0.5375
    const s = score(protocol({ tvl_usd: 1e9, change_7d: 20, listed_at: '2023-07-07' }), AS_OF, false);
    assert.equal(s.months, 29.9);
    assert.equal(s.odds, 0.6172);
    assert.equal(s.implied, 5_291_933_771);
  });

  it('adds the watchlist term to the odds', () => {
    const p = protocol({ tvl_usd: 1e9, change_7d: 20, listed_at: '2023-07-07' });
    const plain = score(p, AS_OF, false);
    const watched = score(p, AS_OF, true);
    assert.equal(watched.odds, 0.6743);
    assert.ok(watched.odds > plain.odds);
    assert.equal(watched.implied, plain.implied);
    assert.ok(watched.weighted > plain.weighted);
  });

  it('is a logistic function of the standard score', () => {
    // Isolate the TVL term: bias 0 and no other weight leaves z = log10(tvl / 1e7).
    const isolated = params({ odds_bias: 0, odds_growth: 0, odds_months: 0, odds_watchlist: 0, odds_tvl: 1, odds_floor: 1e-6, odds_cap: 1 });
    const up = score(protocol({ tvl_usd: 1e8 }), AS_OF, false, isolated);
    const down = score(protocol({ tvl_usd: 1e6 }), AS_OF, false, isolated);
    const even = score(protocol({ tvl_usd: 1e7 }), AS_OF, false, isolated);

    assert.equal(even.odds, 0.5); // z = 0 -> 1 / (1 + e^0) = 0.5
    assert.equal(up.odds, Math.round((1 / (1 + Math.exp(-1))) * 1e4) / 1e4);
    assert.equal(down.odds, Math.round((1 / (1 + Math.exp(1))) * 1e4) / 1e4);
    assert.ok(Math.abs(up.odds + down.odds - 1) <= 2e-4); // symmetric around z = 0
  });

  it('rises with TVL, growth and time without a token', () => {
    const byTvl = [1e6, 1e7, 1e8, 1e9].map((tvl) => score(protocol({ tvl_usd: tvl }), AS_OF, false).odds);
    assert.deepEqual(byTvl, [...byTvl].sort((a, b) => a - b));
    assert.equal(new Set(byTvl).size, byTvl.length);

    const byGrowth = [-30, 0, 30, 90].map((g) => score(protocol({ change_7d: g }), AS_OF, false).odds);
    assert.deepEqual(byGrowth, [...byGrowth].sort((a, b) => a - b));
    assert.equal(new Set(byGrowth).size, byGrowth.length);

    // Ages stay under the 36-month ceiling that both the maturity factor and the odds term saturate at.
    const byAge = [AS_OF, '2025-07-01', '2025-01-01', '2024-01-01'].map((d) => score(protocol({ listed_at: d }), AS_OF, false).odds);
    assert.deepEqual(byAge, [...byAge].sort((a, b) => a - b));
    assert.equal(new Set(byAge).size, byAge.length);

    // Past 36 months without a token the age terms stop adding odds.
    const atCeiling = score(protocol({ listed_at: '2023-01-01' }), AS_OF, false).odds;
    const longPast = score(protocol({ listed_at: '2005-01-01' }), AS_OF, false).odds;
    assert.equal(longPast, atCeiling);
  });

  it('clamps to the 0.03 floor and the 0.9 cap', () => {
    const hopeless = score(protocol({ tvl_usd: 1, change_7d: -60, chains: [], listed_at: AS_OF }), AS_OF, false);
    assert.equal(hopeless.odds, 0.03);

    const certain = score(
      protocol({ tvl_usd: 1e13, change_7d: 400, chains: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], listed_at: '2005-01-01' }),
      AS_OF,
      true,
    );
    assert.equal(certain.odds, 0.9);
    assert.equal(certain.weighted, Math.round(certain.implied * 0.9));
  });

  it('stays inside the floor and cap for a sweep of inputs', () => {
    for (const tvl of [0, 1, 1e5, 1e7, 1e10, 1e14]) {
      for (const growth of [-100, -60, 0, 150, 900]) {
        for (const watched of [false, true]) {
          const odds = score(protocol({ tvl_usd: tvl, change_7d: growth }), AS_OF, watched).odds;
          assert.ok(odds >= 0.03 && odds <= 0.9, `odds ${odds} out of range for tvl ${tvl}, growth ${growth}`);
        }
      }
    }
  });

  it('computes the risk-weighted value as implied value times the odds', () => {
    const p = protocol({ tvl_usd: 3e8, change_7d: 12, listed_at: '2024-02-02' });
    const s = score(p, AS_OF, false);
    assert.ok(Math.abs(s.weighted - s.implied * s.odds) / s.weighted < 1e-3);
  });
});

describe('radarData', () => {
  function data(protocols: Protocol[], watchlist: string[] = []) {
    const snap = snapshot(protocols, watchlist);
    const rows = board(snap);
    return { rows, d: radarData(snap, rows) };
  }

  it('reports the true median implied value for boards of any size', () => {
    // Every protocol is Dexs, one chain, unknown age, no growth: implied scales with TVL at
    // 4.144 dollars per dollar of TVL, so these rows read 4.144M, 8.288M, 12.432M and 16.576M.
    assert.equal(data([]).d.aggregates.median_implied, 0);
    assert.equal(data([protocol({ slug: 'a', tvl_usd: 1e6 })]).d.aggregates.median_implied, 4_144_000);

    const three = data([
      protocol({ slug: 'a', tvl_usd: 1e6 }),
      protocol({ slug: 'b', tvl_usd: 2e6 }),
      protocol({ slug: 'c', tvl_usd: 3e6 }),
    ]);
    assert.equal(three.d.aggregates.median_implied, 8_288_000);

    const four = data([
      protocol({ slug: 'a', tvl_usd: 1e6 }),
      protocol({ slug: 'b', tvl_usd: 2e6 }),
      protocol({ slug: 'c', tvl_usd: 3e6 }),
      protocol({ slug: 'd', tvl_usd: 4e6 }),
    ]);
    assert.equal(four.d.aggregates.median_implied, 10_360_000); // (8.288M + 12.432M) / 2
  });

  it('reports the median launch odds, averaging the middle pair on an even board', () => {
    assert.equal(data([]).d.aggregates.median_odds, 0);

    const odd = data([
      protocol({ slug: 'a', tvl_usd: 1e6 }),
      protocol({ slug: 'b', tvl_usd: 1e8 }),
      protocol({ slug: 'c', tvl_usd: 1e10 }),
    ]);
    assert.equal(odd.d.aggregates.median_odds, odd.rows[1]!.launch_odds);

    const even = data([protocol({ slug: 'a', tvl_usd: 1e6 }), protocol({ slug: 'b', tvl_usd: 1e8 })]);
    const pair = (even.rows[0]!.launch_odds + even.rows[1]!.launch_odds) / 2;
    assert.equal(even.d.aggregates.median_odds, Math.round(pair * 1e4) / 1e4);
    assert.notEqual(even.d.aggregates.median_odds, even.rows[1]!.launch_odds);
  });

  it('counts the rows whose missing figures fell back to a default', () => {
    const { rows, d } = data([
      protocol({ slug: 'plain' }), // no listed_at: unknown age
      protocol({ slug: 'no-growth', change_7d: null, listed_at: AS_OF }), // null growth read as 0
      protocol({ slug: 'odd-category', category: 'Not A Real Category', listed_at: AS_OF }),
      protocol({ slug: 'null-category', category: null, listed_at: AS_OF }),
      protocol({ slug: 'service', category: 'Service', listed_at: AS_OF }), // known, and maps to 2.8
      protocol({ slug: 'has-token', mcap_usd: 1e9, change_7d: null }), // never on the board
    ]);
    assert.equal(rows.length, 5);
    assert.equal(d.counts.protocols, 6);
    assert.equal(d.counts.pre_token, 5);
    assert.equal(d.counts.unknown_growth, 1);
    assert.equal(d.counts.unknown_age, 1);
    // The odd and missing categories only: Service is a known key even though it is also 2.8.
    assert.equal(d.counts.default_sector, 2);

    const clean = data([protocol({ slug: 'clean', change_7d: 0, listed_at: AS_OF })]);
    assert.equal(clean.d.counts.unknown_growth, 0);
    assert.equal(clean.d.counts.unknown_age, 0);
    assert.equal(clean.d.counts.default_sector, 0);
  });
});

describe('board', () => {
  it('keeps only pre-token protocols that are not a product, a version or an exchange', () => {
    const rows = board(
      snapshot([
        protocol({ slug: 'plain' }),
        protocol({ slug: 'has-token', mcap_usd: 5e7 }),
        protocol({ slug: 'has-gecko', gecko_id: 'some-id' }),
        protocol({ slug: 'has-symbol', symbol: 'SOME' }),
        protocol({ slug: 'central-exchange', category: 'CEX' }),
        protocol({ slug: 'versioned', name: 'Pool V2' }),
        protocol({ slug: 'decimal-version', name: 'Pool 1.5' }),
        protocol({ slug: 'wrapped', name: 'Wrapped Ether' }),
        protocol({ slug: 'staked', name: 'Staked Assets' }),
        protocol({ slug: 'exchange-brand', name: 'Binance Earn' }),
        protocol({ slug: 'liquid-staking', category: 'Liquid Staking' }),
        protocol({ slug: 'bridge', category: 'Bridge' }),
        protocol({ slug: 'uncategorised', category: null }),
      ]),
    );
    assert.deepEqual(rows.map((r) => r.slug), ['plain', 'uncategorised']);
  });

  it('orders rows by implied value, best first, and ranks them 1..n', () => {
    const rows = board(
      snapshot([
        protocol({ slug: 'big', name: 'Big', tvl_usd: 1e8 }),
        protocol({ slug: 'small', name: 'Small', tvl_usd: 1e6 }),
        protocol({ slug: 'zeta', name: 'Zeta', tvl_usd: 5e6 }),
        protocol({ slug: 'alpha', name: 'Alpha', tvl_usd: 5e6 }),
      ]),
    );
    // The two 5M protocols tie on implied value, so the slug breaks the tie: alpha before zeta.
    assert.deepEqual(rows.map((r) => r.slug), ['big', 'alpha', 'zeta', 'small']);
    assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((r) => r.implied_value_usd), [414_400_000, 20_720_000, 20_720_000, 4_144_000]);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1]!.implied_value_usd >= rows[i]!.implied_value_usd);
    }
  });

  it('ranks the same way whatever order the snapshot lists its protocols in', () => {
    const protocols = [
      protocol({ slug: 'a', tvl_usd: 1e6 }),
      protocol({ slug: 'b', tvl_usd: 1e8 }),
      protocol({ slug: 'c', tvl_usd: 1e7 }),
      protocol({ slug: 'd', tvl_usd: 1e7 }),
    ];
    const forward = board(snapshot(protocols)).map((r) => r.slug);
    const reversed = board(snapshot([...protocols].reverse())).map((r) => r.slug);
    assert.deepEqual(forward, ['b', 'c', 'd', 'a']);
    assert.deepEqual(reversed, forward);
  });

  it('carries each row\u2019s figures straight from score', () => {
    const p = protocol({ slug: 'carried', name: 'Carried', tvl_usd: 2e8, change_7d: 15, chains: ['a', 'b'], listed_at: '2024-06-01' });
    const [row] = board(snapshot([p], ['carried']));
    const s = score(p, AS_OF, true);
    assert.ok(row);
    assert.equal(row.implied_value_usd, s.implied);
    assert.equal(row.launch_odds, s.odds);
    assert.equal(row.risk_weighted_usd, s.weighted);
    assert.equal(row.age_days, s.age);
    assert.deepEqual(row.model, {
      sector_multiple: s.multiplier,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMultiplier,
      maturity_multiplier: s.maturityMultiplier,
      breadth_multiplier: s.breadthMultiplier,
      months_without_token: s.months,
    });
    assert.equal(row.watchlist, true);
    assert.equal(row.token_status, 'pre-token');
    assert.equal(row.mcap_usd, null);
    assert.equal(row.gecko_id, null);
    assert.equal(row.symbol, null);
    assert.deepEqual(row.chains, ['a', 'b']);
  });

  it('marks only the watchlisted slugs', () => {
    const rows = board(
      snapshot([protocol({ slug: 'one' }), protocol({ slug: 'two' })], ['two']),
    );
    assert.deepEqual(rows.map((r) => [r.slug, r.watchlist]), [
      ['one', false],
      ['two', true],
    ]);
  });

  it('gives every row a five-step farm plan that names the protocol and its rank', () => {
    const rows = board(snapshot([protocol({ slug: 'plan', name: 'Planar', tvl_usd: 1e8 })]));
    const [row] = rows;
    assert.ok(row);
    assert.equal(row.farm_steps.length, 5);
    for (const step of row.farm_steps) {
      assert.ok(typeof step === 'string' && step.trim().length >= 20 && step.trim().length <= 600);
      assert.ok(step.includes('Cost'));
    }
    assert.ok(row.farm_steps[1]!.includes('Planar'));
    assert.ok(row.farm_steps[2]!.includes('Planar'));
    assert.ok(row.farm_steps[3]!.includes('rank 1'));
  });

  it('scores with the params it is given', () => {
    const p = protocol({ change_7d: 100 });
    const withGrowth = board(snapshot([p]));
    const withoutGrowth = board(snapshot([p]), params({ growth_weight: 0 }));
    assert.equal(withGrowth[0]!.model.growth_multiplier, 1.5);
    assert.equal(withoutGrowth[0]!.model.growth_multiplier, 1);
    assert.ok(withoutGrowth[0]!.implied_value_usd < withGrowth[0]!.implied_value_usd);
  });

  it('returns nothing when no protocol is pre-token', () => {
    assert.deepEqual(board(snapshot([])), []);
    assert.deepEqual(board(snapshot([protocol({ mcap_usd: 1e9 })])), []);
  });
});
