const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const REQUIRED_COLUMNS = [
  "facility_key",
  "facility_id",
  "region_id",
  "facility_name",
  "parent_facility_id",
];

function normalizeCell(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return !normalized || normalized.toUpperCase() === "NULL" ? null : normalized;
}

function convertWorksheet(worksheet) {
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: false,
  });
  const headers = Object.keys(rows[0] || {});
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`Missing required facility column(s): ${missingColumns.join(", ")}`);
  }

  const facilities = rows.map((row) => Object.fromEntries(
    headers.map((header) => [header, normalizeCell(row[header])])
  ));
  const facilityKeys = facilities.map((facility) => facility.facility_key).filter(Boolean);
  if (new Set(facilityKeys).size !== facilityKeys.length) {
    throw new Error("The facility_key column must contain unique non-empty values.");
  }
  if (facilityKeys.length !== facilities.length) {
    throw new Error("Every facility row must have a facility_key.");
  }

  return facilities;
}

function importFacilities(inputPath, outputPath) {
  const workbook = XLSX.readFile(inputPath, { cellDates: false });
  const [sheetName] = workbook.SheetNames;
  if (!sheetName) {
    throw new Error("The facility workbook does not contain a worksheet.");
  }

  const facilities = convertWorksheet(workbook.Sheets[sheetName]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(facilities, null, 2)}\n`, "utf8");
  return { count: facilities.length, sheetName };
}

if (require.main === module) {
  const cliArguments = process.argv.slice(2).filter((argument) => argument !== "--");
  const inputPath = path.resolve(cliArguments[0] || "");
  const outputPath = path.resolve(
    cliArguments[1] || path.join(__dirname, "..", "config", "facilities.json")
  );
  if (!cliArguments[0] || !fs.existsSync(inputPath)) {
    throw new Error("Usage: pnpm data:facilities -- <facilities.xlsx> [output.json]");
  }

  const result = importFacilities(inputPath, outputPath);
  console.log(`Imported ${result.count} facilities from ${result.sheetName} into ${outputPath}.`);
}

module.exports = {
  REQUIRED_COLUMNS,
  convertWorksheet,
  importFacilities,
  normalizeCell,
};
