# Architecture

## Main boundaries

- `electron/main.js` owns the Electron lifecycle, windows, native dialogs and IPC registration. The renderer runs sandboxed with a strict Content Security Policy.
- `electron/renderer/` contains the desktop user interface: shared form controls (`compactSelect.js`), job progress (`jobUi.js`), the pre-run review (`runReview.js`) and LEIE SQL helpers (`leieSql.js`).
- `electron/backend/` contains generation, processing, validation, packaging, upload, credential and worker logic. Long jobs run in a worker (`jobWorker.js`, `leieWorker.js`) and report structured progress events.
- `templates/` holds the neutral referral template and synthetic samples; `config/` holds synthetic reference catalogs and defaults.
- `scripts/` contains tests, data import helpers, version sync and release automation.

## Referral record format

Generated files have the shape `{ "listDate": "...", "referrals": [ ... ] }`. Each referral groups its fields:

| Group | Contents |
|---|---|
| `patient` | `patientId`, names, `ssn` (always `999-..`), `dateOfBirth`, contact details, address |
| `referral` | `referralNumber`, category, status, priority, diagnosis, dates, `referralPeriod`, `network`, `carePackageKey`/`carePackageId`, `paymentAuthorityCode` |
| `provider` | referring and treating provider names and synthetic provider numbers |
| `facility` | `facilityId`, name, contact details, address |
| `coverage` | payer status and plans |
| `appointments` | scheduled appointments |

`referralGenerator.js` clones `templates/referral-template.json`, fills randomized synthetic values and the run's dates, and writes temporary source files. `contentEditor.js` then assigns identities, referral numbers, facilities, networks, care package pairs and payment codes by field name, so it also works on flat referral files supplied by the user.

## Reference data

- `facilityCatalog.js` loads `config/facilities.json`; facility assignment shuffles the selected subset (or the full catalog) and consumes it sequentially.
- Regular and situational care packages are separate catalogs. Selections are resolved as key/ID pairs and validated together.
- `paymentAuthorityCatalog.js` restricts codes to `config/payment_authority_codes.json`.
- `outputValidation.js` checks generated output against the selected reference values before results are promoted.

## Safety

`batchSafety.js` canonicalizes paths, rejects identical or nested source/output folders, stages each run in isolation and promotes results atomically. `workflowPolicy.js` is authoritative for which upload environments each workflow may use. Upload credentials are imported per user and protected with OS-provided encryption; diagnostics exclude credentials and user paths.
