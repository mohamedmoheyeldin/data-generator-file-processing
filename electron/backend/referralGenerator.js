const fs = require("fs");
const os = require("os");
const path = require("path");
const { bundlePath, dataPath } = require("./appPaths");
const { registerTemporaryPath, removePath } = require("./runtimeCleanup");

const TEMPLATE_PATH = bundlePath("templates", "referral-template.json");
const CARE_PACKAGE_OPTIONS_FILE = "care_package_options.json";
const SITUATIONAL_CARE_PACKAGE_OPTIONS_FILE = "situational_care_package_options.json";

// Small pools of plainly synthetic values used to vary generated records.
const SYNTHETIC_POOLS = Object.freeze({
  sex: ["F", "M", "U"],
  contactMethods: ["phone", "email", "mail"],
  streets: ["Example Street", "Sample Avenue", "Test Lane", "Placeholder Road", "Demo Boulevard", "Mock Court"],
  cities: ["Springfield", "Fairview", "Riverton", "Lakeside", "Hillcrest", "Brookfield", "Greenville", "Oakdale"],
  categories: ["Outpatient", "Inpatient", "Diagnostic", "Therapy", "Specialty"],
  statuses: ["Approved", "Pending", "In Review", "Scheduled"],
  priorities: ["Routine", "Urgent"],
  services: ["Consultation", "Evaluation", "Follow-up visit", "Procedure", "Imaging", "Therapy sessions"],
  diagnoses: [
    ["Routine general examination", "Z00.00"],
    ["Low back pain", "M54.50"],
    ["Essential hypertension", "I10"],
    ["Type 2 diabetes without complications", "E11.9"],
    ["Sensorineural hearing loss", "H90.5"],
    ["Pain in right knee", "M25.561"],
    ["Seasonal allergic rhinitis", "J30.2"],
    ["Generalized anxiety disorder", "F41.1"],
  ],
  specialties: [
    ["Audiology", "AUD"], ["Cardiology", "CAR"], ["Dermatology", "DER"], ["Orthopedics", "ORT"],
    ["Physical Therapy", "PHY"], ["Radiology", "RAD"], ["Neurology", "NEU"], ["Urology", "URO"],
  ],
  providerFirstNames: ["Jordan", "Casey", "Morgan", "Taylor", "Riley", "Avery", "Quinn", "Parker"],
  providerLastNames: ["Example", "Sample", "Testwell", "Demo", "Placeholder", "Mockridge"],
  payers: ["Example Health Plan", "Sample Mutual Insurance", "Demo Care Network", "Placeholder Benefits Co."],
  planTypes: ["Commercial", "Supplemental", "Employer Group", "Self-funded"],
  appointmentReasons: ["Initial evaluation", "Follow-up", "Procedure visit", "Results review"],
});

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function digits(length) {
  let output = "";
  for (let index = 0; index < length; index += 1) output += Math.floor(Math.random() * 10);
  return output;
}

function syntheticPhone() {
  return `555-0${digits(2)}-${digits(4)}`;
}

function syntheticAddress(lineTwo = "") {
  return {
    line1: `${100 + Math.floor(Math.random() * 900)} ${pick(SYNTHETIC_POOLS.streets)}`,
    line2: lineTwo,
    city: pick(SYNTHETIC_POOLS.cities),
    state: "ZZ",
    postalCode: "00000",
    country: "USA",
  };
}

// Synthetic NPI-style values start with 0 so they can never collide with a real NPI (which start with 1 or 2).
function syntheticProviderNumber() {
  return `0${digits(9)}`;
}

function syntheticProviderName() {
  return `${pick(SYNTHETIC_POOLS.providerFirstNames)} ${pick(SYNTHETIC_POOLS.providerLastNames)}`;
}

function loadReferralTemplate() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error("The bundled referral template (templates/referral-template.json) was not found.");
  }
  const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
  if (!template || typeof template.referral !== "object" || Array.isArray(template.referral)) {
    throw new Error("The referral template must contain a referral object.");
  }
  return template;
}

function getCurrentReferralDates(overrides = {}, now = new Date()) {
  const dateText = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = dateText(now);
  const period = String(overrides.referralPeriod || "990 days").match(/^(\d+)\s*(?:days?)?$/i);
  const start = overrides.referralDate || today;
  const expiration = new Date(`${start}T12:00:00`);
  expiration.setDate(expiration.getDate() + (period ? Number(period[1]) : 990));
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, "0")).join(":");
  return {
    referralDate: start,
    referralDateTime: `${start} ${time}`,
    expirationDate: dateText(expiration),
    lastUpdateDate: overrides.lastUpdateDate || today,
    lastUpdateDateTime: `${overrides.lastUpdateDate || today} ${time}`,
    treatmentStartDate: start,
    clinicallyIndicatedDate: start,
    appointmentDate: start,
  };
}

// Replace every date field that exists anywhere in the record with the current run's dates.
function applyReferralDates(node, dates) {
  if (Array.isArray(node)) {
    node.forEach((item) => applyReferralDates(item, dates));
    return node;
  }
  if (!node || typeof node !== "object") return node;
  for (const [key, value] of Object.entries(node)) {
    if (Object.prototype.hasOwnProperty.call(dates, key) && (typeof value !== "object" || value === null)) {
      node[key] = dates[key];
    } else {
      applyReferralDates(value, dates);
    }
  }
  return node;
}

// Build one referral from the template with randomized synthetic values.
// Identity, facility, network, care package and payment values are assigned later by the content editor.
function buildSyntheticReferral(templateReferral, dates) {
  const record = structuredClone(templateReferral);
  const patient = record.patient || {};
  if (record.patient) {
    patient.sex = pick(SYNTHETIC_POOLS.sex);
    patient.phone = syntheticPhone();
    patient.preferredContactMethod = pick(SYNTHETIC_POOLS.contactMethods);
    patient.address = syntheticAddress();
  }
  if (record.referral) {
    const [diagnosis, diagnosisCode] = pick(SYNTHETIC_POOLS.diagnoses);
    Object.assign(record.referral, {
      category: pick(SYNTHETIC_POOLS.categories),
      status: pick(SYNTHETIC_POOLS.statuses),
      priority: pick(SYNTHETIC_POOLS.priorities),
      serviceRequested: pick(SYNTHETIC_POOLS.services),
      diagnosis,
      diagnosisCode,
      estimatedCost: (50 + Math.random() * 1950).toFixed(2),
    });
  }
  if (record.provider) {
    const [specialty, specialtyCode] = pick(SYNTHETIC_POOLS.specialties);
    Object.assign(record.provider, {
      referringProviderName: syntheticProviderName(),
      referringProviderNpi: syntheticProviderNumber(),
      treatingProviderName: syntheticProviderName(),
      treatingProviderNpi: syntheticProviderNumber(),
      specialty,
      specialtyCode,
    });
  }
  if (record.facility) {
    record.facility.phone = syntheticPhone();
    record.facility.fax = syntheticPhone();
    record.facility.address = syntheticAddress(`Suite ${100 + Math.floor(Math.random() * 400)}`);
  }
  for (const plan of Array.isArray(record.coverage?.plans) ? record.coverage.plans : []) {
    plan.payerName = pick(SYNTHETIC_POOLS.payers);
    plan.planType = pick(SYNTHETIC_POOLS.planTypes);
    plan.memberNumber = `M${digits(7)}`;
    plan.groupNumber = `G${digits(4)}`;
  }
  for (const appointment of Array.isArray(record.appointments) ? record.appointments : []) {
    appointment.reason = pick(SYNTHETIC_POOLS.appointmentReasons);
  }
  if (patient.firstName && patient.lastName) {
    patient.email = `${patient.firstName}.${patient.lastName}@example.com`.toLowerCase();
  }
  return applyReferralDates(record, dates);
}

function getGeneratorDefaults() {
  let template;
  try {
    template = loadReferralTemplate();
  } catch (_error) {
    return {};
  }
  const record = template.referral;
  const patient = record.patient || {};
  const referral = record.referral || {};

  return {
    dateOfBirth: patient.dateOfBirth || "",
    network: referral.network || "",
    category: referral.category || "",
    referralDate: referral.referralDate || "",
    referralDateTime: referral.referralDateTime || "",
    expirationDate: referral.expirationDate || "",
    lastUpdateDate: referral.lastUpdateDate || "",
    referralNumber: referral.referralNumber || "",
    referralPeriod: referral.referralPeriod || "990 days",
    ...getCurrentReferralDates({ referralPeriod: referral.referralPeriod }),
  };
}

function loadCarePackageOptions(fileName) {
  const options = [];
  const seen = new Set();

  function addOption(rawOption) {
    const carePackageKey = String(rawOption?.carePackageNumber || rawOption?.carePackageKey || "").trim();
    const carePackageId = String(rawOption?.carePackageId || "").trim();
    const pairKey = `${carePackageKey}\u0000${carePackageId}`;
    if (!carePackageKey || !carePackageId || seen.has(pairKey)) return;
    seen.add(pairKey);
    const name = String(rawOption?.name || carePackageId.replace(/_\d+(?:\.\d+){1,3}(?:_[A-Za-z0-9_]+)?$/, "")).trim();
    options.push({
      carePackageNumber: carePackageKey,
      carePackageKey,
      carePackageId,
      name,
      displayName: String(rawOption?.displayName || `${name} - ${carePackageKey}`).trim(),
      selectorKey: `${encodeURIComponent(carePackageKey)}::${encodeURIComponent(carePackageId)}`,
    });
  }

  for (const optionsPath of [
    dataPath("config", fileName),
    bundlePath("config", fileName),
  ]) {
    try {
      if (!fs.existsSync(optionsPath)) continue;
      const configuredOptions = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
      for (const configuredOption of Array.isArray(configuredOptions) ? configuredOptions : []) {
        addOption(configuredOption);
      }
      break;
    } catch (_error) {
      // Ignore an invalid runtime file and fall back to the bundled options.
    }
  }

  return options.sort((left, right) =>
    left.carePackageId.localeCompare(right.carePackageId, "en", { numeric: true, sensitivity: "base" }) ||
    left.carePackageKey.localeCompare(right.carePackageKey, "en", { numeric: true })
  );
}

function getSituationalCarePackageOptions() {
  return loadCarePackageOptions(SITUATIONAL_CARE_PACKAGE_OPTIONS_FILE);
}

function getCarePackageOptions() {
  const situationalIdentities = new Set(
    getSituationalCarePackageOptions().map((option) => `${option.carePackageKey}\u0000${option.name}`)
  );
  return loadCarePackageOptions(CARE_PACKAGE_OPTIONS_FILE).filter(
    (option) => !situationalIdentities.has(`${option.carePackageKey}\u0000${option.name}`)
  );
}

function resolveCarePackageSelection(selectorKeys = [], useAll = false, catalog = "regular") {
  const options = catalog === "situational" ? getSituationalCarePackageOptions() : getCarePackageOptions();
  const bySelectorKey = new Map(options.map((option) => [option.selectorKey, option]));
  const requestedKeys = useAll ? options.map((option) => option.selectorKey) : selectorKeys;
  const selections = [];
  const seen = new Set();
  for (const rawKey of Array.isArray(requestedKeys) ? requestedKeys : []) {
    const selectorKey = String(rawKey || "");
    if (!selectorKey || seen.has(selectorKey)) continue;
    const option = bySelectorKey.get(selectorKey);
    if (!option) throw new Error("A selected Care Package value is no longer available in the installed Care Package data.");
    seen.add(selectorKey);
    selections.push({ carePackageKey: option.carePackageKey, carePackageId: option.carePackageId });
  }

  return selections;
}

function buildGeneratedReferralSources(fileCount, referralsPerFile, overrides = {}) {
  const currentDates = getCurrentReferralDates(overrides);
  const template = loadReferralTemplate();

  const generatedDirectory = registerTemporaryPath(
    fs.mkdtempSync(path.join(os.tmpdir(), "dgfp_referral_generator_"))
  );
  try {
    for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
      const generatedData = { listDate: template.listDate || "", referrals: [] };
      for (let referralIndex = 0; referralIndex < referralsPerFile; referralIndex += 1) {
        generatedData.referrals.push(buildSyntheticReferral(template.referral, currentDates));
      }

      fs.writeFileSync(
        path.join(generatedDirectory, `generated_template_${fileIndex + 1}.json`),
        JSON.stringify(generatedData, null, 4),
        "utf8"
      );
    }
    return generatedDirectory;
  } catch (error) {
    removePath(generatedDirectory);
    throw error;
  }
}

module.exports = {
  applyReferralDates,
  buildGeneratedReferralSources,
  buildSyntheticReferral,
  loadReferralTemplate,
  getGeneratorDefaults,
  getCurrentReferralDates,
  getCarePackageOptions,
  getSituationalCarePackageOptions,
  resolveCarePackageSelection,
};
