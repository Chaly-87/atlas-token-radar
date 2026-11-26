// ATLAS dashboard. Every byte it shows is in data.js, written beside dashboard/ by main.ts:
// no fetch, no framework and no network. The page recomputes a row's implied value from the
// same multipliers the board carries, so the code and the numbers on screen are one arithmetic.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;

  var $ = function (id) { return document.getElementById(id); };
  var state = { q: '', cat: 'all', chain: 'all', sort: 'implied', watch: false, slug: null };

  var MODELS = D.model_id + ' · ' + D.counts.pre_token + ' pre-token protocols scored';

  function num(n) { return new Intl.NumberFormat('en-US').format(Math.round(n)); }

  function usd(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
    return '$' + (digits ? n.toFixed(digits) : num(n));
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function months(ageDays, listed) {
    if (ageDays === null || ageDays === undefined) return 'unknown';
    if (ageDays >= 730) return (ageDays / 365).toFixed(1) + ' y';
    if (ageDays >= 60) return Math.round(ageDays / 30.44) + ' mo';
    return Math.max(0, Math.round(ageDays)) + ' d';
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  // ---- header and KPI strip -------------------------------------------------

  function chips() {
    var box = $('meta');
    box.textContent = '';
    [
      ['Snapshot', D.as_of],
      ['Model', D.model_id],
      ['Protocols', num(D.counts.protocols)],
      ['Watchlist floor', num(D.counts.watchlist)],
      ['Board rows', num(D.counts.board)]
    ].forEach(function (pair) {
      var c = el('span', 'chip');
      c.appendChild(document.createTextNode(pair[0] + ' '));
      var b = el('b', null, pair[1]);
      c.appendChild(b);
      box.appendChild(c);
    });
  }

  function kpis() {
    var box = $('kpis');
    box.textContent = '';
    var cards = [
      ['Median implied value', usd(D.aggregates.median_implied), 'half the board is above this'],
      ['Top 10 share of value', Math.round(D.aggregates.top10_share * 100) + '%', 'how concentrated the board is'],
      ['Median launch odds', Math.round(D.aggregates.median_odds * 100) + '%', 'the model\'s own probability'],
      ['TVL under the radar', usd(D.aggregates.tvl_sum), 'value already locked in pre-token protocols'],
      ['Highest implied value', usd(D.rows[0].implied_value_usd), D.rows[0].name + ' · ' + months(D.rows[0].age_days)]
    ];
    if (D.counts.board > 400) cards[3] = ['TVL under the radar', usd(D.aggregates.tvl_sum), 'summed over every row'];
    cards.forEach(function (c) {
      var k = el('div', 'kpi');
      k.appendChild(el('div', 'k', c[0]));
      k.appendChild(el('div', 'v', c[1]));
      k.appendChild(el('div', 's', c[2] || ''));
      box.appendChild(k);
    });
  }

  // ---- data quality ---------------------------------------------------------
  //
  // Three figures the board cannot show on its own: rows whose seven-day change was missing, rows
  // whose listing date was missing, and rows the sector table did not cover. Each is a place where
  // the model stood in a default, so a reader can see how much of the board rests on one. The board
  // totals come from window.RADAR.counts; the count for the rows on screen is read from the same
  // rows the board has just filtered, so the strip follows every search, category, chain and toggle.

  function defaultSector(r) {
    var table = D.sector || {};
    return !r.category || !Object.prototype.hasOwnProperty.call(table, r.category);
  }

  function quality(rows) {
    var box = $('quality');
    box.textContent = '';
    var onBoard = D.counts.board;
    var inView = rows.length;
    var narrowed = inView !== onBoard;
    var specs = [
      {
        key: 'unknown_growth',
        label: 'Growth unknown',
        legend: 'No seven-day change in the snapshot, so the model read it as 0%.',
        test: function (r) { return r.change_7d === null; }
      },
      {
        key: 'unknown_age',
        label: 'Age unknown',
        legend: 'No listing date in the snapshot, so the model assumed 12 months without a token.',
        test: function (r) { return r.age_days === null; }
      },
      {
        key: 'default_sector',
        label: 'Default sector',
        legend: 'Category outside the sector table, so the model used the 2.8x default multiple.',
        test: defaultSector
      }
    ];

    specs.forEach(function (s) {
      var total = D.counts[s.key];
      if (typeof total !== 'number') return;
      var seen = rows.filter(s.test).length;
      var where = narrowed
        ? 'of ' + num(inView) + ' rows in view · ' + num(total) + ' of ' + num(onBoard) + ' on the board'
        : 'of ' + num(onBoard) + ' board rows';
      var card = el('div', 'qcard' + (seen > 0 ? ' flag' : ''));
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', s.label + ': ' + num(seen) + ' ' + where.replace(' · ', ', ') + '. ' + s.legend);
      card.appendChild(el('div', 'k', s.label));
      card.appendChild(el('div', 'v', num(seen)));
      card.appendChild(el('div', 's', s.legend));
      card.appendChild(el('div', 'src', where));
      box.appendChild(card);
    });

    // The five chains whose rows lean on defaults hardest: its own bucket, straight from the
    // model's quality report. The share counts each default separately, so a row missing all three
    // weighs three times.
    var chainBuckets = (D.quality && D.quality.chains) || {};
    var worst = Object.keys(chainBuckets)
      .map(function (name) {
        var b = chainBuckets[name];
        var missing = b.unknown_growth + b.unknown_age + b.default_sector;
        return { name: name, rows: b.rows, missing: missing, share: b.rows > 0 ? missing / b.rows : 0 };
      })
      .filter(function (c) { return c.missing > 0; })
      .sort(function (a, b) { return b.share - a.share || b.missing - a.missing || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); })
      .slice(0, 5);

    var panel = el('div', 'qchains');
    panel.appendChild(el('h3', null, 'Weakest chain coverage'));
    panel.appendChild(el('p', 'qnote', 'Defaults per row counts each missing figure separately; a protocol on several chains counts in each of them.'));
    if (worst.length === 0) {
      panel.appendChild(el('p', 'qnote', 'Every chain carries all three figures for every row.'));
    } else {
      var list = el('ol', 'qlist');
      list.setAttribute('aria-label', 'The five chains with the most default figures per row');
      worst.forEach(function (c) {
        var li = el('li');
        li.appendChild(el('span', 'qname', c.name));
        li.appendChild(el('span', 'qper', c.share.toFixed(2) + ' per row'));
        li.appendChild(el('span', 'qrows', num(c.rows) + (c.rows === 1 ? ' row' : ' rows')));
        li.setAttribute('aria-label', c.name + ': ' + c.share.toFixed(2) + ' default figures per row across ' + num(c.rows) + ' rows');
        list.appendChild(li);
      });
      panel.appendChild(list);
    }
    box.appendChild(panel);

    if (!box.children.length) box.appendChild(el('p', 'qempty', 'This snapshot carries no data-quality counts.'));
  }

  // ---- filters --------------------------------------------------------------

  function fillSelect(id, values, allLabel) {
    var s = $(id);
    s.textContent = '';
    var all = el('option', null, allLabel);
    all.value = 'all';
    s.appendChild(all);
    values.forEach(function (v) {
      var o = el('option', null, v);
      o.value = v;
      s.appendChild(o);
    });
  }

  function matches(r) {
    if (state.watch && !r.watchlist) return false;
    if (state.cat !== 'all' && (r.category || 'Uncategorised') !== state.cat) return false;
    if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
    if (state.q) {
      var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ') + ' ' + r.slug).toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function sortRows(rows) {
    var copy = rows.slice();
    var key = state.sort;
    copy.sort(function (a, b) {
      if (key === 'implied') return b.implied_value_usd - a.implied_value_usd;
      if (key === 'odds') return b.launch_odds - a.launch_odds || b.implied_value_usd - a.implied_value_usd;
      if (key === 'weighted') return b.risk_weighted_usd - a.risk_weighted_usd;
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d === null ? -999 : b.change_7d) - (a.change_7d === null ? -999 : a.change_7d);
      return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days);
    });
    return copy;
  }

  // ---- table ----------------------------------------------------------------

  var maxValue = D.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);

  function board() {
    var rows = sortRows(D.rows.filter(matches));
    var body = $('rows');
    body.textContent = '';
    var frag = document.createDocumentFragment();

    rows.forEach(function (r) {
      var tr = el('tr');
      var on = state.slug === r.slug;
      if (on) tr.className = 'on';
      tr.setAttribute('data-slug', r.slug);
      // Reachable with Tab, opened with Enter or Space: the board is the page's main control.
      tr.setAttribute('tabindex', '0');
      if (on) tr.setAttribute('aria-current', 'true');

      var tdRank = el('td', 'r');
      tdRank.appendChild(el('span', 'rank', String(r.rank)));
      tr.appendChild(tdRank);

      var tdName = el('td');
      var name = el('div', 'pname', r.name);
      if (r.watchlist) name.appendChild(el('span', 'pill', 'watchlist'));
      tdName.appendChild(name);
      tdName.appendChild(el('div', 'pcat', r.category || 'Uncategorised'));
      tr.appendChild(tdName);

      tr.appendChild(el('td', 'chains', r.chains.slice(0, 3).join(' · ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')));

      tr.appendChild(el('td', 'n num', usd(r.tvl_usd)));
      var g = el('td', 'n num ' + (r.change_7d === null ? 'flat' : r.change_7d >= 0 ? 'good' : 'bad'), pct(r.change_7d));
      tr.appendChild(g);
      tr.appendChild(el('td', 'n num', months(r.age_days)));

      var tdVal = el('td', 'n');
      tdVal.appendChild(el('div', 'value', usd(r.implied_value_usd)));
      var bar = el('div', 'bar');
      var fill = el('i');
      fill.style.width = Math.max(2, Math.round((r.implied_value_usd / maxValue) * 100)) + '%';
      bar.appendChild(fill);
      tdVal.appendChild(bar);
      tr.appendChild(tdVal);

      tr.appendChild(el('td', 'n odds', Math.round(r.launch_odds * 100) + '%'));
      frag.appendChild(tr);
    });

    body.appendChild(frag);
    $('count').textContent = rows.length + ' of ' + D.counts.board + ' rows';
    quality(rows);

    if (!state.slug && rows.length > 0) state.slug = rows[0].slug;
    detail(D.rows.filter(function (r) { return r.slug === state.slug; })[0] || rows[0]);
    writeUrl();
  }

  /** Selects a row; the board re-renders, so the focus is put back on the row that was opened. */
  function select(slug) {
    state.slug = slug;
    board();
    var body = $('rows');
    for (var i = 0; i < body.children.length; i += 1) {
      if (body.children[i].getAttribute('data-slug') === slug) {
        body.children[i].focus();
        return;
      }
    }
  }

  // ---- detail ---------------------------------------------------------------

  function detail(r) {
    var box = $('detail');
    box.textContent = '';
    if (!r) {
      box.appendChild(el('p', 'empty', 'No protocol matches these filters.'));
      return;
    }
    var head = el('div');
    head.appendChild(el('h2', null, r.name));
    head.appendChild(el('div', 'sub', (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + (r.watchlist ? ' · on the watchlist floor' : ' · below the floor, found by the radar')));
    box.appendChild(head);

    var big = el('div', 'big');
    big.appendChild(el('small', null, 'implied value if a token launches'));
    big.appendChild(document.createTextNode(usd(r.implied_value_usd)));
    box.appendChild(big);

    var m = r.model;
    var math = el('div', 'math');
    function line(label, value, cls) {
      var d = el('div', cls || null);
      d.appendChild(el('span', null, label));
      d.appendChild(el('b', null, value));
      math.appendChild(d);
    }
    line('TVL today', usd(r.tvl_usd));
    line('Sector multiple (' + (r.category || 'default') + ')', '×' + m.sector_multiple.toFixed(2));
    line('Seven-day growth ' + pct(m.growth_pct), '×' + m.growth_multiplier.toFixed(3));
    line('Time without a token: ' + months(r.age_days), '×' + m.maturity_multiplier.toFixed(3));
    line('Chains covered (' + r.chains.length + ')', '×' + m.breadth_multiplier.toFixed(3));
    line('Implied value', usd(r.implied_value_usd), 'total');
    line('Launch odds', Math.round(r.launch_odds * 100) + '%');
    line('Risk-weighted value', usd(r.risk_weighted_usd));
    box.appendChild(math);

    var ul = el('ul', 'plan');
    r.farm_steps.forEach(function (step, i) {
      var li = el('li', null, step);
      li.setAttribute('data-n', String(i + 1));
      ul.appendChild(li);
    });
    box.appendChild(ul);

    box.appendChild(el('p', 'note', 'Rank ' + r.rank + ' of ' + D.counts.board + '. The implied value is the board\'s claim from the snapshot\'s own figures, not a forecast that a token appears; the odds column is the model\'s separate guess at that.'));
  }

  // ---- state in the URL, so a view can be linked and screenshotted ----------

  function readUrl() {
    // The hash is the canonical copy; ?query remains readable so older links still resolve.
    var p = new URLSearchParams(location.hash.slice(1) || location.search);
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || 'all';
    state.chain = p.get('chain') || 'all';
    state.sort = p.get('sort') || 'implied';
    state.watch = p.get('watch') === '1';
    state.slug = p.get('slug') || null;
    $('q').value = state.q;
    $('cat').value = state.cat;
    $('chain').value = state.chain;
    $('sort').value = state.sort;
    $('watch').checked = state.watch;
  }

  /** Mirror the state into the hash, so a filtered view survives a reload and can be linked. */
  function writeUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.watch) p.set('watch', '1');
    if (state.slug) p.set('slug', state.slug);
    var qs = p.toString();
    if (location.hash.slice(1) === qs) return;
    try {
      history.replaceState(null, '', location.pathname + location.search + (qs ? '#' + qs : ''));
    } catch (e) {
      // file:// and sandboxed frames refuse history writes; the filters still work in memory.
    }
  }

  function wire() {
    $('q').addEventListener('input', function (e) { state.q = e.target.value; board(); });
    $('cat').addEventListener('change', function (e) { state.cat = e.target.value; board(); });
    $('chain').addEventListener('change', function (e) { state.chain = e.target.value; board(); });
    $('sort').addEventListener('change', function (e) { state.sort = e.target.value; board(); });
    $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; board(); });
    $('rows').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr') : null;
      if (!tr) return;
      select(tr.getAttribute('data-slug'));
    });
    $('rows').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var tr = e.target.closest ? e.target.closest('tr') : null;
      if (!tr) return;
      e.preventDefault();
      select(tr.getAttribute('data-slug'));
    });
    // Back, forward and a hand-edited hash all come back through here.
    window.addEventListener('hashchange', function () {
      readUrl();
      board();
    });
  }

  chips();
  kpis();
  fillSelect('cat', D.categories, 'Every category');
  fillSelect('chain', D.chains, 'Every chain');
  readUrl();
  wire();
  $('snapdate').textContent = D.as_of;
  board();
})();
