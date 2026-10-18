const { validateOutputFiles } = require("./outputValidation");
const fs = require("fs");
const path = require("path");
const { assertSafeFolderRelationship, createRunId, createRunStagingDirectory, listFileMetadata, promoteStagedFiles, sha256File } = require("./batchSafety");
const { clearDirectory, getFiles, saveFile } = require("./fileHandler");
const { log } = require("./logger");
const { renameFile } = require("./renamer");
const { modifyContent } = require("./contentEditor");
const { uploadTargetsSequentially } = require("./uploader");
const { zipOutput } = require("./zipper");
const { assertSourceFilesWithinLimits } = require("./limits");
const { saveRun } = require("./runHistory");
const { writeFileAtomic } = require("./atomicFile");
const { validateReferralSourceFiles } = require("./referralValidator");

function emit(callback, event) {
  callback?.({ phase: event.phase || "processing", state: event.state || "working", current: Number(event.current) || 0, total: Number(event.total) || 0, filename: String(event.filename || ""), uploadTarget: event.uploadTarget || null, detail: event.detail || null, message: event.message || null });
}

function collectValues(node, acceptedKeys, values = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectValues(item, acceptedKeys, values);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (acceptedKeys.has(key.toLowerCase()) && ["string", "number"].includes(typeof value)) {
        const normalized = String(value).trim();
        if (normalized) values.push(normalized);
      }
      collectValues(value, acceptedKeys, values);
    }
  }
  return values;
}

function summarizeProcessedJson(stagingDir) {
  const referralNumbers = [];
  const patientIdNumbers = [];
  const facilityIds = [];
  let referralCount = 0;
  for (const file of getFiles(stagingDir)) {
    const content = JSON.parse(fs.readFileSync(file, "utf8"));
    referralCount += Array.isArray(content?.referrals) ? content.referrals.length : 0;
    collectValues(content, new Set(["referralnumber", "referral_number"]), referralNumbers);
    collectValues(content, new Set(["patientid", "patient_id"]), patientIdNumbers);
    collectValues(content, new Set(["facilityid", "facility_id"]), facilityIds);
  }
  const facilityDistribution = {};
  for (const facilityId of facilityIds) facilityDistribution[facilityId] = (facilityDistribution[facilityId] || 0) + 1;
  return {
    referralCount: referralCount || referralNumbers.length,
    referralNumbers: { first: referralNumbers[0] || "", last: referralNumbers.at(-1) || "", count: referralNumbers.length, unique: new Set(referralNumbers).size === referralNumbers.length },
    patientIdCount: patientIdNumbers.length,
    facilityDistribution,
  };
}

function buildManifest({ runId, startedAt, sourceFiles, stagingDir, archiveName, outputDir, processedCount, batchSummary, identityOptions, patientIdSettings, uploadResults, appVersion }) {
  const archivePath = path.join(stagingDir, archiveName);
  return {
    schemaVersion: 1,
    runId,
    applicationVersion: String(appVersion || ""),
    workflow: "referral",
    startedAt,
    completedAt: new Date().toISOString(),
    status: uploadResults.some((item) => item.status === "failed") ? "upload-failed" : "completed",
    outputDirectory: outputDir,
    counts: { sourceFiles: sourceFiles.length, processedFiles: processedCount, referrals: batchSummary.referralCount, patientIds: batchSummary.patientIdCount },
    referralNumbers: batchSummary.referralNumbers,
    patientIdMode: String(patientIdSettings?.mode || ""),
    selectedFacilityIds: [...(identityOptions?.selectedFacilityIds || [])],
    selections: {
      paymentAuthorityCodes: { mode: identityOptions?.useAllPaymentCodes || !identityOptions?.selectedPaymentCodes?.length ? "all" : "selected", values: [...(identityOptions?.selectedPaymentCodes || [])] },
      networks: [...(identityOptions?.selectedNetworks || [])],
      regularCarePackagePairs: identityOptions?.selectedCarePackagePairs || [],
      situationalCarePackagePairs: identityOptions?.selectedSituationalCarePackagePairs || [],
    },
    facilityDistribution: batchSummary.facilityDistribution,
    sourceFiles: sourceFiles.map((filePath) => ({ name: path.basename(filePath), bytes: fs.statSync(filePath).size, sha256: sha256File(filePath) })),
    generatedJsonFiles: listFileMetadata(stagingDir, ".json").filter((item) => !item.name.endsWith(".manifest.json")),
    archive: { name: archiveName, bytes: fs.statSync(archivePath).size, sha256: sha256File(archivePath) },
    uploads: uploadResults,
  };
}

async function processFiles(inputDir, outputDir, replacementCode, clearOutput, referralReplacementCode, patientIdSettings, listDateOverride, ssnValue, optionalOverrides, keepProcessedJson, progressCallback, uploadOptions, archiveBasename, identityOptions, runContext = {}) {
  assertSafeFolderRelationship(inputDir, outputDir);
  const files = getFiles(inputDir);
  if (files.length === 0) throw new Error("No JSON files were found in the selected source folder.");
  assertSourceFilesWithinLimits(files);
  const preflight = validateReferralSourceFiles(files);

  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const stagingDir = createRunStagingDirectory();
  let processedCount = 0;
  let referralSequenceIndex = 1;
  let patientIdSequenceIndex = 1;
  const failures = [];

  try {
    emit(progressCallback, { phase: "preflight", state: "preflight-complete", current: preflight.referralCount, total: preflight.referralCount, message: `${files.length} source file${files.length === 1 ? "" : "s"} and ${preflight.referralCount.toLocaleString()} referral${preflight.referralCount === 1 ? "" : "s"} passed schema, path, and size validation.` });
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const newName = renameFile(file, replacementCode, index + 1, files.length);
        const result = modifyContent(file, referralReplacementCode, listDateOverride, ssnValue, index + 1, files.length, optionalOverrides, referralSequenceIndex, patientIdSettings, patientIdSequenceIndex, identityOptions);
        saveFile(stagingDir, newName, result.content);
        referralSequenceIndex += result.referralNumbersUsed || 0;
        patientIdSequenceIndex += result.patientIdentitiesUsed || 0;
        processedCount += 1;
        log("info", `Processed in staging: ${file} -> ${newName}`);
        emit(progressCallback, { phase: "processing", state: "processed", current: index + 1, total: files.length, filename: path.basename(file), message: `Processed ${index + 1} of ${files.length} source files.` });
      } catch (error) {
        failures.push({ fileName: path.basename(file), message: error.message });
        log("error", `Error processing ${file}: ${error.message}`);
        emit(progressCallback, { phase: "processing", state: "error", current: index + 1, total: files.length, filename: path.basename(file), detail: error.message, message: `Validation failed for ${path.basename(file)}.` });
      }
    }

    if (failures.length > 0) {
      const summary = failures.slice(0, 5).map((failure) => `${failure.fileName}: ${failure.message}`).join("; ");
      throw new Error(`The batch was stopped because ${failures.length} source file${failures.length === 1 ? "" : "s"} failed. No archive was created or uploaded. ${summary}${failures.length > 5 ? "; ..." : ""}`);
    }

    validateReferralSourceFiles(getFiles(stagingDir));
    validateOutputFiles(getFiles(stagingDir), identityOptions, optionalOverrides);
    const batchSummary = summarizeProcessedJson(stagingDir);
    if (!batchSummary.referralNumbers.unique) throw new Error("The batch contains duplicate Referral Numbers. No archive was created or uploaded.");
    emit(progressCallback, { phase: "packaging", state: "packaging", filename: archiveBasename || "referrals", message: "Creating the gzip archive from this run's isolated staging folder." });
    const masterName = `${archiveBasename || "referrals"}_Master.json`;
    const stagedArchivePath = await zipOutput(stagingDir, archiveBasename, identityOptions?.keepMasterJson === false ? "" : masterName);
    if (!stagedArchivePath) throw new Error("No .gz archive could be created from the processed files.");
    const archiveName = path.basename(stagedArchivePath);
    const manifestName = `${path.basename(archiveName, ".gz")}.manifest.json`;
    const uploadResults = [];
    const manifestArgs = { runId, startedAt, sourceFiles: files, stagingDir, archiveName, outputDir, processedCount, batchSummary, identityOptions, patientIdSettings, uploadResults, appVersion: runContext.appVersion };

    const jsonNames = keepProcessedJson
      ? getFiles(stagingDir).map((filePath) => path.basename(filePath)).filter((name) => name !== manifestName && name !== masterName)
      : [];
    if (identityOptions?.keepMasterJson !== false) jsonNames.push(masterName);
    const promotedPaths = promoteStagedFiles(stagingDir, outputDir, [...jsonNames, archiveName], clearOutput, clearDirectory);
    const archivePath = path.join(outputDir, archiveName);
    const manifestPath = "";
    emit(progressCallback, { phase: "packaging", state: "archive-created", current: 1, total: 1, filename: archiveName, message: "Archive was saved safely." });

    if (uploadOptions?.enabled) {
      const selectedTargets = uploadOptions.targets || [];
      uploadResults.push(...await uploadTargetsSequentially(archivePath, selectedTargets, {
        onProgress: (event) => emit(progressCallback, {
          phase: "upload",
          filename: archiveName,
          ...event,
          message: event.state === "upload-batch-start"
            ? `Uploading in order to ${event.targetNames.join(", ")}.`
            : event.message,
        }),
      }));
    }

    const finalManifest = buildManifest(manifestArgs);
    finalManifest.generatedJsonFiles = finalManifest.generatedJsonFiles.filter((item) => jsonNames.includes(item.name));
    const failedUploads = uploadResults.filter((item) => item.status === "failed");
    const run = saveRun({ runId, createdAt: finalManifest.completedAt, status: failedUploads.length ? "upload-failed" : "completed", workflow: "referral", outputDir, archivePath, manifestPath, manifestData: finalManifest, processedCount, referralCount: batchSummary.referralCount, uploadResults });
    const completedUploads = uploadResults.filter((item) => item.status === "completed");
    const message = failedUploads.length
      ? `Your files are safe in the output folder and ${completedUploads.length} upload${completedUploads.length === 1 ? "" : "s"} completed, but ${failedUploads.map((item) => item.serverName).join(", ")} still need attention. Use Retry Failed Uploads; you do not need to process the files again.`
      : uploadResults.length
        ? `Completed safely. Created ${archiveName} and verified uploads to ${completedUploads.map((item) => item.serverName).join(", ")}.`
        : `Completed safely. Processed ${processedCount} file${processedCount === 1 ? "" : "s"}, created ${archiveName}, and saved the output files.`;
    return { message, run, archivePath, manifestPath, outputDir, promotedPaths, uploadResults, retryable: failedUploads.length > 0 };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

module.exports = { collectValues, processFiles, summarizeProcessedJson };
