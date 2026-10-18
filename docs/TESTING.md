# Testing

| Command | What it covers |
|---|---|
| `pnpm test` / `pnpm verify` | Version sync, then syntax, smoke and regression checks |
| `pnpm run test:syntax` | Parses every JavaScript file |
| `pnpm run test:smoke` | Template and sample structure, identity and referral-number generation, facility/network/care package/payment selection, archive naming, gzip streaming, settings, credential import, upload sequencing, LEIE duplicate handling, release packaging rules |
| `pnpm run test:regression` | 1,200 generated referrals across three files with selected reference subsets, master/gzip equality, repeated runs, retention modes, sequential upload recovery and rollback |

All fixtures are synthetic. Generated SSNs start with `999`; tests assert this.
