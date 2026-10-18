# Data Generator & File Processing User Guide

This guide covers Version 1.5.3. Every value the app generates is synthetic test data.

## Purpose

Use the app to:

- generate new synthetic referral JSON files
- process existing referral JSON files (identities, referral numbers, dates and reference values)
- package results as individual JSON, a combined master JSON, and a gzip archive
- detect and remove duplicate rows in an LEIE Excel export
- upload results to saved SFTP environment profiles

## Install and start

Run the Setup installer and choose an installation folder. Application files, templates, reference data and documentation are installed with the app; your settings and imported upload profiles are stored per Windows user. On first launch after an install or upgrade, the release notes open once; select `Start Using The App` to continue.

## Before you begin

Have ready:

- for referral processing: a folder containing referral `.json` files
- for LEIE processing: an LEIE `.xlsx`, `.xls`, `.xlsm` or `.xlsb` file or a folder of them
- an output folder (it must not be the source folder or inside it)
- a credentials JSON file or `WinSCP.ini` if you plan to upload

Source files are never changed. Results are written only to the output folder after validation.

## Main areas

- **Referral Files** with two tabs: `Generate` (new synthetic files) and `Edit Existing` (process a source folder).
- **LEIE Data** for duplicate handling and upload of LEIE workbooks.
- A sticky status area shows the current phase, progress and a `Cancel` button for long jobs. Each run opens a pre-run review before anything is written.

## Generate new referral files

1. Choose the number of JSON files and referrals per file.
2. Set the Referral Number prefix and starting number (see below).
3. Optionally open `Show Additional Fields` for Patient ID, SSN, date of birth, facilities, care packages, payment authority codes, network and dates.
4. Choose the output folder and archive naming, then run.

Generated records follow `templates/referral-template.json`: each referral has `patient`, `referral`, `provider`, `facility`, `coverage` and `appointments` groups. Names, contact details, diagnoses, providers and payers are drawn from small synthetic pools. New referrals use the current date by default; the expiration date follows `Referral Period`. Custom dates remain available.

## Edit existing referral files

Select the source folder; the app inspects the files, shows defaults read from the first file (such as `listDate` and referral number), and validates the JSON structure before processing. The same identity, reference value and output options as generation apply.

## Referral Number and Patient ID

Referral Number prefix modes:

- `Standard` uses `RF` for every referral.
- `Custom` uses your own prefix (letters, numbers, hyphens and underscores).

The starting body can include letters, numbers, hyphens and underscores; trailing digits are incremented for each referral, so `26S600001` becomes `RF26S600001`, `RF26S600002`, and so on.

Patient ID modes:

- `Default` generates `TEST` followed by unique digits (17 characters).
- `Custom` uses your base and generates the remaining characters.
- `Referral Number` derives each Patient ID from its Referral Number.

Optionally make the last 3, 4 or 5 characters of each Patient ID match its Referral Number.

## Identity and reference values

- **SSN and date of birth.** Random test SSNs always start with `999`; a fixed SSN must also start with `999`. Date of birth can be random or fixed.
- **Facilities.** Leave automatic to mix facilities from `config/facilities.json`, or select a subset. Each facility can be searched by ID or name.
- **Care packages.** Regular care packages are mixed automatically; select a subset to restrict them. Situational care packages are manual-only and are applied only when selected.
- **Payment Authority Code.** Choose one code, several, or all configured codes.
- **Network.** Automatic keeps each referral's source value; otherwise choose from `NET1` to `NET5`.

## Output and archive naming

Choose whether to keep individual formatted JSON files and/or a combined master JSON; a gzip archive is always produced. Archive names can be based on the referral number, network, referral date and time, or custom text, with a live preview. Matching names are overwritten after validation; unrelated files in the output folder are preserved. After a run, `Generate Manifest` exports an optional manifest with counts and SHA-256 checksums.

## Uploads

Enable upload, select one or more environment targets, choose a user and remote directory, and test the connection. Referral uploads default to `/referral_uploads`; LEIE uploads default to `/in/manual_process/`. Targets run one at a time; a failed target is reported without stopping the others, and failed uploads can be retried. Referral Files cannot be uploaded to PROD.

Import upload profiles with `Import To Config` from a credentials JSON file or `WinSCP.ini`. Imported credentials are stored per user with OS-provided encryption.

## LEIE data processing

1. Select the LEIE workbook or folder. The app reports row counts and duplicate rows.
2. Remove duplicates automatically or stop and review them.
3. Choose the output folder and file name (defaults to the source name).
4. Optionally upload the processed `.xlsx`.
5. Paste the ETL batch ID to produce example validation SQL, copy it, and adapt it to your database schema. See [LEIE upload and validation](LEIE_UPLOAD_VALIDATION_GUIDE.md).

## Troubleshooting

- **A large file is rejected.** Source size limits protect memory; split the file or raise the limit with the `DGFP_MAX_*` environment variables.
- **An upload target is disabled.** The workflow policy does not allow that environment for the current workflow.
- **No upload profiles are available.** Import a credentials JSON file or `WinSCP.ini`.
- **A job was cancelled.** Partial output is discarded; the output folder keeps its previous contents.
- **Diagnostics.** `Export Diagnostics` writes a report without credentials or user file paths.
