const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const situationalCarePackageOptions = require("../config/situational_care_package_options.json");

const CARE_PACKAGE_NUMBER_COLUMN = "care_package_source_key/Number";
const CARE_PACKAGE_ID_COLUMN = "care_package_id";
const VERSION_SUFFIX_PATTERN = /_(\d+(?:\.\d+){1,3})(?:_([A-Za-z0-9_]+))?$/;
const SITUATIONAL_LOGICAL_KEYS = new Set(
  situationalCarePackageOptions.map((option) => `${String(option.carePackageNumber)}\u0000${String(option.name)}`)
);

function normalizeCell(value) {
  return String(value ?? "").trim();
}

function splitVersionedCarePackageId(value) {
  const carePackageId = normalizeCell(value);
  const match = carePackageId.match(VERSION_SUFFIX_PATTERN);
  if (!match) {
    return { name: carePackageId, version: [], qualifiers: "" };
  }
  return {
    name: carePackageId.slice(0, match.index).trim(),
    version: match[1].split(".").map(Number),
    qualifiers: String(match[2] || "").trim(),
  };
}

function compareVersions(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function shouldReplaceCurrent(current, candidate) {
  const versionDifference = compareVersions(candidate.version, current.version);
  if (versionDifference !== 0) return versionDifference > 0;
  return candidate.carePackageId.localeCompare(current.carePackageId, "en", { numeric: true }) > 0;
}

function convertWorksheet(worksheet) {
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: false });
  const headers = Object.keys(rows[0] || {});
  const missingColumns = [CARE_PACKAGE_NUMBER_COLUMN, CARE_PACKAGE_ID_COLUMN].filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required Care Package column(s): ${missingColumns.join(", ")}`);
  }

  const logicalRecords = new Map();
  for (const row of rows) {
    const carePackageNumber = normalizeCell(row[CARE_PACKAGE_NUMBER_COLUMN]);
    const carePackageId = normalizeCell(row[CARE_PACKAGE_ID_COLUMN]);
    if (!carePackageNumber || !carePackageId) continue;
    const parsed = splitVersionedCarePackageId(carePackageId);
    if (!parsed.name) continue;
    const identity = `${carePackageNumber}\u0000${parsed.name}`;
    if (SITUATIONAL_LOGICAL_KEYS.has(identity)) continue;
    const candidate = {
      carePackageNumber,
      carePackageId,
      name: parsed.name,
      displayName: `${parsed.name} - ${carePackageNumber}`,
      version: parsed.version,
    };
    const current = logicalRecords.get(identity);
    if (!current || shouldReplaceCurrent(current, candidate)) logicalRecords.set(identity, candidate);
  }

  return [...logicalRecords.values()]
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" }) ||
      left.carePackageNumber.localeCompare(right.carePackageNumber, "en", { numeric: true })
    )
    .map(({ version: _version, ...record }) => record);
}

function importCarePackage(inputPath, outputPath) {
  const workbook = XLSX.readFile(inputPath, { cellDates: false });
  const [sheetName] = workbook.SheetNames;
  if (!sheetName) throw new Error("The Care Package workbook does not contain a worksheet.");
  const records = convertWorksheet(workbook.Sheets[sheetName]);
  if (records.length === 0) throw new Error("The Care Package workbook did not contain any usable records.");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  return { count: records.length, sheetName };
}

if (require.main === module) {
  const cliArguments = process.argv.slice(2).filter((argument) => argument !== "--");
  const inputPath = path.resolve(cliArguments[0] || "");
  const outputPath = path.resolve(cliArguments[1] || path.join(__dirname, "..", "config", "care_package_options.json"));
  if (!cliArguments[0] || !fs.existsSync(inputPath)) {
    throw new Error("Usage: pnpm data:care-packages -- <care-packages.xlsx> [output.json]");
  }
  const result = importCarePackage(inputPath, outputPath);
  console.log(`Imported ${result.count} logical Care Package records from ${result.sheetName} into ${outputPath}.`);
}

module.exports = {
  CARE_PACKAGE_ID_COLUMN,
  CARE_PACKAGE_NUMBER_COLUMN,
  convertWorksheet,
  importCarePackage,
  splitVersionedCarePackageId,
};
