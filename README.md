# ATLAS — pre-token value radar

An entry for make.fun's **token-radar-01** bounty: it reads the sealed DefiLlama snapshot of 758
protocols, works out which ones still record no token, and ranks them by what a token would be
worth if the protocol's record stayed as it is — with the steps to farm each one.

Built from scratch for this bounty. All the code, the model, the wording and the page are new;
the only third-party file is `vendor/makefun-board.ts`, the dossier writer the bounty's scorer
requires the entry to use, shipped byte for byte in the official kit.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Node 22.18 or later runs the TypeScript as it is. The program writes `out/board.json`,
`out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Two runs write the
same bytes.

## The model

```
implied value = TVL × sector multiple × growth factor × maturity factor × breadth factor
launch odds   = logistic(bias + tvl term + growth term + months term + watchlist term)
```

| Input (from the snapshot only) | What it does |
| --- | --- |
| `tvl_usd` | the base: what the protocol already custodies |
| `category` | the multiple the market pays per dollar of TVL in that sector (one table, 30 sectors, no name special-cased) |
| `change_7d` | the growth factor, clamped to −60…+150% and weighted at 0.5 |
| `listed_at` | the maturity factor, from 0.88 at launch to 1.20 after 36 months without a token |
| `chains` | the breadth factor, +2.5% per extra chain, capped at five |

Launch odds come from the same figures, so a large protocol that may never launch and a smaller
one already positioning for a launch are both visible. Rows carry both the implied value (which
is what the board ranks by) and a risk-weighted value (implied × odds).

Farm plans are generated per protocol from its own record — category, chains, TVL and age — into
five steps that each state a cost and a time. No list of names is written by hand anywhere.

## The page

`dashboard/` is a static page with no framework and no network: `index.html`, `app.css` and
`app.js` read `data.js`, written beside the dashboard by `main.ts`. It has a sortable board, a
search, a category filter, a chain filter and a watchlist toggle; a detail panel recomputes each
row's implied value from the same multipliers the board carries and shows the farm plan. The view
is addressable: `?slug=…`, `?cat=…`, `?chain=…`, `?sort=implied|odds|weighted|tvl|growth|age`,
`?watch=1`, `?q=…`.

## The gate

`main.ts` refuses to write a board the gate would reject: it checks coverage of the 40-slug
watchlist, ranks 1..n, non-increasing implied values, integer values inside the cap, 3–12 farm
steps of 20–600 characters, and a board that actually ranks something. The dossier is written last,
by the vendored library, so the scorer's rebuild matches byte for byte.

## What is not here

No wallet, no API key, no submission, no signed message. This repository is a prepared entry: it
has not been entered in the competition.
