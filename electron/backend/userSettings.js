const fs = require("fs");
const { DEFAULT_ARCHIVE_BASENAME } = require("./zipper");
const { bundlePath, dataPath, userDataPath } = require("./appPaths");
const { writeFileAtomic } = require("./atomicFile");

const DEFAULT_UI_SETTINGS = {
  schemaVersion: 4,
  theme: "light",
  mainTab: "referral",
  subTab: "edit",
  optionalFieldsVisible: false,
  acknowledgedReleaseKey: "",
  inputDir: "",
  outputDir: "",
  replacementCode: "",
  archiveBasename: DEFAULT_ARCHIVE_BASENAME,
  archiveAppendNetwork: false,
  archiveAppendReferralDateTime: false,
  useAltFilenamePrefix: false,
  archiveNamingMode: "referral-number",
  archiveCustomValues: ["referralNumber", "customText"],
  archiveCustomText: "DGFP",
  useAltReferralPrefix: false,
  referralPrefixMode: "standard",
  customReferralPrefix: "",
  referralCode: "",
  ssnValue: "999-99-0001",
  randomizeSsn: true,
  randomizeDob: true,
  randomizeFacilityId: false,
  matchSuffixLength: "5",
  patientIdMode: "test-dynamic",
  patientIdCustomValue: "",
  overrideFacilityId: "",
  selectedFacilityIds: [],
  selectedCarePackageKeys: [],
  useAllCarePackages: false,
  selectedSituationalCarePackageKeys: [],
  useAllSituationalCarePackages: false,
  overridePaymentAuthorityCode: "",
  overrideReferralPeriod: "",
  overrideNetwork: "",
  selectedNetworks: [],
  useAllNetworks: false,
  overrideDob: "",
  overrideCarePackageKey: "",
  overrideCarePackageId: "",
  overrideReferralCategory: "",
  overrideReferralDate: "",
  overrideReferralDateTime: "",
  overrideReferralExpirationDate: "",
  overrideReferralLastUpdateDate: "",
  fileCount: "1",
  referralsPerFile: "1",
  clearOutput: false,
  keepProcessedJson: true,
  uploadEnabled: false,
  uploadTargets: {},
  leieDuplicateKey: "full-row",
  leieDuplicateHandling: "manual",
  leieOutputFileName: "",
  leieValidationBatchId: "",
};

function toBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === "") {
    return fallbackValue;
  }
  return Boolean(value);
}

function normalizeUploadTargets(rawValue) {
  const normalized = {};

  for (const [targetName, targetSettings] of Object.entries(rawValue || {})) {
    if (!targetName || !targetSettings || typeof targetSettings !== "object") {
      continue;
    }

    normalized[targetName] = {
      enabled: toBoolean(targetSettings.enabled, false),
      userName: String(targetSettings.userName || targetSettings.user_name || "").trim(),
      remoteDirectory: String(targetSettings.remoteDirectory || targetSettings.remote_directory || "").trim(),
    };
  }

  return normalized;
}

function normalizeArchiveCustomValues(rawValue = {}) {
  const allowedValues = ["referralNumber", "referralPrefix", "networkName", "date", "dateTime", "customText"];
  const suppliedValues = Array.isArray(rawValue.archiveCustomValues)
    ? rawValue.archiveCustomValues
    : [...String(rawValue.archiveCustomPattern || "").matchAll(/\{(referralNumber|referralPrefix|networkName|date|dateTime|customText)\}/g)]
      .map((match) => match[1]);
  const selected = new Set(suppliedValues.map((value) => String(value || "").trim()));
  const normalized = allowedValues.filter((value) => selected.has(value));
  return normalized.length > 0 ? normalized : [...DEFAULT_UI_SETTINGS.archiveCustomValues];
}

function normalizeUiSettings(rawValue = {}) {
  rawValue = { ...rawValue };
  if (["alt", "mixed"].includes(rawValue.referralPrefixMode)) {
    rawValue.customReferralPrefix = rawValue.referralPrefixMode === "alt" ? "ALT" : "RFALT";
    rawValue.referralPrefixMode = "custom";
  }
  if (rawValue.patientIdMode === "test-custom-suffix") {
    rawValue.patientIdMode = "custom-full";
    rawValue.patientIdCustomValue = `TEST${rawValue.patientIdCustomValue || ""}`;
  }
  const normalized = {
    ...DEFAULT_UI_SETTINGS,
    schemaVersion: DEFAULT_UI_SETTINGS.schemaVersion,
    theme:
      String(rawValue.theme || "").trim().toLowerCase() === "dark" ||
      String(rawValue.theme_mode || "").trim().toLowerCase() === "dark"
        ? "dark"
        : "light",
    mainTab: String(rawValue.mainTab || DEFAULT_UI_SETTINGS.mainTab).trim() || DEFAULT_UI_SETTINGS.mainTab,
    subTab: String(rawValue.subTab || DEFAULT_UI_SETTINGS.subTab).trim() || DEFAULT_UI_SETTINGS.subTab,
    optionalFieldsVisible: toBoolean(rawValue.optionalFieldsVisible, DEFAULT_UI_SETTINGS.optionalFieldsVisible),
    acknowledgedReleaseKey: String(
      rawValue.acknowledgedReleaseKey || rawValue.acknowledged_release_key || ""
    ).trim(),
    inputDir: String(rawValue.inputDir || "").trim(),
    outputDir: String(rawValue.outputDir || "").trim(),
    replacementCode: String(rawValue.replacementCode || "").trim(),
    archiveBasename: String(rawValue.archiveBasename || DEFAULT_UI_SETTINGS.archiveBasename).trim() || DEFAULT_UI_SETTINGS.archiveBasename,
    archiveAppendNetwork: toBoolean(rawValue.archiveAppendNetwork, DEFAULT_UI_SETTINGS.archiveAppendNetwork),
    archiveAppendReferralDateTime: toBoolean(
      rawValue.archiveAppendReferralDateTime,
      DEFAULT_UI_SETTINGS.archiveAppendReferralDateTime
    ),
    useAltFilenamePrefix: toBoolean(rawValue.useAltFilenamePrefix, DEFAULT_UI_SETTINGS.useAltFilenamePrefix),
    archiveNamingMode: ["referral-number", "network", "referral-date-time", "custom"].includes(
      String(rawValue.archiveNamingMode || "").trim().toLowerCase()
    )
      ? String(rawValue.archiveNamingMode).trim().toLowerCase()
      : DEFAULT_UI_SETTINGS.archiveNamingMode,
    archiveCustomValues: normalizeArchiveCustomValues(rawValue),
    archiveCustomText: String(rawValue.archiveCustomText || DEFAULT_UI_SETTINGS.archiveCustomText).trim().slice(0, 48),
    useAltReferralPrefix: toBoolean(rawValue.useAltReferralPrefix, DEFAULT_UI_SETTINGS.useAltReferralPrefix),
    referralPrefixMode: ["standard", "alt", "mixed", "custom"].includes(String(rawValue.referralPrefixMode || "").trim().toLowerCase())
      ? String(rawValue.referralPrefixMode).trim().toLowerCase()
      : toBoolean(rawValue.useAltReferralPrefix, DEFAULT_UI_SETTINGS.useAltReferralPrefix)
        ? "alt"
        : DEFAULT_UI_SETTINGS.referralPrefixMode,
    customReferralPrefix: (String(rawValue.customReferralPrefix || "").match(/[A-Za-z0-9_-]/g) || []).join(""),
    referralCode: String(rawValue.referralCode || "").trim(),
    ssnValue: String(rawValue.ssnValue || DEFAULT_UI_SETTINGS.ssnValue).trim() || DEFAULT_UI_SETTINGS.ssnValue,
    randomizeSsn: toBoolean(rawValue.randomizeSsn, DEFAULT_UI_SETTINGS.randomizeSsn),
    randomizeDob: toBoolean(rawValue.randomizeDob, DEFAULT_UI_SETTINGS.randomizeDob),
    randomizeFacilityId: toBoolean(rawValue.randomizeFacilityId, DEFAULT_UI_SETTINGS.randomizeFacilityId),
    matchSuffixLength: ["3", "4", "5"].includes(String(rawValue.matchSuffixLength || ""))
      ? String(rawValue.matchSuffixLength)
      : DEFAULT_UI_SETTINGS.matchSuffixLength,
    patientIdMode: String(rawValue.patientIdMode || DEFAULT_UI_SETTINGS.patientIdMode).trim() || DEFAULT_UI_SETTINGS.patientIdMode,
    patientIdCustomValue: String(rawValue.patientIdCustomValue || "").trim(),
    overrideFacilityId: String(rawValue.overrideFacilityId || "").trim(),
    selectedFacilityIds: [...new Set(
      (Array.isArray(rawValue.selectedFacilityIds) ? rawValue.selectedFacilityIds : [])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
    )],
    selectedCarePackageKeys: [...new Set(
      (Array.isArray(rawValue.selectedCarePackageKeys)
        ? rawValue.selectedCarePackageKeys
        : rawValue.overrideCarePackageKey && rawValue.overrideCarePackageId
          ? [`${encodeURIComponent(String(rawValue.overrideCarePackageKey).trim())}::${encodeURIComponent(String(rawValue.overrideCarePackageId).trim())}`]
          : [])
        .map((value) => String(value || ""))
        .filter(Boolean)
    )],
    useAllCarePackages: toBoolean(rawValue.useAllCarePackages, DEFAULT_UI_SETTINGS.useAllCarePackages),
    selectedSituationalCarePackageKeys: [...new Set(
      (Array.isArray(rawValue.selectedSituationalCarePackageKeys) ? rawValue.selectedSituationalCarePackageKeys : [])
        .map((value) => String(value || ""))
        .filter(Boolean)
    )],
    useAllSituationalCarePackages: toBoolean(
      rawValue.useAllSituationalCarePackages,
      DEFAULT_UI_SETTINGS.useAllSituationalCarePackages
    ),
    overridePaymentAuthorityCode: String(rawValue.overridePaymentAuthorityCode || "").trim(),
    overrideReferralPeriod: String(rawValue.overrideReferralPeriod || "").trim(),
    overrideNetwork: String(rawValue.overrideNetwork || "").trim(),
    selectedNetworks: [...new Set(
      (Array.isArray(rawValue.selectedNetworks)
        ? rawValue.selectedNetworks
        : rawValue.overrideNetwork
          ? [rawValue.overrideNetwork]
          : [])
        .map((value) => String(value || "").trim().toUpperCase())
        .filter((value) => ["NET1", "NET2", "NET3", "NET4", "NET5"].includes(value))
    )],
    useAllNetworks: toBoolean(rawValue.useAllNetworks, DEFAULT_UI_SETTINGS.useAllNetworks),
    overrideDob: String(rawValue.overrideDob || "").trim(),
    overrideCarePackageKey: String(rawValue.overrideCarePackageKey || "").trim(),
    overrideCarePackageId: String(rawValue.overrideCarePackageId || "").trim(),
    overrideReferralCategory: String(rawValue.overrideReferralCategory || "").trim(),
    overrideReferralDate: String(rawValue.overrideReferralDate || "").trim(),
    overrideReferralDateTime: String(rawValue.overrideReferralDateTime || "").trim(),
    overrideReferralExpirationDate: String(rawValue.overrideReferralExpirationDate || "").trim(),
    overrideReferralLastUpdateDate: String(rawValue.overrideReferralLastUpdateDate || "").trim(),
    fileCount: String(rawValue.fileCount || DEFAULT_UI_SETTINGS.fileCount).trim() || DEFAULT_UI_SETTINGS.fileCount,
    referralsPerFile:
      String(rawValue.referralsPerFile || DEFAULT_UI_SETTINGS.referralsPerFile).trim() ||
      DEFAULT_UI_SETTINGS.referralsPerFile,
    clearOutput: toBoolean(rawValue.clearOutput, DEFAULT_UI_SETTINGS.clearOutput),
    keepMasterJson: rawValue.keepMasterJson !== false,
    selectedPaymentCodes: [...new Set((Array.isArray(rawValue.selectedPaymentCodes) ? rawValue.selectedPaymentCodes : [rawValue.overridePaymentAuthorityCode]).map((value) => String(value || "").trim()).filter((value) => require("./paymentAuthorityCatalog").codes.includes(value)))],
    useAllPaymentCodes: rawValue.useAllPaymentCodes !== false && !rawValue.overridePaymentAuthorityCode,
    keepProcessedJson: toBoolean(rawValue.keepProcessedJson, DEFAULT_UI_SETTINGS.keepProcessedJson),
    uploadEnabled: toBoolean(rawValue.uploadEnabled, DEFAULT_UI_SETTINGS.uploadEnabled),
    uploadTargets: normalizeUploadTargets(rawValue.uploadTargets),
    leieDuplicateKey:
      String(rawValue.leieDuplicateKey || DEFAULT_UI_SETTINGS.leieDuplicateKey).trim().toLowerCase() ||
      DEFAULT_UI_SETTINGS.leieDuplicateKey,
    leieDuplicateHandling:
      String(rawValue.leieDuplicateHandling || DEFAULT_UI_SETTINGS.leieDuplicateHandling).trim().toLowerCase() ||
      DEFAULT_UI_SETTINGS.leieDuplicateHandling,
    leieOutputFileName: String(rawValue.leieOutputFileName || "").trim(),
    leieValidationBatchId: String(rawValue.leieValidationBatchId || "").trim(),
  };

  if (!["referral", "leie", "other"].includes(normalized.mainTab)) {
    normalized.mainTab = DEFAULT_UI_SETTINGS.mainTab;
  }
  if (normalized.subTab !== "edit" && normalized.subTab !== "generate") {
    normalized.subTab = DEFAULT_UI_SETTINGS.subTab;
  }
  if (normalized.mainTab !== "referral") {
    normalized.subTab = "edit";
  }

  return normalized;
}

function getUiSettingsPath() {
  return userDataPath("config", "ui_settings.json");
}

function getLegacyUiSettingsPaths() {
  return [
    userDataPath("config", "ui_settings.json"),
    dataPath("config", "ui_settings.json"),
    bundlePath("config", "ui_settings.json"),
  ];
}

function loadUiSettings() {
  for (const filePath of getLegacyUiSettingsPaths()) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return normalizeUiSettings(parsed);
      }
    } catch (_error) {
      // Ignore invalid settings files and continue to the next candidate.
    }
  }

  return { ...DEFAULT_UI_SETTINGS };
}

function saveUiSettings(rawValue = {}) {
  const normalized = normalizeUiSettings(rawValue);
  const payload = {
    ...normalized,
    theme_mode: normalized.theme === "dark" ? "Dark" : "Light",
  };

  writeFileAtomic(getUiSettingsPath(), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return normalized;
}

module.exports = {
  DEFAULT_UI_SETTINGS,
  getUiSettingsPath,
  loadUiSettings,
  normalizeUiSettings,
  saveUiSettings,
};
