// Tests for dashboard/csv.js: the exact text the Export CSV button hands the browser, so a
// spreadsheet and the page agree field for field. The module is a classic script in the page and a
// CommonJS module under Node, which is why it is imported as a default here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import csv from '../dashboard/csv.js';

const cell = csv.cell as (value: unknown) => string;
const toCsv = csv.toCsv as (rows: Array<Record<string, unknown>>) => string;

const HEADER = 'slug,name,category,chains,tvl_usd,implied_value_usd,launch_odds,risk_weighted_usd,age_days';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: 'aave',
    name: 'Aave',
    category: 'Lending',
    chains: ['Ethereum', 'Polygon'],
    tvl_usd: 12_000_000_000,
    implied_value_usd: 40_800_000_000,
    launch_odds: 0.62,
    risk_weighted_usd: 25_296_000_000,
    age_days: 412,
    ...overrides,
  };
}

describe('csv cell', () => {
  it('leaves plain text and numbers alone', () => {
    assert.equal(cell('Ethereum'), 'Ethereum');
    assert.equal(cell(0.62), '0.62');
    assert.equal(cell(0), '0');
  });

  it('quotes a comma, a quote or a line break, and doubles the quotes inside', () => {
    assert.equal(cell('a,b'), '"a,b"');
    assert.equal(cell('say "hi"'), '"say ""hi"""');
    assert.equal(cell('line\nbreak'), '"line\nbreak"');
    assert.equal(cell('carriage\rreturn'), '"carriage\rreturn"');
  });

  it('writes nothing at all for null and undefined', () => {
    assert.equal(cell(null), '');
    assert.equal(cell(undefined), '');
  });
});

describe('toCsv', () => {
  it('writes the header alone, terminated, for an empty view', () => {
    assert.equal(toCsv([]), `${HEADER}\r\n`);
  });

  it('writes one CRLF line per row, keeping the order it was given', () => {
    const lines = toCsv([row({ slug: 'b' }), row({ slug: 'a' })]).split('\r\n');
    assert.equal(lines.length, 4); // header, two rows, trailing empty
    assert.equal(lines[0], HEADER);
    assert.ok(lines[1]!.startsWith('b,'));
    assert.ok(lines[2]!.startsWith('a,'));
    assert.equal(lines[3], '');
  });

  it('writes the nine fields in header order, raw numbers and an empty age when unknown', () => {
    const line = toCsv([row({ category: null, age_days: null, chains: ['Ethereum'] })]).split('\r\n')[1]!;
    assert.equal(line, 'aave,Aave,Uncategorised,Ethereum,12000000000,40800000000,0.62,25296000000,');
  });

  it('joins several chains into one field with a semicolon', () => {
    const line = toCsv([row()]).split('\r\n')[1]!;
    assert.ok(line.includes('Ethereum; Polygon'));
    assert.equal(line.split(',').length, 9);
  });

  it('escapes a name with commas and quotes without breaking the column count', () => {
    const line = toCsv([row({ name: 'Pool, "Prime"' })]).split('\r\n')[1]!;
    assert.ok(line.startsWith('aave,"Pool, ""Prime""",Lending,'));
    assert.equal(line.match(/"/g)?.length, 6);
  });

  it('carries the whole view, so a filtered export is exactly the rows passed in', () => {
    const text = toCsv([row({ slug: 'one' }), row({ slug: 'two' }), row({ slug: 'three' })]);
    assert.equal(text.trimEnd().split('\r\n').length, 4);
    assert.deepEqual(
      text
        .trimEnd()
        .split('\r\n')
        .slice(1)
        .map((line) => line.split(',')[0]),
      ['one', 'two', 'three'],
    );
  });
});
