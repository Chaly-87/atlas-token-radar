// The board's ordering, kept apart from the page so node:test checks the comparator the table
// actually uses. A classic script: it defines window.RADAR_SORT in the page and exports itself under
// Node. compare() is ascending by the key's own magnitude; the page multiplies by -1 to descend.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.RADAR_SORT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var KEYS = ['implied', 'odds', 'weighted', 'tvl', 'growth', 'age'];

  // A missing figure is read as the smallest value of its column, so it sinks to the bottom when
  // the table is descending.
  var NULL_GROWTH = -999;
  var NULL_AGE = -1;

  /** The number a key reads from a row; an unknown key reads the implied value. */
  function value(row, key) {
    if (key === 'odds') return row.launch_odds;
    if (key === 'weighted') return row.risk_weighted_usd;
    if (key === 'tvl') return row.tvl_usd;
    if (key === 'growth') return row.change_7d === null || row.change_7d === undefined ? NULL_GROWTH : row.change_7d;
    if (key === 'age') return row.age_days === null || row.age_days === undefined ? NULL_AGE : row.age_days;
    return row.implied_value_usd;
  }

  function isKey(key) {
    return KEYS.indexOf(key) !== -1;
  }

  function slugOf(row) {
    return row && row.slug !== undefined && row.slug !== null ? String(row.slug) : '';
  }

  /**
   * Ascending on `key`, ties broken by slug ascending. A key the table does not know falls back to
   * the implied value, so a hand-edited URL still orders the board. The result is a total order:
   * two rows with the same figure never depend on the sort being stable.
   */
  function compare(a, b, key) {
    var k = isKey(key) ? key : 'implied';
    var diff = value(a, k) - value(b, k);
    if (diff !== 0 && isFinite(diff)) return diff;
    var sa = slugOf(a);
    var sb = slugOf(b);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return 0;
  }

  return { KEYS: KEYS, isKey: isKey, value: value, compare: compare };
});
