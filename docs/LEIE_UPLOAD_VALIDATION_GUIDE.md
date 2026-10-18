# LEIE Data Upload and Validation Guide

## Purpose

The HHS Office of Inspector General publishes the List of Excluded Individuals/Entities (LEIE) as a public download. This guide describes a generic process for cleaning an LEIE workbook with the app, uploading it to an SFTP drop location, and validating the load in your own database.

LEIE uploads are separate from referral uploads: LEIE defaults to `/in/manual_process/` and referrals default to `/referral_uploads`.

## Prerequisites

- An LEIE Excel export.
- An upload profile for each target environment (imported in the app).
- Read access to the database that ingests the file.

## Suggested load order

1. `DEV`
2. `SQA`
3. `PPD`
4. `PROD` (requires explicit confirmation in the app)

Validate each environment before moving to the next.

## Step 1: Prepare the file

Select the workbook in the LEIE Data workflow. Remove duplicate rows automatically or review them, then save the processed `.xlsx`. Keep the output name meaningful, for example `LEIE_<MMDDYYYY>.xlsx`.

## Step 2: Upload

Enable upload, select the target environment, test the connection and run. The app retries transient errors, verifies the remote file size and reports each target's status.

## Step 3: Find the ETL batch ID

Your ingestion process should record each load in a batch log table. The example SQL assumes a table named `etl_batch_log`.

## Step 4: Validate the load

Paste the batch ID into the app to produce example SQL like the following, then adapt table and database names to your schema:

```sql
Use referral_db;

select * from etl_batch_log order by last_updated_date desc;-- First get the etl_batch_id

Select File_Name, *
from etl_batch_log
where etl_batch_id = '<batch id>'
order by Start_date_time desc;

select count(*)
from dbo.provider_exclusion
where etl_batch_id = '<batch id>';

Select count(*)
from dbo.provider_exclusion
where etl_batch_id <> '<batch id>'
  and is_current = 'Y';

select * from dbo.provider_exclusion;
```

## Validation checklist

- The file name, batch ID and timestamps match the upload.
- The loaded row count matches the processed workbook row count.
- Only the new batch is marked current.
