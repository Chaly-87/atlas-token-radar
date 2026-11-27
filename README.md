# ATLAS — Pre-Token Value Radar

[![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Chaly-87/atlas-token-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Chaly-87/atlas-token-radar/reward.svg)](https://make.fun/c/token-radar-01)

**ATLAS** is an entry for make.fun's [token-radar-01 competition](https://make.fun/c/token-radar-01).

It analyzes a sealed DeFiLlama snapshot of 758 protocols, identifies protocols without a recorded token, and ranks pre-token projects using an estimated implied-value model. Each ranked protocol includes a practical activity plan.

## What it does

- Reads the supplied snapshot without requiring external API calls.
- Evaluates protocols against the competition's 40-project watchlist.
- Scores 198 pre-token protocols in the generated board.
- Estimates implied value and launch odds using transparent model factors.
- Generates five activity-plan steps for each ranked protocol.
- Produces a static dashboard, screenshots, and a competition dossier.

The estimates are analytical outputs, not guarantees of token launches, airdrops, eligibility, or financial returns.

## Run it

Requirements: Node.js 22.18 or later and the official `token-radar-01` competition kit.

Set `MAKEFUN_KIT_DIR` to the directory where the official kit has been extracted:

```sh
export MAKEFUN_KIT_DIR=/path/to/token-radar-01-kit
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input "$MAKEFUN_KIT_DIR/input/snapshot.json"
```

The program generates:

- `out/board.json`
- `out/data.js`
- `out/dashboard/`
- `out/screenshots/`
- `out/dossier.json`

## Tests

Run the test suite from the repository root:

```sh
node --test
```

## The model

The implied-value estimate combines:

- Total value locked (TVL)
- Sector multiple
- Growth factor
- Maturity factor
- Protocol breadth factor

Launch odds are estimated using a logistic model incorporating TVL, growth, project age, and watchlist status.

The model records its assumptions in the generated output. Unknown inputs use documented defaults rather than being presented as verified facts.

## Validation

The generated board is checked for:

- Coverage of the 40-project watchlist
- Contiguous ranking from 1 to the final row
- Non-increasing implied values
- Valid integer values within the configured cap
- Between 3 and 12 activity-plan steps per protocol
- Activity-plan step lengths within the configured limits
- A non-empty ranked board

The dossier is generated using the competition's vendored `makefun-board` library.

## Reproducibility

The build is deterministic: repeated runs against the same snapshot produce identical output files.

## Ownership and submission status

The repository includes `.makefun/owner.json` to associate the entry with its entrant wallet.

No private wallet key or API key is included in this repository.

The repository is publicly available, but publication on GitHub does not itself constitute an official competition submission. Submission status must be confirmed through make.fun.

## Important limitations

- Implied values and launch odds are model estimates, not market prices or predictions.
- Activity plans are research suggestions, not guaranteed airdrop strategies.
- No deposits, transactions, wallet signatures, or external protocol interactions are performed by this tool.
- Users should independently verify project information and risks before taking any action.

## License

MIT. See [LICENSE](LICENSE).
