const { codes: paymentAuthorityCodes, validatePaymentCode } = require("./paymentAuthorityCatalog");
const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");
const {
  describePatientIdPreview,
  PATIENT_ID_MODES,
  PATIENT_ID_TEST_PREFIX,
  PATIENT_ID_TEST_SUFFIX_LENGTH,
  PATIENT_ID_TOTAL_LENGTH,
  LIST_DATE_FORMAT,
  PAYMENT_AUTHORITY_CODE_LENGTH,
  NETWORK_VALUES,
  REFERRAL_NUMBER_DIGIT_COUNT,
  REFERRAL_NUMBER_PREFIX,
  REFERRAL_PREFIX_MODES,
  extractJsonChangeDefaults,
  extractListDate,
  generatePatientIdFromReferralNumber,
  generateOptionalFieldOverrides,
  normalizeReferralPrefix,
  normalizeReferralPrefixMode,
  preparePatientIdSettings,
  resolveReferralPrefix,
  validateIsoDate,
  validatePatientIdSettings,
  validateIsoDateTime,
  validatePaymentAuthorityCode,
  validateCustomReferralPrefix,
  validateReferralNumberStart,
  validateSsn,
  validateFacilityId,
} = require("./contentEditor");
const { bundlePath, dataPath, ensureRuntimeFiles, getRuntimeRoot } = require("./appPaths");
const { getFiles } = require("./fileHandler");
const { setupLogger } = require("./logger");
const { processFiles } = require("./processor");
const {
  buildGeneratedReferralSources,
  getGeneratorDefaults,
  getCarePackageOptions,
  getSituationalCarePackageOptions,
  resolveCarePackageSelection,
} = require("./referralGenerator");
const { cleanupRuntimeArtifacts, cleanupStaleRuntimeArtifacts, removePath } = require("./runtimeCleanup");
const { loadFacilityOptions, loadFacilities } = require("./facilityCatalog");
const { getUiSettingsPath, loadUiSettings, saveUiSettings } = require("./userSettings");
const { inspectLeieSource, processLeieFiles } = require("./leieProcessor");
const { loadReleaseTracker, saveReleaseTracker } = require("./releaseTracker");
const {
  getServerDisplayForTarget,
  getUploadProfileSourcePath,
  getUploadTargetNames,
  getUserNamesForServer,
  importUploadSourceToConfig,
  loadUploadProfiles,
  resolveUploadTargets,
  summarizeUploadProfiles,
  testUploadConnection,
} = require("./uploader");
const { sanitizeFilenameBase } = require("./renamer");
const { buildArchiveBasename, buildOutputFileNames, DEFAULT_ARCHIVE_BASENAME, sanitizeArchiveBasename } = require("./zipper");
const { assertSourceFilesWithinLimits, getProcessingLimits } = require("./limits");
const { writeFileAtomic } = require("./atomicFile");
const { assertSafeFolderRelationship, cleanupStaleRunStagingDirectories } = require("./batchSafety");
const { getRun, saveRun } = require("./runHistory");
const { allowedUploadTargets, assertUploadTargets } = require("./workflowPolicy");

ensureRuntimeFiles();
cleanupStaleRunStagingDirectories();
setupLogger();

function assertReferralUploadTargets(targets = []) {
  assertUploadTargets("referral", targets);
}

function normalizeReleaseNotes(rawValue) {
  return (Array.isArray(rawValue) ? rawValue : [])
    .map((note) => String(note || "").trim())
    .filter(Boolean);
}

function loadAppVersionInfo() {
  const runtimePath = dataPath("config", "app_version.json");
  const bundledPath = bundlePath("config", "app_version.json");
  for (const targetPath of [runtimePath, bundledPath]) {
    try {
      if (fs.existsSync(targetPath)) {
        const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
        const version = String(parsed.version || "").trim();
        const label = String(parsed.label || "").trim();
        const channel = String(parsed.channel || "").trim();
        const announcementId = String(
          parsed.announcementId || parsed.releaseAnnouncementId || parsed.release_announcement_id || ""
        ).trim();
        const displayVersion = version.endsWith(".0") ? version.slice(0, -2) : version;
        const displayLabel = label || [channel, displayVersion].filter(Boolean).join(" ").trim();
        const releaseKey = announcementId || [version, label || channel || displayVersion].filter(Boolean).join("|");
        return {
          version,
          label,
          channel,
          announcementId,
          displayLabel,
          releaseKey,
          releaseNotes: normalizeReleaseNotes(parsed.releaseNotes || parsed.release_notes),
        };
      }
    } catch (_error) {
      // Ignore invalid version config and fall back to empty.
    }
  }
  return {
    version: "",
    label: "",
    channel: "",
    announcementId: "",
    displayLabel: "",
    releaseKey: "",
    releaseNotes: [],
  };
}

function buildUploadTargets(profiles) {
  return getUploadTargetNames(profiles).map((targetName) => ({
    name: targetName,
    serverDisplay: getServerDisplayForTarget(profiles, targetName),
    users: getUserNamesForServer(profiles, targetName),
    defaultRemoteDirectory: "/referral_uploads",
  }));
}

function inspectLeieSourceAsync(payload) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "leieWorker.js");
    let settled = false;
    const worker = new Worker(workerPath, {
      workerData: {
        task: "inspect",
        payload,
      },
    });

    worker.on("message", (message) => {
      if (settled) {
        return;
      }
      settled = true;
      if (message?.ok) {
        resolve(message.result);
      } else {
        reject(new Error(message?.error || "LEIE scan failed."));
      }
    });

    worker.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    worker.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        reject(new Error("LEIE scan worker exited before returning a result."));
      } else {
        reject(new Error(`LEIE scan worker exited with code ${code}.`));
      }
    });
  });
}

function getInfo() {
  const uiSettings = loadUiSettings();
  const releaseTracker = loadReleaseTracker();
  const acknowledgedReleaseKey = String(
    releaseTracker.acknowledgedReleaseKey || uiSettings.acknowledgedReleaseKey || ""
  ).trim();

  const appVersion = loadAppVersionInfo();
  const profiles = loadUploadProfiles();
  const [profileSourcePath, profileSourceKind] = getUploadProfileSourcePath();
  const userGuidePdfPath = dataPath("docs", "USER_GUIDE.pdf");
  const userGuidePath = fs.existsSync(userGuidePdfPath)
    ? userGuidePdfPath
    : dataPath("docs", "USER_GUIDE.md");
  const leieValidationGuidePathCandidates = [
    dataPath("docs", "LEIE_UPLOAD_VALIDATION_GUIDE.pdf"),
    dataPath("docs", "LEIE_UPLOAD_VALIDATION_GUIDE.md"),
    dataPath("docs", "LEIE_Data_Upload_Validation_Guide.md"),
  ];
  const leieValidationGuidePath = leieValidationGuidePathCandidates.find((targetPath) => fs.existsSync(targetPath)) || "";
  return {
    runtimeRoot: getRuntimeRoot(),
    appVersionLabel: appVersion.displayLabel,
    appVersion,
    releaseAnnouncement: {
      releaseKey: appVersion.releaseKey,
      acknowledgedReleaseKey,
      version: appVersion.version,
      label: appVersion.label || appVersion.displayLabel,
      notes: appVersion.releaseNotes,
      shouldShow: Boolean(
        appVersion.releaseKey &&
          acknowledgedReleaseKey !== appVersion.releaseKey
      ),
    },
    profileSource: {
      path: profileSourcePath,
      kind: profileSourceKind,
    },
    uploadProfileSummary: summarizeUploadProfiles(profiles),
    uploadTargets: buildUploadTargets(profiles),
    workflowPolicy: {
      referralUploadTargets: allowedUploadTargets("referral"),
      leieUploadTargets: allowedUploadTargets("leie"),
    },
    generatorDefaults: getGeneratorDefaults(),
    facilities: loadFacilities().filter((facility) => /^[A-Za-z0-9]{1,5}$/.test(facility.facility_id || "")),
    paymentAuthorityCodes,
    carePackageOptions: getCarePackageOptions(),
    situationalCarePackageOptions: getSituationalCarePackageOptions(),
    uiSettings,
    constants: {
      processingLimits: getProcessingLimits(),
      patientIdModes: PATIENT_ID_MODES,
      patientIdTestPrefix: PATIENT_ID_TEST_PREFIX,
      patientIdSuffixLength: PATIENT_ID_TEST_SUFFIX_LENGTH,
      patientIdTotalLength: PATIENT_ID_TOTAL_LENGTH,
      listDateFormat: LIST_DATE_FORMAT,
      referralNumberPrefix: REFERRAL_NUMBER_PREFIX,
      referralNumberDigits: REFERRAL_NUMBER_DIGIT_COUNT,
      paymentAuthorityCodeLength: PAYMENT_AUTHORITY_CODE_LENGTH,
      defaultArchiveBasename: DEFAULT_ARCHIVE_BASENAME,
    },
    docs: {
      userGuidePath,
      leieValidationGuidePath,
    },
    userConfig: {
      uiSettingsPath: getUiSettingsPath(),
    },
  };
}

function exportDiagnosticReport(payload = {}) {
  const outputDir = String(payload.outputDir || "").trim();
  if (!outputDir) throw new Error("Please choose a folder for the diagnostic report.");
  fs.mkdirSync(outputDir, { recursive: true });
  const appVersion = loadAppVersionInfo();
  const profiles = loadUploadProfiles();
  const settings = loadUiSettings();
  const report = {
    generatedAt: new Date().toISOString(),
    appVersion: appVersion.version,
    appLabel: appVersion.displayLabel,
    platform: process.platform,
    architecture: process.arch,
    runtimeVersions: process.versions,
    uploadProfileSummary: summarizeUploadProfiles(profiles),
    processingLimits: getProcessingLimits(),
    workflowPreferences: {
      theme: settings.theme,
      mainTab: settings.mainTab,
      subTab: settings.subTab,
      randomizeSsn: settings.randomizeSsn,
      randomizeDob: settings.randomizeDob,
      randomizeFacilityId: settings.randomizeFacilityId,
      matchSuffixLength: settings.matchSuffixLength,
      uploadEnabled: settings.uploadEnabled,
      leieDuplicateHandling: settings.leieDuplicateHandling,
    },
    health: {
      facilityCount: loadFacilities().length,
      selectableFacilityCount: loadFacilityOptions().length,
      carePackageOptionCount: getCarePackageOptions().length,
      userGuideAvailable: fs.existsSync(dataPath("docs", "USER_GUIDE.pdf")),
    },
  };
  const reportPath = path.join(outputDir, `dgfp-diagnostics-${Date.now()}.json`);
  writeFileAtomic(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { reportPath, message: `Diagnostic report saved to ${reportPath}.` };
}

function inspectSource(payload) {
  const inputDir = (payload.inputDir || "").trim();
  if (!inputDir) {
    return {
      inputDir: "",
      fileCount: 0,
      firstListDate: "",
      defaults: {},
      sourceFiles: [],
    };
  }

  const sourceFiles = getFiles(inputDir);
  if (sourceFiles.length === 0) {
    return {
      inputDir,
      fileCount: 0,
      firstListDate: "",
      defaults: {},
      sourceFiles: [],
    };
  }
  const totalSourceBytes = assertSourceFilesWithinLimits(sourceFiles);

  const firstFile = sourceFiles[0];
  let defaults = {};
  let firstListDate = "";

  try {
    defaults = extractJsonChangeDefaults(firstFile);
  } catch (_error) {
    defaults = {};
  }

  try {
    firstListDate = extractListDate(firstFile) || "";
  } catch (_error) {
    firstListDate = "";
  }

  return {
    inputDir,
    fileCount: sourceFiles.length,
    totalSourceBytes,
    firstListDate,
    defaults,
    sourceFiles: sourceFiles.map((filePath) => ({
      path: filePath,
      name: require("path").basename(filePath),
    })),
  };
}

function buildPreview(payload) {
  const replacementCode = sanitizeFilenameBase(payload.replacementCode || "");
  const referralValue = (payload.referralReplacementCode || "").trim();
  const patientIdSettings = payload.patientIdSettings || {};
  const optionalOverrides = payload.optionalOverrides || {};
  const fieldErrors = collectFieldErrors(payload);

  let normalizedReferral = "";
  const referralPrefixOptions = fieldErrors.referralPrefix
    ? null
    : prepareReferralPrefixOptions(payload.identityOptions);
  if (referralValue && !fieldErrors.referralReplacementCode && !fieldErrors.referralPrefix) {
    normalizedReferral = validateReferralNumberStart(
      referralValue,
      resolveReferralPrefix(referralPrefixOptions, 1)
    );
  }

  const normalizedOptionalOverrides = {};
  if (Object.prototype.hasOwnProperty.call(optionalOverrides, "facilityId") && !fieldErrors.facilityId) {
    normalizedOptionalOverrides.facilityId = validateFacilityId(optionalOverrides.facilityId || "");
  }
  if (
    Object.prototype.hasOwnProperty.call(optionalOverrides, "paymentAuthorityCode") &&
    !fieldErrors.paymentAuthorityCode
  ) {
    normalizedOptionalOverrides.paymentAuthorityCode = validatePaymentAuthorityCode(
      optionalOverrides.paymentAuthorityCode || ""
    );
  }

  let patientIdPreview = describePatientIdPreview({ mode: PATIENT_ID_MODES.TEST_DYNAMIC });
  let patientIdPreviewValue = `${PATIENT_ID_TEST_PREFIX}${"0".repeat(PATIENT_ID_TEST_SUFFIX_LENGTH - 1)}1`;
  if (!fieldErrors.patientIdValue) {
    if (patientIdSettings.mode === PATIENT_ID_MODES.REFERRAL_MATCH && normalizedReferral) {
      const referralPrefixes = referralPrefixOptions
        ? [resolveReferralPrefix(referralPrefixOptions, 1), resolveReferralPrefix(referralPrefixOptions, 2)]
        : [];
      patientIdPreviewValue = generatePatientIdFromReferralNumber(normalizedReferral, referralPrefixes);
      patientIdPreview = `Preview: ${patientIdPreviewValue}`;
    } else {
      patientIdPreview = describePatientIdPreview(patientIdSettings);
      patientIdPreviewValue = patientIdPreview.replace(/^Preview:\s*/, "").replace(/\s+\(generated (?:digits|characters) vary\)$/, "");
    }
  }

  const namingPayload = {
    ...payload,
    referralReplacementCode: normalizedReferral || payload.referralReplacementCode,
    patientIdPreview: patientIdPreviewValue,
  };
  const archiveBasename = fieldErrors.archiveBasename
    ? sanitizeArchiveBasename(payload.archiveBasename || DEFAULT_ARCHIVE_BASENAME)
    : buildArchiveBasename(namingPayload);
  const outputFileNames = fieldErrors.archiveBasename
    ? { basename: archiveBasename, json: `${archiveBasename}.json`, gzip: `${archiveBasename}.gz` }
    : buildOutputFileNames(namingPayload);

  return {
    replacementCode: replacementCode || (payload.archiveNamingOptions?.mode ? archiveBasename : ""),
    archiveBasename,
    outputFileNames,
    patientIdPreview,
    referralNumber: normalizedReferral,
    optionalOverrides: normalizedOptionalOverrides,
    fieldErrors,
  };
}

function collectFieldErrors(payload) {
  const fieldErrors = {};
  const patientIdSettings = payload.patientIdSettings || {};
  const optionalOverrides = payload.optionalOverrides || {};
  const selectedNetworks = Array.isArray(payload.identityOptions?.selectedNetworks)
    ? payload.identityOptions.selectedNetworks.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const invalidNetwork = selectedNetworks.find((value) => !NETWORK_VALUES.includes(value));
  if (invalidNetwork) {
    fieldErrors.networkSelection = `Network ${invalidNetwork} is not available. Choose NET1, NET2, NET3, NET4, or NET5.`;
  }

  try {
    resolveCarePackageSelection(payload.identityOptions?.selectedCarePackageKeys, Boolean(payload.identityOptions?.useAllCarePackages));
    resolveCarePackageSelection(
      payload.identityOptions?.selectedSituationalCarePackageKeys,
      Boolean(payload.identityOptions?.useAllSituationalCarePackages),
      "situational"
    );
  } catch (error) {
    fieldErrors.carePackageSelection = error.message;
  }

  if ((payload.inputDir || "").trim() && (payload.outputDir || "").trim()) {
    try {
      assertSafeFolderRelationship(payload.inputDir, payload.outputDir);
    } catch (error) {
      fieldErrors.outputDir = error.message;
    }
  }

  if (payload.identityOptions?.randomizeSsn === false && (payload.ssnValue || "").trim()) {
    try {
      validateSsn(payload.ssnValue);
    } catch (error) {
      fieldErrors.ssnValue = error.message;
    }
  }

  let referralPrefixOptions;
  try {
    referralPrefixOptions = prepareReferralPrefixOptions(payload.identityOptions);
  } catch (error) {
    fieldErrors.referralPrefix = error.message;
  }

  if ((payload.referralReplacementCode || "").trim() && referralPrefixOptions) {
    try {
      validateReferralNumberStart(
        payload.referralReplacementCode,
        resolveReferralPrefix(referralPrefixOptions, 1)
      );
    } catch (error) {
      fieldErrors.referralReplacementCode = error.message;
    }
  }

  if (Object.prototype.hasOwnProperty.call(optionalOverrides, "facilityId")) {
    try {
      validateFacilityId(optionalOverrides.facilityId || "");
    } catch (error) {
      fieldErrors.facilityId = error.message;
    }
  }

  if (Object.prototype.hasOwnProperty.call(optionalOverrides, "paymentAuthorityCode")) {
    try {
      validatePaymentAuthorityCode(optionalOverrides.paymentAuthorityCode || "");
    } catch (error) {
      fieldErrors.paymentAuthorityCode = error.message;
    }
  }

  const dateFieldValidators = [
    ["dateOfBirth", "Date of Birth", validateIsoDate],
    ["referralDate", "Referral Date", validateIsoDate],
    ["referralDateTime", "Referral DateTime", validateIsoDateTime],
    ["expirationDate", "Referral Expiration Date", validateIsoDate],
    ["lastUpdateDate", "Referral Last Update Date", validateIsoDate],
  ];
  for (const [fieldName, fieldLabel, validator] of dateFieldValidators) {
    if (!Object.prototype.hasOwnProperty.call(optionalOverrides, fieldName)) {
      continue;
    }
    try {
      validator(optionalOverrides[fieldName] || "", fieldLabel);
    } catch (error) {
      fieldErrors[fieldName] = error.message;
    }
  }

  if (payload.fileCount !== undefined && Number(payload.fileCount || 0) <= 0) {
    fieldErrors.fileCount = "Number of JSON files to generate must be greater than zero.";
  }
  if (payload.referralsPerFile !== undefined && Number(payload.referralsPerFile || 0) <= 0) {
    fieldErrors.referralsPerFile = "Number of referrals per file must be greater than zero.";
  }
  const processingLimits = getProcessingLimits();
  if (Number(payload.fileCount || 0) > processingLimits.maxGeneratedFiles) {
    fieldErrors.fileCount = `Number of JSON files cannot exceed ${processingLimits.maxGeneratedFiles.toLocaleString()}.`;
  }
  if (Number(payload.referralsPerFile || 0) > processingLimits.maxReferralsPerFile) {
    fieldErrors.referralsPerFile = `Referrals per file cannot exceed ${processingLimits.maxReferralsPerFile.toLocaleString()}.`;
  }
  if (Number(payload.fileCount || 0) * Number(payload.referralsPerFile || 0) > processingLimits.maxGeneratedReferrals) {
    fieldErrors.referralsPerFile = `The generated batch cannot exceed ${processingLimits.maxGeneratedReferrals.toLocaleString()} referrals.`;
  }

  try {
    validatePatientIdSettings(patientIdSettings);
  } catch (error) {
    fieldErrors.patientIdValue = error.message;
  }

  try {
    buildArchiveBasename({
      ...payload,
      patientIdPreview: payload.patientIdPreview || `${PATIENT_ID_TEST_PREFIX}${"0".repeat(PATIENT_ID_TEST_SUFFIX_LENGTH - 1)}1`,
    });
  } catch (error) {
    fieldErrors.archiveBasename = error.message;
  }

  const uploadPayload = payload.upload || {};
  if (uploadPayload.enabled) {
    for (const target of uploadPayload.targets || []) {
      const serverName = (target.server_name || "").trim() || "target";
      if (!(target.user_name || "").trim()) {
        fieldErrors[`upload:${serverName}:user_name`] = `Please choose a user for ${serverName}.`;
      }
      if (!(target.remote_directory || "").trim()) {
        fieldErrors[`upload:${serverName}:remote_directory`] = `Please enter the remote upload location for ${serverName}.`;
      }
    }
  }

  return fieldErrors;
}

function buildUploadOptions(payload) {
  const uploadPayload = payload.upload || {};
  if (!uploadPayload.enabled) {
    return null;
  }

  const requestedTargets = Array.isArray(uploadPayload.resolvedTargets)
    ? uploadPayload.resolvedTargets
    : uploadPayload.targets || [];
  assertReferralUploadTargets(requestedTargets);

  return {
    enabled: true,
    targets: Array.isArray(uploadPayload.resolvedTargets)
      ? uploadPayload.resolvedTargets
      : resolveUploadTargets(loadUploadProfiles(), uploadPayload.targets || []),
  };
}

function prepareBackgroundPayload(command, payload = {}) {
  const prepared = structuredClone(payload || {});
  if (prepared.upload?.enabled) {
    if (command === "process" || command === "generate") {
      assertReferralUploadTargets(prepared.upload.targets || []);
    } else if (command === "process-leie") {
      assertUploadTargets("leie", prepared.upload.targets || []);
    }
    prepared.upload.resolvedTargets = resolveUploadTargets(loadUploadProfiles(), prepared.upload.targets || []);
  }
  if (command === "test-upload-target") {
    const [resolvedTarget] = resolveUploadTargets(loadUploadProfiles(), [{
      server_name: String(prepared.server_name || "").trim(),
      user_name: String(prepared.user_name || "").trim(),
      remote_directory: String(prepared.remote_directory || "").trim(),
    }]);
    prepared.resolvedTarget = resolvedTarget;
  }
  return prepared;
}

function buildCommonArgs(payload, progressCallback) {
  const referralPrefixOptions = prepareReferralPrefixOptions(payload.identityOptions);
  const referralPrefix = resolveReferralPrefix(referralPrefixOptions, 1);
  const selectedFacilityIds = [...new Set(
    (Array.isArray(payload.identityOptions?.selectedFacilityIds)
      ? payload.identityOptions.selectedFacilityIds
      : [])
      .map((facilityId) => validateFacilityId(facilityId))
      .filter(Boolean)
  )];
  const ssnValue = (payload.ssnValue || "999-99-0001").trim();
  const identityOptions = {
    selectedPaymentCodes: (payload.identityOptions?.selectedPaymentCodes || []).map(validatePaymentCode),
    useAllPaymentCodes: Boolean(payload.identityOptions?.useAllPaymentCodes),
    keepMasterJson: payload.keepMasterJson !== false,
    randomizeSsn: payload.identityOptions?.randomizeSsn !== false,
    randomizeDob: payload.identityOptions?.randomizeDob !== false,
    randomizeFacilityId: Boolean(payload.identityOptions?.randomizeFacilityId),
    selectedFacilityIds: payload.identityOptions?.randomizeFacilityId ? [] : selectedFacilityIds,
    selectedNetworks: [...new Set(
      (Array.isArray(payload.identityOptions?.selectedNetworks) ? payload.identityOptions.selectedNetworks : [])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
    )],
    selectedCarePackagePairs: resolveCarePackageSelection(
      payload.identityOptions?.selectedCarePackageKeys,
      Boolean(payload.identityOptions?.useAllCarePackages) || !payload.identityOptions?.selectedCarePackageKeys?.length
    ),
    selectedSituationalCarePackagePairs: resolveCarePackageSelection(
      payload.identityOptions?.selectedSituationalCarePackageKeys,
      Boolean(payload.identityOptions?.useAllSituationalCarePackages),
      "situational"
    ),
    referralPrefix,
    referralPrefixMode: referralPrefixOptions.referralPrefixMode,
    customReferralPrefix: referralPrefixOptions.customReferralPrefix,
    matchSuffixLength: [3, 4, 5].includes(Number(payload.identityOptions?.matchSuffixLength))
      ? Number(payload.identityOptions.matchSuffixLength)
      : 5,
  };
  if (!identityOptions.randomizeSsn) validateSsn(ssnValue);

  let referralCode = (payload.referralReplacementCode || "").trim();
  if (referralCode) {
    referralCode = validateReferralNumberStart(referralCode, referralPrefix);
  }

  const archiveBasename = buildArchiveBasename(payload);
  const usesNamingMode = Boolean(payload.archiveNamingOptions?.mode);
  const useAltFilenamePrefix = Boolean(payload.archiveNamingOptions?.useAltPrefix);

  return {
    outputDir: (payload.outputDir || "").trim(),
    replacementCode: usesNamingMode
      ? sanitizeFilenameBase(payload.replacementCode || "") || archiveBasename
      : useAltFilenamePrefix
      ? archiveBasename
      : (payload.replacementCode || "").trim(),
    clearOutput: Boolean(payload.clearOutput),
    referralReplacementCode: referralCode,
    patientIdSettings: preparePatientIdSettings(payload.patientIdSettings || {}),
    listDateOverride: (payload.listDateOverride || "").trim() || null,
    ssnValue,
    identityOptions,
    optionalOverrides: generateOptionalFieldOverrides(payload.optionalOverrides || {}),
    keepProcessedJson: Boolean(payload.keepProcessedJson),
    progressCallback,
    uploadOptions: buildUploadOptions(payload),
    archiveBasename,
  };
}

function prepareReferralPrefixOptions(rawOptions = {}) {
  const referralPrefixMode = normalizeReferralPrefixMode(
    rawOptions?.referralPrefixMode,
    rawOptions?.referralPrefix
  );
  const customReferralPrefix = referralPrefixMode === REFERRAL_PREFIX_MODES.CUSTOM
    ? validateCustomReferralPrefix(rawOptions?.customReferralPrefix)
    : "";
  return {
    referralPrefixMode,
    customReferralPrefix,
    referralPrefix: normalizeReferralPrefix(rawOptions?.referralPrefix),
  };
}

function buildGeneratedReferralStart(totalReferrals, now = new Date()) {
  const maxStart = (10 ** REFERRAL_NUMBER_DIGIT_COUNT) - Math.max(Number(totalReferrals) || 1, 1);
  const timeSeed = Number(String(now.getTime()).slice(-REFERRAL_NUMBER_DIGIT_COUNT));
  return String(Math.min(timeSeed, maxStart)).padStart(REFERRAL_NUMBER_DIGIT_COUNT, "0");
}

async function runProcess(payload, emitProgress) {
  const inputDir = (payload.inputDir || "").trim();
  if (!inputDir) {
    throw new Error("Please select a source folder.");
  }

  const args = buildCommonArgs(payload, emitProgress);
  if (!args.outputDir) {
    throw new Error("Please select an output folder.");
  }
  return processFiles(
    inputDir,
    args.outputDir,
    args.replacementCode,
    args.clearOutput,
    args.referralReplacementCode,
    args.patientIdSettings,
    args.listDateOverride,
    args.ssnValue,
    args.optionalOverrides,
    args.keepProcessedJson,
    args.progressCallback,
    args.uploadOptions,
    args.archiveBasename,
    args.identityOptions,
    { appVersion: loadAppVersionInfo().version }
  );
}

async function runGenerate(payload, emitProgress) {
  const fileCount = Number(payload.fileCount || 0);
  const referralsPerFile = Number(payload.referralsPerFile || 0);
  if (fileCount <= 0) {
    throw new Error("Files to generate must be greater than zero.");
  }
  if (referralsPerFile <= 0) {
    throw new Error("Referrals per file must be greater than zero.");
  }
  const limits = getProcessingLimits();
  if (fileCount > limits.maxGeneratedFiles) {
    throw new Error(`Files to generate cannot exceed ${limits.maxGeneratedFiles.toLocaleString()}.`);
  }
  if (referralsPerFile > limits.maxReferralsPerFile) {
    throw new Error(`Referrals per file cannot exceed ${limits.maxReferralsPerFile.toLocaleString()}.`);
  }
  if (fileCount * referralsPerFile > limits.maxGeneratedReferrals) {
    throw new Error(`The generated batch cannot exceed ${limits.maxGeneratedReferrals.toLocaleString()} referrals.`);
  }

  const args = buildCommonArgs(payload, emitProgress);
  if (!args.outputDir) {
    throw new Error("Please select an output folder.");
  }
  if (!args.referralReplacementCode) {
    args.referralReplacementCode = buildGeneratedReferralStart(fileCount * referralsPerFile);
    const generatedNamingPayload = {
      ...payload,
      referralReplacementCode: args.referralReplacementCode,
    };
    args.archiveBasename = buildArchiveBasename(generatedNamingPayload);
    if (payload.archiveNamingOptions?.mode) args.replacementCode = args.archiveBasename;
  }

  let generatedInputDir = "";
  try {
    generatedInputDir = buildGeneratedReferralSources(fileCount, referralsPerFile, args.optionalOverrides);
    return await processFiles(
      generatedInputDir,
      args.outputDir,
      args.replacementCode,
      args.clearOutput,
      args.referralReplacementCode,
      args.patientIdSettings,
      args.listDateOverride,
      args.ssnValue,
      args.optionalOverrides,
      args.keepProcessedJson,
      args.progressCallback,
      args.uploadOptions,
      args.archiveBasename,
      args.identityOptions,
      { appVersion: loadAppVersionInfo().version }
    );
  } finally {
    removePath(generatedInputDir);
  }
}

async function retryFailedUploads(payload, emitProgress) {
  const run = getRun(payload.runId);
  if (!run) throw new Error("The selected run was not found in recent history.");
  if (!run.archivePath || !fs.existsSync(run.archivePath)) {
    throw new Error("The archive for this run is no longer available. Run processing again to create a new archive.");
  }
  const failed = run.uploadResults.filter((item) => item.status === "failed");
  if (failed.length === 0) throw new Error("This run has no failed uploads to retry.");
  assertUploadTargets(run.workflow || "referral", failed.map((item) => ({ server_name: item.serverName })));
  const requested = failed.map((item) => ({
    server_name: item.serverName,
    user_name: item.userName,
    remote_directory: item.remoteDirectory,
  }));
  const resolved = resolveUploadTargets(loadUploadProfiles(), requested);
  const results = [...run.uploadResults.filter((item) => item.status !== "failed")];
  results.push(...await require("./uploader").uploadTargetsSequentially(run.archivePath, resolved, {
    onProgress: (event) => emitProgress?.({
      phase: "upload",
      filename: path.basename(run.archivePath),
      ...event,
      message: event.state === "upload-batch-start"
        ? `Retrying ${event.total} failed upload${event.total === 1 ? "" : "s"} one at a time.`
        : event.message,
    }),
  }));
  const retryable = results.some((item) => item.status === "failed");
  const updatedRun = saveRun({ ...run, status: retryable ? "upload-failed" : "completed", uploadResults: results });
  if (run.manifestPath && fs.existsSync(run.manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(run.manifestPath, "utf8"));
      manifest.uploads = results;
      manifest.status = retryable ? "upload-failed" : "completed";
      manifest.completedAt = new Date().toISOString();
      writeFileAtomic(run.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    } catch (error) {
      throw new Error(`Uploads were retried, but the batch manifest could not be updated: ${error.message}`);
    }
  }
  const remainingFailures = results.filter((item) => item.status === "failed");
  return { message: retryable ? `${remainingFailures.map((item) => item.serverName).join(", ")} still need attention. Check the account, remote directory, or connection, then use Retry Failed Uploads again.` : "Every retried upload completed and the remote file sizes were verified.", run: updatedRun, archivePath: run.archivePath, manifestPath: run.manifestPath, outputDir: run.outputDir, uploadResults: results, retryable };
}

function generateManifest(payload) {
  const run = getRun(payload.runId);
  if (!run?.manifestData) throw new Error("Manifest details are unavailable for this run. Generate a new batch first.");
  const { sha256File } = require("./batchSafety");
  const data = { ...run.manifestData, uploads: run.uploadResults, status: run.status };
  for (const file of [...data.generatedJsonFiles, data.archive]) {
    const target = path.join(run.outputDir, path.basename(file.name));
    if (!fs.existsSync(target) || sha256File(target) !== file.sha256) {
      throw new Error("This batch's files have changed or been removed. Generate the manifest for the latest unchanged batch.");
    }
  }
  const manifestPath = path.join(run.outputDir, `${path.basename(run.archivePath, ".gz")}.manifest.json`);
  writeFileAtomic(manifestPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  const updatedRun = saveRun({ ...run, manifestPath, manifestData: data });
  return { message: "Manifest generated in the output folder.", manifestPath, run: updatedRun };
}

async function runTestUploadTarget(payload) {
  if (payload.resolvedTarget) {
    const resolvedTarget = payload.resolvedTarget;
    const message = await testUploadConnection(resolvedTarget.connection_details, resolvedTarget.remote_directory);
    return { message: `${resolvedTarget.server_name}: ${message}` };
  }
  const target = {
    server_name: (payload.server_name || "").trim(),
    user_name: (payload.user_name || "").trim(),
    remote_directory: (payload.remote_directory || "").trim(),
  };
  const [resolvedTarget] = resolveUploadTargets(loadUploadProfiles(), [target]);
  const message = await testUploadConnection(
    resolvedTarget.connection_details,
    resolvedTarget.remote_directory
  );

  return {
    message: `${resolvedTarget.server_name}: ${message}`,
  };
}

async function handleCommand(command, payload, emitProgress) {
  if (command === "generate-manifest") return generateManifest(payload);
  if (command === "info") {
    return getInfo();
  }
  if (command === "import-upload-source") {
    return {
      importResult: importUploadSourceToConfig((payload.sourcePath || "").trim()),
      info: getInfo(),
    };
  }
  if (command === "save-ui-settings") {
    return {
      uiSettings: saveUiSettings(payload),
    };
  }
  if (command === "export-diagnostics") return exportDiagnosticReport(payload);
  if (command === "acknowledge-release-announcement") {
    const releaseKey = String(payload.releaseKey || "").trim();
    saveReleaseTracker({ acknowledgedReleaseKey: releaseKey });
    return {
      uiSettings: saveUiSettings({
        ...loadUiSettings(),
        acknowledgedReleaseKey: releaseKey,
      }),
    };
  }
  if (command === "inspect-source") {
    return inspectSource(payload);
  }
  if (command === "preview") {
    return buildPreview(payload);
  }
  if (command === "process") {
    return runProcess(payload, emitProgress);
  }
  if (command === "inspect-leie-source") {
    return inspectLeieSourceAsync(payload);
  }
  if (command === "process-leie") {
    return processLeieFiles(payload, emitProgress);
  }
  if (command === "generate") {
    return runGenerate(payload, emitProgress);
  }
  if (command === "test-upload-target") {
    return runTestUploadTarget(payload);
  }
  if (command === "retry-upload") {
    return retryFailedUploads(payload, emitProgress);
  }
  throw new Error(`Unsupported command: ${command}`);
}

module.exports = {
  cleanupRuntimeArtifacts,
  cleanupStaleRuntimeArtifacts,
  handleCommand,
  prepareBackgroundPayload,
};
