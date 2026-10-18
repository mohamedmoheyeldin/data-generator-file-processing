const { codes: paymentCodes, validatePaymentCode, applyPaymentCodes } = require("./paymentAuthorityCatalog");
const fs = require("fs");
const { bundlePath, dataPath } = require("./appPaths");
const { loadFacilityOptions } = require("./facilityCatalog");

function loadMappings() {
  const runtimePath = dataPath("config", "mappings.json");
  if (fs.existsSync(runtimePath)) {
    return JSON.parse(fs.readFileSync(runtimePath, "utf8"));
  }

  const bundledPath = bundlePath("config", "mappings.json");
  if (fs.existsSync(bundledPath)) {
    return JSON.parse(fs.readFileSync(bundledPath, "utf8"));
  }

  throw new Error("Could not find config/mappings.json in either the runtime or bundled app resources.");
}

const LIST_DATE_FORMAT = "YYYY-MM-DD HH:mm:ss";
const SSN_PATTERN = /^999-\d{2}-\d{4}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const OPTIONAL_RANDOM_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const NUMERIC_RANDOM_CHARSET = "0123456789";
const PAYMENT_AUTHORITY_CODE_LENGTH = 5;
const PAYMENT_AUTHORITY_CODE_MAX = 99999;
const PAYMENT_AUTHORITY_CODE_DEFAULT_START = 10000;
const PAYMENT_AUTHORITY_CODE_ERROR_MESSAGE =
  `Payment Authority Code must be a whole number between 0 and ${PAYMENT_AUTHORITY_CODE_MAX}.`;
const REFERRAL_NUMBER_PREFIX = "RF";
const ALT_PREFIX = "ALT";
const RF_ALT_PREFIX = "RFALT";
const REFERRAL_PREFIX_MODES = {
  STANDARD: "standard",
  ALT: "alt",
  MIXED: "mixed",
  CUSTOM: "custom",
};
const REFERRAL_NUMBER_TOTAL_LENGTH = 12;
const REFERRAL_NUMBER_DIGIT_COUNT = REFERRAL_NUMBER_TOTAL_LENGTH - REFERRAL_NUMBER_PREFIX.length;
const PATIENT_ID_TEST_PREFIX = "TEST";
const PATIENT_ID_TOTAL_LENGTH = 17;
const PATIENT_ID_TEST_SUFFIX_LENGTH = PATIENT_ID_TOTAL_LENGTH - PATIENT_ID_TEST_PREFIX.length;
const PATIENT_ID_MODES = {
  TEST_DYNAMIC: "test-dynamic",
  TEST_CUSTOM_SUFFIX: "test-custom-suffix",
  CUSTOM_FULL: "custom-full",
  REFERRAL_MATCH: "referral-match",
};
const RANDOM_SSN_BASE = Math.floor(Math.random() * 1000000);
const RANDOM_DOB_BASE = Math.floor(Math.random() * 24107);
const RANDOM_FACILITY_ASSIGNMENT_STATES = new WeakMap();
const CARE_PACKAGE_ASSIGNMENT_STATES = new WeakMap();
const NETWORK_ASSIGNMENT_STATES = new WeakMap();
const NETWORK_VALUES = Object.freeze(["NET1", "NET2", "NET3", "NET4", "NET5"]);
const TRACKED_JSON_FIELDS = [
  "ssn",
  "dateOfBirth",
  "network",
  "facilityId",
  "carePackageId",
  "carePackageKey",
  "paymentAuthorityCode",
  "category",
  "referralDate",
  "referralDateTime",
  "expirationDate",
  "lastUpdateDate",
  "referralPeriod",
];

const VARIABLE_OVERRIDE_FIELDS = {};

const FIRST_NAMES = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
];
const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas",
];

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function randomFromCharset(charset, length) {
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output += charset[Math.floor(Math.random() * charset.length)];
  }
  return output;
}

function validateSsn(ssnValue) {
  if (!SSN_PATTERN.test((ssnValue || "").trim())) {
    throw new Error("SSN must start with 999 and use the format 999-99-0001.");
  }
}

function validateIsoDate(value, fieldLabel) {
  const normalized = (value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!ISO_DATE_PATTERN.test(normalized)) {
    throw new Error(`${fieldLabel} must use the format YYYY-MM-DD.`);
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldLabel} must be a valid calendar date.`);
  }
  return normalized;
}

function validateIsoDateTime(value, fieldLabel) {
  const normalized = (value || "").trim();
  if (!normalized) {
    return "";
  }
  if (!ISO_DATE_TIME_PATTERN.test(normalized)) {
    throw new Error(`${fieldLabel} must use the format YYYY-MM-DD HH:mm:ss.`);
  }

  const [datePart, timePart] = normalized.split(" ");
  const parsed = new Date(`${datePart}T${timePart}`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldLabel} must be a valid date and time.`);
  }
  return normalized;
}

function normalizeFacilityId(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizePaymentAuthorityCode(value) {
  return ((value || "").trim().match(/\d/g) || []).join("");
}

function normalizeAlphaNumeric(value) {
  return ((value || "").trim().match(/[A-Za-z0-9]/g) || []).join("");
}

function completeWithRandomSuffix(value, targetLength, fillCharacters = OPTIONAL_RANDOM_CHARSET) {
  const normalized = (value || "").trim();
  if (normalized.length >= targetLength) {
    return normalized.slice(0, targetLength);
  }
  return normalized + randomFromCharset(fillCharacters, targetLength - normalized.length);
}

function validateFacilityId(value) {
  const normalized = normalizeFacilityId(value);
  if (!normalized) {
    return "";
  }
  if (!loadFacilityOptions().some((option) => option.facilityKey === normalized)) {
    throw new Error("Facility ID must exactly match a facility_id from the facility reference data.");
  }
  return normalized;
}

function shuffledCopy(values) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function applySelectedCarePackagePairs(data, identityOptions = {}) {
  const regularPairs = Array.isArray(identityOptions.selectedCarePackagePairs) ? identityOptions.selectedCarePackagePairs : [];
  const situationalPairs = Array.isArray(identityOptions.selectedSituationalCarePackagePairs)
    ? identityOptions.selectedSituationalCarePackagePairs
    : [];
  if (regularPairs.length === 0 && situationalPairs.length === 0) return;

  let assignmentState = CARE_PACKAGE_ASSIGNMENT_STATES.get(identityOptions);
  if (!assignmentState) {
    assignmentState = {
      regularPairs: shuffledCopy(regularPairs),
      situationalPairs: shuffledCopy(situationalPairs),
      referralIndex: 0,
    };
    CARE_PACKAGE_ASSIGNMENT_STATES.set(identityOptions, assignmentState);
  }

  function apply(currentData) {
    if (Array.isArray(currentData)) {
      currentData.forEach(apply);
      return;
    }
    if (!currentData || typeof currentData !== "object") return;

    const isAuthority = Object.prototype.hasOwnProperty.call(currentData, "carePackageKey") ||
      Object.prototype.hasOwnProperty.call(currentData, "carePackageId");
    if (isAuthority) {
      const index = assignmentState.referralIndex;
      if (assignmentState.regularPairs.length > 0) {
        const pair = assignmentState.regularPairs[index % assignmentState.regularPairs.length];
        currentData.carePackageKey = pair.carePackageKey;
        currentData.carePackageId = pair.carePackageId;
      }
      if (assignmentState.situationalPairs.length > 0) {
        const pair = assignmentState.situationalPairs[index % assignmentState.situationalPairs.length];
        currentData.situationalCarePackageKey = pair.carePackageKey;
        currentData.situationalCarePackageId = pair.carePackageId;
      }
      assignmentState.referralIndex += 1;
      return;
    }
    Object.values(currentData).forEach(apply);
  }

  apply(data);
}

function applySelectedNetworks(data, identityOptions = {}) {
  const requestedValues = Array.isArray(identityOptions.selectedNetworks)
    ? identityOptions.selectedNetworks.map((value) => String(value || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const selectedNetworks = [...new Set(requestedValues)];
  const invalidNetwork = selectedNetworks.find((value) => !NETWORK_VALUES.includes(value));
  if (invalidNetwork) {
    throw new Error(`Selected Network ${invalidNetwork} is not available. Choose NET1, NET2, NET3, NET4, or NET5.`);
  }
  if (selectedNetworks.length === 0) return;

  let assignmentState = NETWORK_ASSIGNMENT_STATES.get(identityOptions);
  if (!assignmentState) {
    assignmentState = { values: shuffledCopy(selectedNetworks), referralIndex: 0 };
    NETWORK_ASSIGNMENT_STATES.set(identityOptions, assignmentState);
  }

  function apply(currentData) {
    if (Array.isArray(currentData)) {
      currentData.forEach(apply);
      return;
    }
    if (!currentData || typeof currentData !== "object") return;
    if (Object.prototype.hasOwnProperty.call(currentData, "network")) {
      currentData.network = assignmentState.values[assignmentState.referralIndex % assignmentState.values.length];
      assignmentState.referralIndex += 1;
    }
    Object.values(currentData).forEach(apply);
  }

  apply(data);
}

function generateRandomSsn(sequenceIndex = 1) {
  const offset = Math.max(sequenceIndex - 1, 0);
  const generatedSuffix = String((RANDOM_SSN_BASE + offset) % 1000000).padStart(6, "0");
  const digits = `999${generatedSuffix}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function generateRandomDob(sequenceIndex = 1) {
  const firstDay = Date.UTC(1940, 0, 1);
  const lastDay = Date.UTC(2005, 11, 31);
  const dayCount = Math.floor((lastDay - firstDay) / 86400000) + 1;
  const dayOffset = (RANDOM_DOB_BASE + Math.max(sequenceIndex - 1, 0)) % dayCount;
  return new Date(firstDay + dayOffset * 86400000).toISOString().slice(0, 10);
}

function validatePaymentAuthorityCode(value) { return validatePaymentCode(value); }


function validatePatientIdSettings(rawSettings = {}) {
  const requestedMode = String(rawSettings.mode || PATIENT_ID_MODES.TEST_DYNAMIC).trim();
  const mode = Object.values(PATIENT_ID_MODES).includes(requestedMode) ? requestedMode : PATIENT_ID_MODES.TEST_DYNAMIC;

  if (mode === PATIENT_ID_MODES.TEST_DYNAMIC) {
    return {
      mode,
      value: "",
    };
  }

  if (mode === PATIENT_ID_MODES.REFERRAL_MATCH) {
    return { mode, value: "" };
  }

  if (mode === PATIENT_ID_MODES.TEST_CUSTOM_SUFFIX) {
    const normalizedValue = normalizeAlphaNumeric(rawSettings.value || "");
    if (!normalizedValue) {
      throw new Error(`Enter up to ${PATIENT_ID_TEST_SUFFIX_LENGTH} letters or numbers after ${PATIENT_ID_TEST_PREFIX}.`);
    }
    if (normalizedValue.length > PATIENT_ID_TEST_SUFFIX_LENGTH) {
      throw new Error(`Enter up to ${PATIENT_ID_TEST_SUFFIX_LENGTH} letters or numbers after ${PATIENT_ID_TEST_PREFIX}.`);
    }
    return {
      mode,
      value: normalizedValue,
    };
  }

  const normalizedValue = normalizeAlphaNumeric(rawSettings.value || "");
  if (!normalizedValue) {
    throw new Error(`Enter up to ${PATIENT_ID_TOTAL_LENGTH} letters or numbers for the full Patient ID.`);
  }
  if (normalizedValue.length > PATIENT_ID_TOTAL_LENGTH) {
    throw new Error(`Enter up to ${PATIENT_ID_TOTAL_LENGTH} letters or numbers for the full Patient ID.`);
  }

  return {
    mode: PATIENT_ID_MODES.CUSTOM_FULL,
    value: normalizedValue,
  };
}

function preparePatientIdSettings(rawSettings = {}) {
  const validatedSettings = validatePatientIdSettings(rawSettings);

  if (validatedSettings.mode === PATIENT_ID_MODES.TEST_DYNAMIC) {
    return {
      mode: validatedSettings.mode,
      baseValue: randomFromCharset(NUMERIC_RANDOM_CHARSET, PATIENT_ID_TEST_SUFFIX_LENGTH),
    };
  }

  if (validatedSettings.mode === PATIENT_ID_MODES.REFERRAL_MATCH) {
    return { mode: validatedSettings.mode, baseValue: "" };
  }

  if (validatedSettings.mode === PATIENT_ID_MODES.TEST_CUSTOM_SUFFIX) {
    return {
      mode: validatedSettings.mode,
      baseValue: completeWithRandomSuffix(
        validatedSettings.value,
        PATIENT_ID_TEST_SUFFIX_LENGTH,
        OPTIONAL_RANDOM_CHARSET
      ),
    };
  }

  return {
    mode: validatedSettings.mode,
    baseValue: completeWithRandomSuffix(validatedSettings.value, PATIENT_ID_TOTAL_LENGTH),
  };
}

function describePatientIdPreview(rawSettings = {}) {
  const validatedSettings = validatePatientIdSettings(rawSettings);

  if (validatedSettings.mode === PATIENT_ID_MODES.TEST_DYNAMIC) {
    return `Preview: ${PATIENT_ID_TEST_PREFIX}${"0".repeat(PATIENT_ID_TEST_SUFFIX_LENGTH - 1)}1 (generated digits vary)`;
  }

  if (validatedSettings.mode === PATIENT_ID_MODES.REFERRAL_MATCH) {
    return `Preview: ${PATIENT_ID_TEST_PREFIX} + the Referral Number after its prefix`;
  }

  if (validatedSettings.mode === PATIENT_ID_MODES.TEST_CUSTOM_SUFFIX) {
    const remaining = PATIENT_ID_TEST_SUFFIX_LENGTH - validatedSettings.value.length;
    const exampleValue = `${PATIENT_ID_TEST_PREFIX}${validatedSettings.value}${"0".repeat(Math.max(remaining, 0))}`;
    return remaining > 0 ? `Preview: ${exampleValue} (generated characters vary)` : `Preview: ${exampleValue}`;
  }

  const remaining = PATIENT_ID_TOTAL_LENGTH - validatedSettings.value.length;
  const exampleValue = `${validatedSettings.value}${"0".repeat(Math.max(remaining, 0))}`;
  return remaining > 0 ? `Preview: ${exampleValue} (generated characters vary)` : `Preview: ${exampleValue}`;
}

function generatePatientIdValue(patientIdSettings, sequenceIndex) {
  if (!patientIdSettings || !patientIdSettings.mode) {
    patientIdSettings = preparePatientIdSettings();
  }

  if (patientIdSettings.mode === PATIENT_ID_MODES.CUSTOM_FULL) {
    return generateUniqueFieldValue(
      patientIdSettings.baseValue,
      sequenceIndex,
      PATIENT_ID_TOTAL_LENGTH,
      OPTIONAL_RANDOM_CHARSET
    );
  }

  if (patientIdSettings.mode === PATIENT_ID_MODES.REFERRAL_MATCH) {
    return `${PATIENT_ID_TEST_PREFIX}${String(sequenceIndex || 1).padStart(13, "0")}`;
  }

  return `${PATIENT_ID_TEST_PREFIX}${generateUniqueFieldValue(
    patientIdSettings.baseValue,
    sequenceIndex,
    PATIENT_ID_TEST_SUFFIX_LENGTH,
    patientIdSettings.mode === PATIENT_ID_MODES.TEST_CUSTOM_SUFFIX ? OPTIONAL_RANDOM_CHARSET : NUMERIC_RANDOM_CHARSET
  )}`;
}

function generatePaymentAuthorityCodeValue(baseValue) { return validatePaymentCode(baseValue) || paymentCodes[0]; }


function generateOptionalFieldOverrides(rawOverrides) {
  const overrides = {};
  for (const [key, rawValue] of Object.entries(rawOverrides || {})) {
    const normalizedValue = (rawValue || "").trim();
    if (key !== "facilityId" && key !== "paymentAuthorityCode" && normalizedValue) {
      overrides[key] = normalizedValue;
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawOverrides || {}, "facilityId")) {
    overrides.facilityId = validateFacilityId(rawOverrides.facilityId || "");
  }
  if (Object.prototype.hasOwnProperty.call(rawOverrides || {}, "paymentAuthorityCode")) {
    overrides.paymentAuthorityCode = validatePaymentAuthorityCode(rawOverrides.paymentAuthorityCode || "");
  }
  if (Object.prototype.hasOwnProperty.call(rawOverrides || {}, "dateOfBirth")) {
    overrides.dateOfBirth = validateIsoDate(rawOverrides.dateOfBirth || "", "Date of Birth");
  }
  if (Object.prototype.hasOwnProperty.call(rawOverrides || {}, "referralDate")) {
    overrides.referralDate = validateIsoDate(rawOverrides.referralDate || "", "Referral Date");
  }
  if (Object.prototype.hasOwnProperty.call(rawOverrides || {}, "referralDateTime")) {
    overrides.referralDateTime = validateIsoDateTime(rawOverrides.referralDateTime || "", "Referral DateTime");
  }
  if (Object.prototype.hasOwnProperty.call(rawOverrides || {}, "expirationDate")) {
    overrides.expirationDate = validateIsoDate(
      rawOverrides.expirationDate || "",
      "Referral Expiration Date"
    );
  }
  if (Object.prototype.hasOwnProperty.call(rawOverrides || {}, "lastUpdateDate")) {
    overrides.lastUpdateDate = validateIsoDate(
      rawOverrides.lastUpdateDate || "",
      "Referral Last Update Date"
    );
  }
  return overrides;
}

function normalizeReferralPrefix(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === REFERRAL_NUMBER_PREFIX.toLowerCase()) {
    return REFERRAL_NUMBER_PREFIX;
  }
  if (normalized.toLowerCase() === ALT_PREFIX.toLowerCase()) {
    return ALT_PREFIX;
  }
  if (normalized.toLowerCase() === RF_ALT_PREFIX.toLowerCase()) {
    return RF_ALT_PREFIX;
  }
  const customPrefix = (normalized.match(/[A-Za-z0-9_-]/g) || []).join("");
  return customPrefix || REFERRAL_NUMBER_PREFIX;
}

function validateCustomReferralPrefix(value) {
  const rawValue = String(value || "").trim();
  const normalized = (rawValue.match(/[A-Za-z0-9_-]/g) || []).join("");
  if (!normalized) {
    throw new Error("Enter a custom Referral Number prefix using letters, numbers, hyphens, or underscores.");
  }
  if (normalized !== rawValue) {
    throw new Error("Custom Referral Number prefix must use only letters, numbers, hyphens, or underscores.");
  }
  return normalized;
}

function normalizeReferralPrefixMode(value, legacyPrefix = REFERRAL_NUMBER_PREFIX) {
  const normalized = String(value || "").trim().toLowerCase();
  if (Object.values(REFERRAL_PREFIX_MODES).includes(normalized)) return normalized;
  return String(legacyPrefix || "").trim().toLowerCase() === ALT_PREFIX.toLowerCase()
    ? REFERRAL_PREFIX_MODES.ALT
    : REFERRAL_PREFIX_MODES.STANDARD;
}

function resolveReferralPrefix(options = {}, sequenceIndex = 1) {
  if (typeof options === "string") return normalizeReferralPrefix(options);
  const mode = normalizeReferralPrefixMode(options.referralPrefixMode, options.referralPrefix);
  if (mode === REFERRAL_PREFIX_MODES.ALT) return ALT_PREFIX;
  if (mode === REFERRAL_PREFIX_MODES.MIXED) return RF_ALT_PREFIX;
  if (mode === REFERRAL_PREFIX_MODES.CUSTOM) return validateCustomReferralPrefix(options.customReferralPrefix);
  return REFERRAL_NUMBER_PREFIX;
}

function stripReferralPrefix(value, additionalPrefixes = []) {
  const normalized = String(value || "").trim();
  const prefixes = [...new Set([
    ...additionalPrefixes.map((prefix) => normalizeReferralPrefix(prefix)),
    RF_ALT_PREFIX,
    ALT_PREFIX,
    REFERRAL_NUMBER_PREFIX,
  ])].sort((left, right) => right.length - left.length);
  for (const prefix of prefixes) {
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      return normalized.slice(prefix.length);
    }
  }
  return normalized;
}

function generatePatientIdFromReferralNumber(referralNumber, referralPrefixes = [], sequenceIndex = 1) {
  const body = (stripReferralPrefix(referralNumber, referralPrefixes).match(/[A-Za-z0-9]/g) || []).join("").toUpperCase();
  if (!body) {
    throw new Error("Referral Number is required to generate its matching Patient ID.");
  }
  const sequenceMarker = Math.max(Number(sequenceIndex) || 1, 1).toString(36).toUpperCase().slice(-PATIENT_ID_TEST_SUFFIX_LENGTH);
  const formattedBody = body.length <= PATIENT_ID_TEST_SUFFIX_LENGTH
    ? body.padStart(PATIENT_ID_TEST_SUFFIX_LENGTH, "0")
    : `${body.slice(0, PATIENT_ID_TEST_SUFFIX_LENGTH - sequenceMarker.length)}${sequenceMarker}`;
  return `${PATIENT_ID_TEST_PREFIX}${formattedBody}`;
}

function normalizeReferralNumberStart(value, requestedPrefix = REFERRAL_NUMBER_PREFIX) {
  const prefix = normalizeReferralPrefix(requestedPrefix);
  let normalized = (value || "").trim();
  if (!normalized) {
    return "";
  }

  normalized = stripReferralPrefix(normalized, [prefix]);

  normalized = ((normalized || "").match(/[A-Za-z0-9_-]/g) || []).join("");
  if (!normalized) {
    return "";
  }

  return `${prefix}${/^\d+$/.test(normalized) ? normalized.padStart(REFERRAL_NUMBER_DIGIT_COUNT, "0") : normalized}`;
}

function validateReferralNumberStart(value, requestedPrefix = REFERRAL_NUMBER_PREFIX) {
  const prefix = normalizeReferralPrefix(requestedPrefix);
  const normalized = normalizeReferralNumberStart(value, prefix);
  if (!normalized) {
    throw new Error("Enter a Referral Number body using letters, numbers, hyphens, or underscores.");
  }

  return normalized;
}

function generateReferralNumber(startValue, sequenceIndex, requestedPrefix = REFERRAL_NUMBER_PREFIX) {
  const prefix = normalizeReferralPrefix(requestedPrefix);
  const normalizedStart = validateReferralNumberStart(startValue, prefix);
  const normalizedBody = normalizedStart.slice(prefix.length);
  const offset = BigInt(Math.max((sequenceIndex || 1) - 1, 0));

  if (/^\d+$/.test(normalizedBody)) {
    const generatedNumber = BigInt(normalizedBody) + offset;
    return `${prefix}${String(generatedNumber).padStart(normalizedBody.length, "0")}`;
  }

  const suffixMatch = normalizedBody.match(/(\d+)$/);
  if (suffixMatch) {
    const suffixDigits = suffixMatch[1];
    const prefixPart = normalizedBody.slice(0, -suffixDigits.length);
    const incrementedSuffix = String(BigInt(suffixDigits) + offset).padStart(suffixDigits.length, "0");
    return `${prefix}${prefixPart}${incrementedSuffix}`;
  }

  if ((sequenceIndex || 1) === 1) {
    return `${prefix}${normalizedBody}`;
  }

  return `${prefix}${normalizedBody}${Math.max(sequenceIndex || 1, 1)}`;
}

function encodeSequenceValue(number, charset) {
  if (number <= 0) {
    return charset[0];
  }

  const base = charset.length;
  let current = number;
  const encoded = [];
  while (current > 0) {
    const remainder = current % base;
    current = Math.floor(current / base);
    encoded.push(charset[remainder]);
  }
  return encoded.reverse().join("");
}

function generateUniqueFieldValue(baseValue, sequenceIndex, totalLength, charset) {
  let normalized = (baseValue || "").trim();
  if (!normalized) {
    normalized = randomFromCharset(charset, totalLength);
  }
  normalized = normalized.slice(0, totalLength);

  if ((sequenceIndex || 1) <= 1) {
    return normalized;
  }

  let sequenceOffset = (sequenceIndex || 1) - 1;
  while (true) {
    const suffix = encodeSequenceValue(sequenceOffset, charset);
    const candidate =
      suffix.length >= totalLength
        ? suffix.slice(-totalLength)
        : `${normalized.slice(0, totalLength - suffix.length)}${suffix}`;
    if (candidate !== normalized) {
      return candidate;
    }
    sequenceOffset += 1;
  }
}

function getFacilityIdSequenceCharset(baseValue) {
  const normalized = normalizeFacilityId(baseValue);
  const lastChar = normalized.slice(-1);
  if (/[A-Za-z]/.test(lastChar)) {
    return NUMERIC_RANDOM_CHARSET;
  }
  if (/\d/.test(lastChar)) {
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  }
  return OPTIONAL_RANDOM_CHARSET;
}

function getVariableFieldSequenceCharset(key, baseValue) {
  if (key === "facilityId") {
    return getFacilityIdSequenceCharset(baseValue);
  }
  return VARIABLE_OVERRIDE_FIELDS[key].charset;
}

function updatePatientIdentity(data, ssnValue, patientIdSettings = preparePatientIdSettings(), sequenceStart = 1, identityOptions = {}) {
  let replacementsUsed = 0;

  if (Array.isArray(data)) {
    for (const item of data) {
      replacementsUsed += updatePatientIdentity(item, ssnValue, patientIdSettings, sequenceStart + replacementsUsed, identityOptions);
    }
    return replacementsUsed;
  }

  if (!data || typeof data !== "object") {
    return replacementsUsed;
  }

  if (["patientId", "firstName", "lastName", "ssn"].every((key) => Object.prototype.hasOwnProperty.call(data, key))) {
    data.patientId = generatePatientIdValue(patientIdSettings, sequenceStart + replacementsUsed);
    data.firstName = randomChoice(FIRST_NAMES);
    data.lastName = randomChoice(LAST_NAMES);
    if (Object.prototype.hasOwnProperty.call(data, "middleName")) {
      data.middleName = randomChoice("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    }
    const identityIndex = sequenceStart + replacementsUsed;
    data.ssn = identityOptions.randomizeSsn ? generateRandomSsn(identityIndex) : ssnValue;
    if (identityOptions.randomizeDob && Object.prototype.hasOwnProperty.call(data, "dateOfBirth")) {
      data.dateOfBirth = generateRandomDob(identityIndex);
    }
    replacementsUsed += 1;
  }

  for (const value of Object.values(data)) {
    replacementsUsed += updatePatientIdentity(value, ssnValue, patientIdSettings, sequenceStart + replacementsUsed, identityOptions);
  }

  return replacementsUsed;
}

function applyOptionalOverrides(data, overrides) {
  const variableOverrideCounts = {};
  const variableOverrideUsedValues = {};
  for (const key of Object.keys(VARIABLE_OVERRIDE_FIELDS)) {
    variableOverrideCounts[key] = 0;
    variableOverrideUsedValues[key] = new Set();
  }

  function apply(currentData) {
    if (Array.isArray(currentData)) {
      for (const item of currentData) {
        apply(item);
      }
      return;
    }

    if (!currentData || typeof currentData !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(currentData)) {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) {
        if (key === "facilityId") {
          currentData[key] = overrides[key];
        } else if (VARIABLE_OVERRIDE_FIELDS[key]) {
          while (true) {
            variableOverrideCounts[key] += 1;
            const candidateValue =
              key === "paymentAuthorityCode"
                ? generatePaymentAuthorityCodeValue(overrides[key], variableOverrideCounts[key])
                : generateUniqueFieldValue(
                    overrides[key],
                    variableOverrideCounts[key],
                    VARIABLE_OVERRIDE_FIELDS[key].length,
                    getFacilityIdSequenceCharset(overrides[key])
                  );

            if (!variableOverrideUsedValues[key].has(candidateValue)) {
              variableOverrideUsedValues[key].add(candidateValue);
              currentData[key] = candidateValue;
              break;
            }
          }
        } else {
          currentData[key] = overrides[key];
        }
      } else {
        apply(value);
      }
    }
  }

  apply(data);
}

function applyRandomValidFacilityIds(data, identityOptions = {}) {
  const selectedFacilityIds = Array.isArray(identityOptions.selectedFacilityIds)
    ? identityOptions.selectedFacilityIds.map(normalizeFacilityId).filter(Boolean)
    : [];
  const referenceFacilityIds = new Set(loadFacilityOptions().map((option) => option.facilityKey));
  const invalidSelection = selectedFacilityIds.find((facilityId) => !referenceFacilityIds.has(facilityId));
  if (invalidSelection) {
    throw new Error(`Selected Facility ID ${invalidSelection} does not match the facility reference data.`);
  }
  const facilityOptions = selectedFacilityIds.length > 0
    ? [...new Set(selectedFacilityIds)].map((facilityKey) => ({ facilityKey }))
    : loadFacilityOptions();
  if (facilityOptions.length === 0) {
    throw new Error("No valid Facility IDs are available in the reference list.");
  }

  let assignmentState = RANDOM_FACILITY_ASSIGNMENT_STATES.get(identityOptions);
  if (!assignmentState) {
    const facilityKeys = facilityOptions.map((option) => option.facilityKey);
    for (let index = facilityKeys.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [facilityKeys[index], facilityKeys[swapIndex]] = [
        facilityKeys[swapIndex],
        facilityKeys[index],
      ];
    }
    assignmentState = { facilityKeys, facilityIndex: 0 };
    RANDOM_FACILITY_ASSIGNMENT_STATES.set(identityOptions, assignmentState);
  }
  const shuffledFacilityKeys = assignmentState.facilityKeys;
  const validFacilityKeys = new Set(shuffledFacilityKeys);
  let facilityIndex = assignmentState.facilityIndex;

  function apply(currentData) {
    if (Array.isArray(currentData)) {
      currentData.forEach(apply);
      return;
    }
    if (!currentData || typeof currentData !== "object") return;
    for (const [key, value] of Object.entries(currentData)) {
      if (key === "facilityId") {
        const facilityKey = shuffledFacilityKeys[facilityIndex % shuffledFacilityKeys.length];
        if (!validFacilityKeys.has(facilityKey)) {
          throw new Error("Generated Facility ID did not match the reference list.");
        }
        currentData[key] = facilityKey;
        facilityIndex += 1;
        assignmentState.facilityIndex = facilityIndex;
      } else {
        apply(value);
      }
    }
  }
  apply(data);
}

// A referral record carries its number directly (flat source files) or in its "referral" group (generated files).
function recordReferralNumber(node) {
  if (typeof node.referralNumber === "string") return node.referralNumber;
  if (node.referral && typeof node.referral === "object" && typeof node.referral.referralNumber === "string") {
    return node.referral.referralNumber;
  }
  return null;
}

function alignPatientIdsWithReferralNumbers(data, referralPrefixes = [], sequenceStart = 1) {
  const usedPatientIds = new Set();
  let sequenceIndex = Math.max(Number(sequenceStart) || 1, 1);

  function makeUniquePatientId(referralNumber) {
    let attempt = sequenceIndex;
    let candidate = generatePatientIdFromReferralNumber(referralNumber, referralPrefixes, attempt);
    while (usedPatientIds.has(candidate)) {
      attempt += 1;
      const marker = attempt.toString(36).toUpperCase().slice(-PATIENT_ID_TEST_SUFFIX_LENGTH);
      candidate = `${candidate.slice(0, PATIENT_ID_TOTAL_LENGTH - marker.length)}${marker}`;
    }
    usedPatientIds.add(candidate);
    sequenceIndex += 1;
    return candidate;
  }

  function replaceNestedPatientIds(currentData, matchingPatientId) {
    if (Array.isArray(currentData)) {
      currentData.forEach((item) => replaceNestedPatientIds(item, matchingPatientId));
      return;
    }
    if (!currentData || typeof currentData !== "object") return;
    for (const [key, value] of Object.entries(currentData)) {
      if (key === "patientId" && (typeof value === "string" || typeof value === "number")) {
        currentData[key] = matchingPatientId;
      } else {
        replaceNestedPatientIds(value, matchingPatientId);
      }
    }
  }

  function visit(currentData) {
    if (Array.isArray(currentData)) return currentData.forEach(visit);
    if (!currentData || typeof currentData !== "object") return;
    const referralNumber = recordReferralNumber(currentData);
    if (referralNumber !== null) {
      replaceNestedPatientIds(currentData, makeUniquePatientId(referralNumber));
      return;
    }
    Object.values(currentData).forEach(visit);
  }

  visit(data);
}

function alignReferralAndPatientIdSuffixes(data, suffixLength) {
  const length = Number(suffixLength || 0);
  if (![3, 4, 5].includes(length)) return;
  const usedPatientIds = new Set();

  function replacePatientIdSuffix(currentData, suffix) {
    if (Array.isArray(currentData)) return currentData.forEach((item) => replacePatientIdSuffix(item, suffix));
    if (!currentData || typeof currentData !== "object") return;
    for (const [key, value] of Object.entries(currentData)) {
      if (key === "patientId" && typeof value === "string") {
        const prefix = value.slice(0, Math.max(0, value.length - length));
        let candidate = `${prefix}${suffix}`;
        let attempt = 0;
        while (usedPatientIds.has(candidate) && prefix.length > 0) {
          const marker = OPTIONAL_RANDOM_CHARSET[attempt % OPTIONAL_RANDOM_CHARSET.length];
          candidate = `${prefix.slice(0, -1)}${marker}${suffix}`;
          attempt += 1;
        }
        usedPatientIds.add(candidate);
        currentData[key] = candidate;
      } else {
        replacePatientIdSuffix(value, suffix);
      }
    }
  }

  function visit(currentData) {
    if (Array.isArray(currentData)) return currentData.forEach(visit);
    if (!currentData || typeof currentData !== "object") return;
    const referralNumber = recordReferralNumber(currentData);
    if (referralNumber !== null) {
      replacePatientIdSuffix(currentData, referralNumber.slice(-length));
      return;
    }
    Object.values(currentData).forEach(visit);
  }
  visit(data);
}

function ensureSourceVariableFieldsAreUnique(data, overrides = {}) {
  const usedValues = {};
  const duplicateCounts = {};
  for (const key of Object.keys(VARIABLE_OVERRIDE_FIELDS)) {
    usedValues[key] = new Set();
    duplicateCounts[key] = new Map();
  }

  function apply(currentData) {
    if (Array.isArray(currentData)) {
      for (const item of currentData) {
        apply(item);
      }
      return;
    }

    if (!currentData || typeof currentData !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(currentData)) {
      if (VARIABLE_OVERRIDE_FIELDS[key] && !Object.prototype.hasOwnProperty.call(overrides, key)) {
        const settings = VARIABLE_OVERRIDE_FIELDS[key];
        const baseValue = typeof value === "string" || typeof value === "number" ? String(value) : "";
        if (key === "paymentAuthorityCode") {
          validatePaymentAuthorityCode(baseValue);
        }
        const duplicateIndex = (duplicateCounts[key].get(baseValue) || 0) + 1;
        duplicateCounts[key].set(baseValue, duplicateIndex);

        if (!usedValues[key].has(baseValue)) {
          usedValues[key].add(baseValue);
          continue;
        }

        let sequenceIndex = Math.max(duplicateIndex, 2);
        while (true) {
          const candidateValue =
            key === "paymentAuthorityCode"
              ? generatePaymentAuthorityCodeValue(baseValue, sequenceIndex)
              : generateUniqueFieldValue(
                  baseValue,
                  sequenceIndex,
                  settings.length,
                  getVariableFieldSequenceCharset(key, baseValue)
                );
          if (!usedValues[key].has(candidateValue)) {
            usedValues[key].add(candidateValue);
            currentData[key] = candidateValue;
            break;
          }
          sequenceIndex += 1;
        }
      } else {
        apply(value);
      }
    }
  }

  apply(data);
}

function applyReferralNumberOverride(data, startValue, sequenceStart = 1, referralPrefixOptions = REFERRAL_NUMBER_PREFIX) {
  let replacementsUsed = 0;

  if (Array.isArray(data)) {
    for (const item of data) {
      replacementsUsed += applyReferralNumberOverride(item, startValue, sequenceStart + replacementsUsed, referralPrefixOptions);
    }
    return replacementsUsed;
  }

  if (!data || typeof data !== "object") {
    return replacementsUsed;
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === "referralNumber" && (typeof value !== "object" || value === null)) {
      const currentSequence = sequenceStart + replacementsUsed;
      data[key] = generateReferralNumber(
        startValue,
        currentSequence,
        resolveReferralPrefix(referralPrefixOptions, currentSequence)
      );
      replacementsUsed += 1;
    } else {
      replacementsUsed += applyReferralNumberOverride(value, startValue, sequenceStart + replacementsUsed, referralPrefixOptions);
    }
  }

  return replacementsUsed;
}

function extractFirstValues(data, defaults) {
  if (Array.isArray(data)) {
    for (const item of data) {
      extractFirstValues(item, defaults);
    }
    return;
  }

  if (!data || typeof data !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(data)) {
    if (Object.prototype.hasOwnProperty.call(defaults, key) && defaults[key] === "" && (typeof value !== "object" || value === null)) {
      defaults[key] = String(value);
    }
    extractFirstValues(value, defaults);
  }
}

function extractJsonChangeDefaults(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const defaults = Object.fromEntries(TRACKED_JSON_FIELDS.map((fieldName) => [fieldName, ""]));
  defaults.referralNumber = "";
  extractFirstValues(data, defaults);

  if (defaults.referralNumber) {
    const normalizedReferral = normalizeReferralNumberStart(defaults.referralNumber);
    if (normalizedReferral) {
      defaults.referralNumber = normalizedReferral.slice(REFERRAL_NUMBER_PREFIX.length);
    }
  }

  return defaults;
}

function extractListDate(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/"listDate"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

function modifyContent(
  filePath,
  referralReplacementCode,
  listDateOverride,
  ssnValue,
  _fileIndex,
  _totalFiles,
  optionalOverrides,
  referralSequenceStart = 1,
  patientIdSettings = preparePatientIdSettings(),
  patientIdSequenceStart = 1,
  identityOptions = {}
) {
  const mappings = loadMappings();
  let content = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(mappings)) {
    content = content.split(key).join(value);
  }

  if (listDateOverride) {
    content = content.replace(/("listDate"\s*:\s*")([^"]+)(")/g, `$1${listDateOverride}$3`);
  }

  if (!identityOptions.randomizeSsn) validateSsn(ssnValue);
  const data = JSON.parse(content);
  let referralNumbersUsed = 0;
  if (referralReplacementCode) {
    referralNumbersUsed = applyReferralNumberOverride(
      data,
      referralReplacementCode,
      referralSequenceStart,
      identityOptions
    );
  }
  const patientIdentitiesUsed = updatePatientIdentity(data, ssnValue.trim(), patientIdSettings, patientIdSequenceStart, identityOptions);
  if (optionalOverrides && Object.keys(optionalOverrides).length > 0) {
    applyOptionalOverrides(data, optionalOverrides);
  }
  if (identityOptions.randomizeFacilityId || identityOptions.selectedFacilityIds?.length || !optionalOverrides?.facilityId) {
    applyRandomValidFacilityIds(data, identityOptions);
  }
  applySelectedNetworks(data, identityOptions);
  applySelectedCarePackagePairs(data, identityOptions);
  if (patientIdSettings.mode === PATIENT_ID_MODES.REFERRAL_MATCH) {
    const referralPrefixes = [
      resolveReferralPrefix(identityOptions, 1),
      resolveReferralPrefix(identityOptions, 2),
    ];
    alignPatientIdsWithReferralNumbers(data, referralPrefixes, patientIdSequenceStart);
  } else {
    alignReferralAndPatientIdSuffixes(data, identityOptions.matchSuffixLength);
  }
  applyPaymentCodes(data, identityOptions, optionalOverrides?.paymentAuthorityCode);

  return {
    content: JSON.stringify(data, null, 4),
    referralNumbersUsed,
    patientIdentitiesUsed,
  };
}

module.exports = {
  PATIENT_ID_MODES,
  PATIENT_ID_TEST_PREFIX,
  PATIENT_ID_TEST_SUFFIX_LENGTH,
  PATIENT_ID_TOTAL_LENGTH,
  ALT_PREFIX,
  LIST_DATE_FORMAT,
  PAYMENT_AUTHORITY_CODE_LENGTH,
  PAYMENT_AUTHORITY_CODE_MAX,
  REFERRAL_NUMBER_DIGIT_COUNT,
  REFERRAL_NUMBER_PREFIX,
  REFERRAL_PREFIX_MODES,
  NETWORK_VALUES,
  applySelectedNetworks,
  completeWithRandomSuffix,
  describePatientIdPreview,
  extractJsonChangeDefaults,
  extractListDate,
  generatePaymentAuthorityCodeValue,
  generateOptionalFieldOverrides,
  generatePatientIdFromReferralNumber,
  generateRandomDob,
  generateRandomSsn,
  generateReferralNumber,
  modifyContent,
  normalizePaymentAuthorityCode,
  normalizeReferralPrefix,
  normalizeReferralPrefixMode,
  normalizeReferralNumberStart,
  resolveReferralPrefix,
  normalizeFacilityId,
  preparePatientIdSettings,
  validateIsoDate,
  validatePatientIdSettings,
  validateIsoDateTime,
  validatePaymentAuthorityCode,
  validateReferralNumberStart,
  validateCustomReferralPrefix,
  validateSsn,
  validateFacilityId,
};
