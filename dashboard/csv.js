// The filtered board as CSV, kept apart from the page so the text the button downloads is built by
// the same function node:test checks. A classic script: it defines window.RADAR_CSV in the page and
// exports itself under Node. Nothing here knows about the DOM, so it is pure data in, text out.
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.RADAR_CSV = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Raw figures, not the page's rounded dollars: an analyst re-does the arithmetic on these.
  var COLUMNS = [
    'slug',
    'name',
    'category',
    'chains',
    'tvl_usd',
    'implied_value_usd',
    'launch_odds',
    'risk_weighted_usd',
    'age_days'
  ];

  /** One field: quoted only when it has to be, with its own quotes doubled. */
  function cell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  /** The whole view, header first, one CRLF-terminated line per row in the order given. */
  function toCsv(rows) {
    var lines = [COLUMNS.join(',')];
    (rows || []).forEach(function (r) {
      lines.push(
        [
          r.slug,
          r.name,
          r.category || 'Uncategorised',
          (r.chains || []).join('; '),
          r.tvl_usd,
          r.implied_value_usd,
          r.launch_odds,
          r.risk_weighted_usd,
          r.age_days === null || r.age_days === undefined ? '' : r.age_days
        ]
          .map(cell)
          .join(',')
      );
    });
    return lines.join('\r\n') + '\r\n';
  }

  return { COLUMNS: COLUMNS, cell: cell, toCsv: toCsv };
});
