// Tests for dashboard/sort.js: the comparator the board orders by. Mirror of the page export, so
// these assertions describe the order a reader actually sees.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sortModule from '../dashboard/sort.js';

const KEYS = sortModule.KEYS as string[];
const compare = sortModule.compare as (a: Row, b: Row, key: string) => number;
const isKey = sortModule.isKey as (key: string) => boolean;

interface Row {
  slug: string;
  implied_value_usd: number;
  launch_odds: number;
  risk_weighted_usd: number;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    slug: 'row',
    implied_value_usd: 10,
    launch_odds: 0.5,
    risk_weighted_usd: 1,
    tvl_usd: 100,
    change_7d: 0,
    age_days: 100,
    ...overrides,
  };
}

/** The three rows every key is checked against: no column orders them the same way. */
const sample: Row[] = [
  row({ slug: 'a', implied_value_usd: 10, launch_odds: 0.9, risk_weighted_usd: 5, tvl_usd: 100, change_7d: -5, age_days: 900 }),
  row({ slug: 'b', implied_value_usd: 30, launch_odds: 0.1, risk_weighted_usd: 1, tvl_usd: 300, change_7d: 40, age_days: 10 }),
  row({ slug: 'c', implied_value_usd: 20, launch_odds: 0.5, risk_weighted_usd: 9, tvl_usd: 200, change_7d: 0, age_days: 500 }),
];

function sorted(key: string, rows: Row[]): string[] {
  return rows
    .slice()
    .sort((a, b) => compare(a, b, key))
    .map((r) => r.slug);
}

describe('sort keys', () => {
  it('exports exactly the six columns the board can order by', () => {
    assert.deepEqual(KEYS, ['implied', 'odds', 'weighted', 'tvl', 'growth', 'age']);
  });

  it('knows those six keys and nothing from the object prototype', () => {
    for (const key of KEYS) assert.equal(isKey(key), true, key);
    for (const key of ['bogus', 'constructor', 'toString', 'hasOwnProperty', '']) assert.equal(isKey(key), false, key);
  });
});

describe('compare', () => {
  it('orders by the magnitude of each key, not by some other column', () => {
    const expected: Array<[string, string[]]> = [
      ['implied', ['a', 'c', 'b']], // 10, 20, 30
      ['odds', ['b', 'c', 'a']], // 0.1, 0.5, 0.9
      ['weighted', ['b', 'a', 'c']], // 1, 5, 9
      ['tvl', ['a', 'c', 'b']], // 100, 200, 300
      ['growth', ['a', 'c', 'b']], // -5, 0, 40
      ['age', ['b', 'c', 'a']], // 10, 500, 900
    ];
    for (const [key, order] of expected) assert.deepEqual(sorted(key, sample), order, key);
  });

  it('breaks a tie by slug, whatever order the rows arrive in', () => {
    const tie = [
      row({ slug: 'zeta', implied_value_usd: 50 }),
      row({ slug: 'alpha', implied_value_usd: 50 }),
      row({ slug: 'mike', implied_value_usd: 50 }),
    ];
    assert.deepEqual(sorted('implied', tie), ['alpha', 'mike', 'zeta']);
    assert.deepEqual(sorted('implied', [...tie].reverse()), ['alpha', 'mike', 'zeta']);
    assert.ok(compare(tie[1]!, tie[0]!, 'implied') < 0);
    assert.ok(compare(tie[0]!, tie[1]!, 'implied') > 0);
  });

  it('breaks a tie by slug on every key, not just the implied value', () => {
    for (const key of KEYS) {
      const pair = [row({ slug: 'two' }), row({ slug: 'one' })];
      assert.deepEqual(sorted(key, pair), ['one', 'two'], key);
    }
  });

  it('falls back to the implied value for a key it does not know', () => {
    assert.deepEqual(sorted('not-a-key', sample), sorted('implied', sample));
    assert.deepEqual(sorted('', sample), ['a', 'c', 'b']);
    for (const pair of [
      [sample[0]!, sample[1]!],
      [sample[1]!, sample[2]!],
    ]) {
      assert.equal(compare(pair[0], pair[1], 'not-a-key'), compare(pair[0], pair[1], 'implied'));
    }
  });

  it('reads a missing growth or age as the smallest value in its column', () => {
    const growth = [row({ slug: 'known', change_7d: 0 }), row({ slug: 'unknown', change_7d: null })];
    assert.deepEqual(sorted('growth', growth), ['unknown', 'known']);

    const age = [row({ slug: 'known', age_days: 0 }), row({ slug: 'unknown', age_days: null })];
    assert.deepEqual(sorted('age', age), ['unknown', 'known']);
  });

  it('is a total order, so equal rows never hang on the sort being stable', () => {
    const left = row({ slug: 'same' });
    const right = row({ slug: 'same' });
    for (const key of KEYS) assert.equal(compare(left, right, key), 0, key);
    assert.ok(compare(row({ slug: 'a' }), row({ slug: 'b' }), 'odds') !== 0);
  });

  it('reverses cleanly when the page multiplies by -1 to descend', () => {
    for (const key of KEYS) {
      for (const a of sample) {
        for (const b of sample) {
          const forward = compare(a, b, key);
          // -0 and 0 are the same order; assert.equal here is strict, so normalise the sign.
          assert.equal(compare(b, a, key), forward === 0 ? 0 : -forward, `${key}: ${a.slug} vs ${b.slug}`);
        }
      }
    }
  });
});
