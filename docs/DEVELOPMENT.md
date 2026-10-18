# Development

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm start
```

## Conventions

- CommonJS modules, no build step for application code.
- Keep the renderer free of Node.js access; use the preload bridge (`window.dgfp`).
- Reuse the shared control system in `electron/renderer/styles.css` and `compactSelect.js` instead of page-specific sizes.
- Keep generated data plainly synthetic. Do not add real names, identifiers, facilities, hostnames or credentials.

## Reference data

- `config/facilities.json` can be regenerated from a spreadsheet with `pnpm data:facilities -- /path/to/facilities.xlsx`.
- `config/care_package_options.json` can be regenerated with `pnpm data:care-packages -- /path/to/care-packages.xlsx`. Entries that also exist in `config/situational_care_package_options.json` are excluded from the regular catalog.
- `templates/referral-template.json` defines the generated record structure. Update `docs/ARCHITECTURE.md` and the smoke tests when its groups change.

## Uploads

Upload environments and their order (SQA, DEV, PPD, PROD) are defined in `electron/backend/workflowPolicy.js`. Referral uploads exclude PROD; only the LEIE workflow may use it, and it requires confirmation. `config/upload_profiles.json` contains example hosts only.

## Releases

Update `version`, `releaseTag` and `releaseNotes` in `config/app_version.json`. `scripts/sync-build-version.js` (run before start, test and dist) copies the version into `package.json`. `pnpm run dist` builds the Windows Setup installer; the GitHub release workflow builds, verifies and publishes it from a version tag.
