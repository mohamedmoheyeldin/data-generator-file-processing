# Data Generator & File Processing

A Windows desktop application (Electron + Node.js) for generating realistic healthcare referral and claim test data where production data cannot be used, and for repeatedly processing, packaging and delivering data files.

> **All data in this repository is synthetic.** Names, identifiers, facilities, providers, payers, care packages and codes are fictional placeholders. Generated SSNs always start with `999`, provider numbers start with `0`, phone numbers use `555-0xx`, and email addresses use `example.com`.

## What it does

- **Generate synthetic referral data.** Builds JSON referral batches from one neutral template (`templates/referral-template.json`) with randomized synthetic values grouped as patient, referral, provider, facility, coverage and appointments. Referral numbers and patient IDs are unique; dates can be current or custom; facility, network, care package and payment authority code values stay within the selected reference lists.
- **Process existing referral files.** Rewrites identities, dates and reference values in a folder of referral JSON files without changing the source files.
- **Batch file handling.** Rename outputs, combine them into a formatted master JSON, gzip the batch, and optionally export a manifest with SHA-256 checksums.
- **Validation.** Schema preflight before processing and output validation against the selected reference values.
- **LEIE workflow.** Detect and remove duplicate rows in a public HHS-OIG LEIE (List of Excluded Individuals/Entities) Excel export, and build example validation SQL for your own database.
- **SFTP upload.** Optional sequential upload of results to saved environment profiles, with remote size verification and per-target status.

## Requirements

- Node.js 24 and pnpm (version pinned in `package.json`; `corepack enable` provides it)
- Windows for the desktop UI, the end-to-end UI test and the Setup installer. The syntax, smoke and regression checks run on any OS.

## Install and run

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start            # launch the desktop app
```

## Test

```bash
pnpm test             # syntax check, smoke tests, workflow regression test
pnpm run test:e2e     # real Electron UI test (Windows, needs a display)
```

Individual checks: `pnpm run test:syntax`, `pnpm run test:smoke`, `pnpm run test:regression`.

## Build the installer

```bash
pnpm run dist         # Windows NSIS Setup installer
```

## Configuration

| File | Purpose |
|---|---|
| `config/facilities.json` | Fictional facility catalog (refresh with `pnpm data:facilities -- <file.xlsx>`) |
| `config/care_package_options.json` | Synthetic care package catalog (`pnpm data:care-packages -- <file.xlsx>`) |
| `config/situational_care_package_options.json` | Synthetic manual-only care packages |
| `config/payment_authority_codes.json` | Synthetic payment authority codes |
| `config/upload_profiles.json` | Example SFTP profiles (`*.example.com`, no credentials) |
| `templates/referral-template.json` | Neutral referral record template used by the generator |
| `templates/samples/sample-referrals.json` | Three synthetic sample records in the output format |

Upload credentials are imported at runtime through the app and stored per user with OS-provided encryption. Never commit credentials.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Development](docs/DEVELOPMENT.md)
- [Testing](docs/TESTING.md)
- [LEIE upload and validation](docs/LEIE_UPLOAD_VALIDATION_GUIDE.md)

## License

MIT (see `package.json`).
