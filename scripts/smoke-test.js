const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const XLSX = require("xlsx");

const {
  PATIENT_ID_MODES,
  NETWORK_VALUES,
  applySelectedNetworks,
  generatePatientIdFromReferralNumber,
  generateOptionalFieldOverrides,
  generatePaymentAuthorityCodeValue,
  generateRandomSsn,
  generateReferralNumber,
  modifyContent,
  preparePatientIdSettings,
  validatePaymentAuthorityCode,
  validateSsn,
} = require("../electron/backend/contentEditor");
const backend = require("../electron/backend");
const {
  cleanupRuntimeArtifacts,
  cleanupKnownTemporaryArtifacts,
  registerTemporaryPath,
} = require("../electron/backend/runtimeCleanup");
const { summarizeUploadProfiles, uploadFileWithSftp, uploadTargetsSequentially } = require("../electron/backend/uploader");
const {
  buildArchiveBasename,
  buildOutputFileNames,
  formatArchiveReferralDateTime,
  formatCurrentDateTime,
  zipOutput,
} = require("../electron/backend/zipper");
const { writeFileAtomic } = require("../electron/backend/atomicFile");
const { assertSourceFilesWithinLimits } = require("../electron/backend/limits");
const { importCredentialFile, parseCredentialFile } = require("../electron/backend/secureCredentials");
const {
  DEFAULT_UI_SETTINGS,
  loadUiSettings,
  normalizeUiSettings,
  saveUiSettings,
} = require("../electron/backend/userSettings");
const {
  exportReleaseArtifacts,
  getDisplayVersion,
  isRealWindowsExecutable,
  resolveReleasePaths,
} = require("./export-release-artifacts");
const {
  assertPathInsideWorkRoot,
  assertSafeTemporaryWorkRoot,
} = require("./build-release");
const {
  buildLeieValidationSql,
  highlightSql,
} = require("../electron/renderer/leieSql");
const {
  LEIE_DEFAULT_UPLOAD_DIRECTORY,
  resolveUploadDirectoryForWorkflow,
} = require("../electron/renderer/uploadDefaults");
const { normalizeFacilities } = require("../electron/backend/facilityCatalog");
const { ensureRuntimeFiles } = require("../electron/backend/appPaths");
const { normalizeCell } = require("./import-facilities");
const { convertWorksheet: convertCarePackageWorksheet, splitVersionedCarePackageId } = require("./import-care-packages");
const { getSituationalCarePackageOptions, resolveCarePackageSelection } = require("../electron/backend/referralGenerator");
const { assertSafeFolderRelationship, stripWindowsExtendedPathPrefix } = require("../electron/backend/batchSafety");
const { validateReferralFile } = require("../electron/backend/referralValidator");
const { allowedUploadTargets } = require("../electron/backend/workflowPolicy");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-smoke-"));
const projectRoot = path.resolve(__dirname, "..");
let failures = 0;
const tests = [];

// Generated records group fields (patient, referral, provider, facility, coverage); fixtures may be flat.
const referralNumberOf = (item) => item.referral?.referralNumber ?? item.referralNumber;
const facilityIdOf = (item) => item.facility?.facilityId ?? item.facilityId;

function test(name, callback) {
  tests.push({ name, callback });
}

function writeJsonFixture(fileName, data) {
  const filePath = path.join(tempRoot, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function writeWindowsExecutableFixture(filePath, sizeBytes = 1024 * 1024 + 32) {
  const buffer = Buffer.alloc(sizeBytes, 0);
  buffer[0] = 0x4d;
  buffer[1] = 0x5a;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function writeXlsxFixture(filePath, rows) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  XLSX.writeFile(workbook, filePath);
}

test("LEIE validation SQL includes the requested query set and syntax highlighting", () => {
  const sql = buildLeieValidationSql("LEIE0731202606153013");
  assert.match(sql, /^Use referral_db;/);
  assert.match(sql, /select \* from etl_batch_log order by last_updated_date desc;-- First get the etl_batch_id/);
  assert.equal((sql.match(/LEIE0731202606153013/g) || []).length, 3);
  assert.match(sql, /select \* from dbo\.provider_exclusion;$/);

  const highlighted = highlightSql(sql);
  assert.match(highlighted, /class="sql-keyword">select<\/span>/i);
  assert.match(highlighted, /class="sql-string">&#39;LEIE0731202606153013&#39;<\/span>/);
  assert.match(highlighted, /class="sql-comment">-- First get the etl_batch_id<\/span>/);
});

test("Version 1.5.3 metadata, release notes, safety controls, and release automation stay consolidated", () => {
  const versionConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "config", "app_version.json"), "utf8"));
  const packageConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const smokeWorkflow = fs.readFileSync(path.join(projectRoot, ".github", "workflows", "smoke-tests.yml"), "utf8");
  const buildReleaseScript = fs.readFileSync(path.join(projectRoot, "scripts", "build-release.js"), "utf8");
  const rendererHtml = fs.readFileSync(path.join(projectRoot, "electron", "renderer", "index.html"), "utf8");
  const rendererStyles = fs.readFileSync(path.join(projectRoot, "electron", "renderer", "styles.css"), "utf8");
  const rendererApp = fs.readFileSync(path.join(projectRoot, "electron", "renderer", "app.js"), "utf8");
  const workflowPolicy = fs.readFileSync(path.join(projectRoot, "electron", "backend", "workflowPolicy.js"), "utf8");
  const jobUi = fs.readFileSync(path.join(projectRoot, "electron", "renderer", "jobUi.js"), "utf8");
  const compactSelect = fs.readFileSync(path.join(projectRoot, "electron", "renderer", "compactSelect.js"), "utf8");
  const mainProcess = fs.readFileSync(path.join(projectRoot, "electron", "main.js"), "utf8");
  const iconPng = fs.readFileSync(path.join(projectRoot, "assets", "icons", "app_icon.png"));
  const iconIco = fs.readFileSync(path.join(projectRoot, "assets", "icons", "app_icon.ico"));

  assert.equal(versionConfig.version, "1.5.3");
  assert.equal(versionConfig.releaseTag, "v1.5.3");
  assert.equal(versionConfig.label, "Version 1.5.3");
  assert.ok(versionConfig.releaseNotes.length > 0);
  assert.match(versionConfig.releaseNotes.join(" "), /neutral template/);
  assert.match(versionConfig.releaseNotes.join(" "), /sequential queue/);
  assert.match(versionConfig.releaseNotes.join(" "), /master JSON/);
  assert.equal(packageConfig.scripts["test:smoke"], "node scripts/smoke-test.js");
  assert.equal(packageConfig.scripts["test:syntax"], "node scripts/syntax-check.js");
  assert.equal(crypto.createHash("sha256").update(iconPng).digest("hex"), "ccec3a23699eb885c24a235938c3af45a65ca43c743571d5e114d0ce023ff14f");
  assert.deepEqual([...iconIco.subarray(0, 4)], [0, 0, 1, 0]);
  assert.equal(iconIco.readUInt16LE(4), 7);
  assert.equal(packageConfig.build.files.includes("assets/icons/app_icon.ico"), true);
  assert.equal(packageConfig.build.files.includes("assets/icons/app_icon.png"), true);
  assert.equal(packageConfig.build.win.icon, "assets/icons/app_icon.ico");
  assert.equal(packageConfig.build.win.signAndEditExecutable, true);
  assert.equal(Object.prototype.hasOwnProperty.call(packageConfig.build.win, "signExecutable"), false);
  assert.equal(packageConfig.build.nsis.installerIcon, "assets/icons/app_icon.ico");
  assert.equal(packageConfig.build.nsis.uninstallerIcon, "assets/icons/app_icon.ico");
  assert.equal(packageConfig.build.nsis.installerHeaderIcon, "assets/icons/app_icon.ico");
  assert.match(rendererHtml, /app_icon\.ico/);
  assert.equal((rendererHtml.match(/app_icon\.png/g) || []).length, 2);
  assert.match(rendererHtml, /class="release-announcement-scroll"/);
  assert.match(rendererHtml, />Start Using The App</);
  assert.match(rendererHtml, /Content-Security-Policy/);
  assert.match(rendererHtml, /id="cancel-job"/);
  assert.match(rendererHtml, /id="job-progress-wrap"/);
  assert.match(rendererHtml, /id="job-progress-label"/);
  assert.match(rendererHtml, /id="job-progress-value"/);
  assert.match(rendererHtml, /aria-live="polite"/);
  assert.match(rendererHtml, /compactSelect\.js/);
  assert.match(rendererStyles, /\.compact-select-menu\s*\{[^}]*max-height:\s*260px/s);
  assert.match(rendererStyles, /--control-height:\s*48px/);
  assert.match(rendererStyles, /--control-touch-target:\s*44px/);
  assert.match(rendererStyles, /\.field-block\s*\{[^}]*align-content:\s*start/s);
  assert.match(rendererStyles, /\.upload-target-grid\s*\{[^}]*minmax\(0, 2fr\) minmax\(0, 3fr\)/s);
  assert.match(rendererStyles, /\.upload-target-grid\s*\{[^}]*align-items:\s*start/s);
  assert.doesNotMatch(rendererStyles, /\.upload-target-grid\s*\{[^}]*180px/s);
  assert.match(rendererApp, /facilityIdCombobox\.contains\(document\.activeElement\)/);
  assert.match(workflowPolicy, /REFERRAL_UPLOAD_TARGET_NAMES = Object\.freeze\(\["SQA", "DEV", "PPD"\]\)/);
  assert.match(rendererApp, /PROD is not available for Referral Files/);
  assert.match(jobUi, /progressElement\.removeAttribute\("value"\)/);
  assert.match(jobUi, /percent/);
  assert.match(compactSelect, /aria-controls/);
  assert.match(compactSelect, /event\.key === "Home" \|\| event\.key === "End"/);
  assert.match(compactSelect, /aria-invalid/);
  assert.match(rendererStyles, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(rendererStyles, /\.release-announcement-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(mainProcess, /app_icon\.ico/);
  assert.equal(fs.existsSync(path.join(projectRoot, ".github", "release.yml")), false);
  // The public repository is source only: no workflow builds or publishes installers.
  assert.equal(fs.existsSync(path.join(projectRoot, ".github", "workflows", "release.yml")), false);
  assert.match(buildReleaseScript, /"--publish",\s*"never"/);
  assert.match(smokeWorkflow, /pull_request:/);
  assert.match(smokeWorkflow, /pnpm test/);
  assert.match(smokeWorkflow, /Electron E2E \(Windows\)/);
  assert.match(mainProcess, /sandbox:\s*true/);
  assert.match(mainProcess, /jobWorker\.js/);
  assert.match(mainProcess, /backend:cancel/);
  assert.match(mainProcess, /Background generation must return an archive without an automatic manifest/);
  assert.match(rendererHtml, /id="pre-run-overlay"/);
  assert.match(rendererHtml, /id="retry-failed-uploads"/);
  assert.doesNotMatch(rendererHtml, /id="recent-runs"/);
  assert.doesNotMatch(rendererHtml, /id="generation-preset"/);
  assert.doesNotMatch(rendererHtml, /id="generation-preset-name"/);
  assert.doesNotMatch(rendererApp, /renderRecentRuns|GenerationPreset/);
  assert.match(jobUi, /normalizedPhase/);
});

test("Neutral referral template and samples build grouped synthetic records", () => {
  const { buildSyntheticReferral, getCurrentReferralDates, loadReferralTemplate } = require("../electron/backend/referralGenerator");
  const template = loadReferralTemplate();
  const groups = ["patient", "referral", "provider", "facility", "coverage", "appointments"];
  assert.deepEqual(Object.keys(template.referral), groups);
  const dates = getCurrentReferralDates({ referralDate: "2026-01-15" }, new Date(2026, 0, 15, 9, 30, 0));
  const record = buildSyntheticReferral(template.referral, dates);
  assert.deepEqual(Object.keys(record), groups);
  assert.equal(record.referral.referralDate, "2026-01-15");
  assert.equal(record.appointments[0].appointmentDate, "2026-01-15");
  assert.match(record.provider.referringProviderNpi, /^0\d{9}$/);
  assert.match(record.patient.phone, /^555-0\d{2}-\d{4}$/);
  assert.notEqual(record, template.referral);
  const samplePath = path.join(projectRoot, "templates", "samples", "sample-referrals.json");
  const validation = validateReferralFile(samplePath);
  assert.equal(validation.valid, true);
  assert.equal(validation.referralCount, 3);
  const samples = JSON.parse(fs.readFileSync(samplePath, "utf8")).referrals;
  for (const sample of samples) assert.deepEqual(Object.keys(sample), groups);
});

test("Workflow policy is authoritative for Referral and LEIE upload environments", () => {
  assert.deepEqual(allowedUploadTargets("referral"), ["SQA", "DEV", "PPD"]);
  assert.deepEqual(allowedUploadTargets("leie"), ["SQA", "DEV", "PPD", "PROD"]);
});

test("Network choices can stay automatic or rotate across a selected subset", () => {
  const automatic = { referrals: [{ network: "SOURCE1" }, { network: "SOURCE2" }] };
  applySelectedNetworks(automatic, {});
  assert.deepEqual(automatic.referrals.map((item) => item.network), ["SOURCE1", "SOURCE2"]);

  const selected = { referrals: Array.from({ length: 6 }, () => ({ network: "SOURCE" })) };
  applySelectedNetworks(selected, { selectedNetworks: ["NET2", "NET4"] });
  assert.deepEqual(new Set(selected.referrals.map((item) => item.network)), new Set(["NET2", "NET4"]));
  assert.deepEqual(NETWORK_VALUES, ["NET1", "NET2", "NET3", "NET4", "NET5"]);
  assert.throws(() => applySelectedNetworks({ referrals: [{}] }, { selectedNetworks: ["OTHER"] }), /not available/);
});

test("Selected upload targets run sequentially and one failure does not stop the others", async () => {
  const targets = ["SQA", "DEV", "PPD"].map((serverName) => ({
    server_name: serverName,
    user_name: `${serverName.toLowerCase()}-user`,
    remote_directory: `/${serverName.toLowerCase()}`,
    connection_details: {},
  }));
  let active = 0;
  let maxActive = 0;
  const events = [];
  const results = await uploadTargetsSequentially("fixture.gz", targets, {
    onProgress: (event) => events.push(event),
    upload: async (_localPath, remoteDirectory) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, remoteDirectory === "/dev" ? 5 : 15));
      active -= 1;
      if (remoteDirectory === "/dev") throw new Error("mock DEV connection failed");
      return `${remoteDirectory}/fixture.gz`;
    },
  });
  assert.equal(maxActive, 1);
  assert.deepEqual(results.map((item) => item.serverName), ["SQA", "DEV", "PPD"]);
  assert.deepEqual(results.map((item) => item.status), ["completed", "failed", "completed"]);
  assert.equal(events.filter((event) => event.state === "uploading").length, 3);
  assert.equal(events.at(-1).state, "upload-batch-warning");
});

test("Source and output safety rejects identical and nested folders", () => {
  const inputDir = path.join(tempRoot, "safe-path-input");
  const outputDir = path.join(tempRoot, "safe-path-output");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  assert.throws(() => assertSafeFolderRelationship(inputDir, inputDir), /must be different/);
  assert.throws(() => assertSafeFolderRelationship(inputDir, path.join(inputDir, "nested")), /cannot be nested/);
  assert.doesNotThrow(() => assertSafeFolderRelationship(inputDir, outputDir));
  assert.equal(stripWindowsExtendedPathPrefix("\\\\?\\C:\\Temp\\Input"), "C:\\Temp\\Input");
  assert.equal(stripWindowsExtendedPathPrefix("\\\\?\\UNC\\server\\share\\Input"), "\\\\server\\share\\Input");
});

test("Referral schema preflight reports malformed business input", () => {
  const invalidJson = writeJsonFixture("invalid-referral-shape.json", { NotReferrals: [] });
  const result = validateReferralFile(invalidJson);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Referrals field must be an array/);
});

test("Atomic writes replace files without leaving temporary artifacts", () => {
  const targetPath = path.join(tempRoot, "atomic", "settings.json");
  writeFileAtomic(targetPath, "first\n");
  writeFileAtomic(targetPath, "second\n");
  assert.equal(fs.readFileSync(targetPath, "utf8"), "second\n");
  assert.deepEqual(fs.readdirSync(path.dirname(targetPath)), ["settings.json"]);
});

test("Credential imports preserve the source and remain readable", () => {
  const sourcePath = writeJsonFixture("credential-source.json", [{ Host: "example", UserName: "user", Password: "secret" }]);
  const destinationPath = path.join(tempRoot, "secure", "credentials.json");
  importCredentialFile(sourcePath, destinationPath);
  assert.equal(fs.existsSync(sourcePath), true);
  assert.equal(parseCredentialFile(destinationPath).entries[0].Password, "secret");
});

test("Diagnostic export excludes credentials and user file paths", async () => {
  const outputDir = path.join(tempRoot, "diagnostics");
  const result = await backend.handleCommand("export-diagnostics", { outputDir });
  const reportText = fs.readFileSync(result.reportPath, "utf8");
  const report = JSON.parse(reportText);
  assert.equal(report.appVersion, "1.5.3");
  assert.equal(Object.prototype.hasOwnProperty.call(report.workflowPreferences, "inputDir"), false);
  assert.doesNotMatch(reportText, /password|ciphertext|connection_details/i);
});

test("Large source files are rejected before processing", () => {
  const sourcePath = path.join(tempRoot, "limit-source.json");
  fs.writeFileSync(sourcePath, "1234567890");
  const originalLimit = process.env.DGFP_MAX_SOURCE_FILE_BYTES;
  try {
    process.env.DGFP_MAX_SOURCE_FILE_BYTES = "5";
    assert.throws(() => assertSourceFilesWithinLimits([sourcePath]), /safety limit/);
  } finally {
    if (originalLimit === undefined) delete process.env.DGFP_MAX_SOURCE_FILE_BYTES;
    else process.env.DGFP_MAX_SOURCE_FILE_BYTES = originalLimit;
  }
});

test("Streaming gzip combines referral files without building one giant payload", async () => {
  const outputDir = path.join(tempRoot, "streaming-gzip");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "one.json"), JSON.stringify({ Batch: "A", referrals: [{ id: 1 }] }));
  fs.writeFileSync(path.join(outputDir, "two.json"), JSON.stringify({ Batch: "A", referrals: [{ id: 2 }, { id: 3 }] }));
  const archivePath = await zipOutput(outputDir, "stream-test");
  const payload = JSON.parse(zlib.gunzipSync(fs.readFileSync(archivePath)).toString("utf8"));
  assert.equal(payload.Batch, "A");
  assert.deepEqual(payload.referrals.map((item) => item.id), [1, 2, 3]);
});

test("LEIE upload targets use the manual-processing directory without replacing custom paths", () => {
  assert.equal(LEIE_DEFAULT_UPLOAD_DIRECTORY, "/in/manual_process/");
  assert.equal(resolveUploadDirectoryForWorkflow("", "leie"), "/in/manual_process/");
  assert.equal(resolveUploadDirectoryForWorkflow("/referral_uploads", "leie"), "/in/manual_process/");
  assert.equal(resolveUploadDirectoryForWorkflow("/custom/leie/", "leie"), "/custom/leie/");
  assert.equal(resolveUploadDirectoryForWorkflow("/in/manual_process/", "referral"), "/referral_uploads");
});

test("Referral and LEIE upload notes identify their separate default directories", () => {
  const rendererSource = fs.readFileSync(path.join(projectRoot, "electron", "renderer", "app.js"), "utf8");
  assert.match(rendererSource, /Referral uploads default to/);
  assert.match(rendererSource, /separate from the LEIE Data default/);
  assert.match(rendererSource, /LEIE Data uploads default to/);
  assert.match(rendererSource, /separate from the Referral default/);
});

test("Payment Authority Codes are restricted to the configured catalog and never increment", () => {
  assert.equal(validatePaymentAuthorityCode("21"), "21");
  assert.throws(() => validatePaymentAuthorityCode("99999"), /configured reference list/);
  assert.throws(() => validatePaymentAuthorityCode("12-345"), /configured reference list/);
  assert.equal(generatePaymentAuthorityCodeValue("21", 300), "21");
});

test("Optional override normalization keeps the validated Payment Authority Code", () => {
  const overrides = generateOptionalFieldOverrides({
    facilityId: "F101",
    paymentAuthorityCode: "21",
  });

  assert.equal(overrides.paymentAuthorityCode, "21");
  assert.equal(overrides.facilityId, "F101");
  assert.throws(() => generateOptionalFieldOverrides({ facilityId: "F999_OLD" }), /facility_id/);
  assert.equal(generateOptionalFieldOverrides({ facilityId: "f101" }).facilityId, "F101");
  assert.throws(
    () => generateOptionalFieldOverrides({ facilityId: "F999" }),
    /must exactly match a facility_id/
  );
});

test("Facility records normalize nulls and de-duplicate by facility_key", () => {
  const normalized = normalizeFacilities([
    { facility_key: "2823", facility_id: "F105", facility_name: "  Example   Mobile Clinic " },
    { facility_key: "2823", facility_id: "DUPLICATE", facility_name: "Duplicate" },
    { facility_key: "2014", facility_id: "NULL", facility_name: null, parent_facility_id: "642" },
  ]);

  assert.deepEqual(normalized, [
    { facility_key: "2823", facility_id: "F105", facility_name: "Example Mobile Clinic" },
    { facility_key: "2014", facility_id: null, facility_name: null, parent_facility_id: "642" },
  ]);
  assert.equal(normalizeCell("NULL"), null);
  assert.equal(normalizeCell(" F105 "), "F105");
});

test("Bundled facility JSON is a small synthetic catalog with the expected columns", () => {
  const bundled = JSON.parse(fs.readFileSync(path.join(projectRoot, "config", "facilities.json"), "utf8"));
  assert.equal(bundled.length, 10);
  assert.equal(new Set(bundled.map((facility) => facility.facility_key)).size, bundled.length);
  assert.equal(new Set(bundled.map((facility) => facility.facility_id)).size, bundled.length);
  assert.deepEqual(Object.keys(bundled[0]), [
    "facility_key", "facility_id", "region_id", "is_current", "start_date", "end_date",
    "source_system", "source_entity", "facility_name", "last_updated_date",
    "last_updated_user", "parent_facility_id",
  ]);
  assert.equal(bundled.every((facility) => facility.source_system === "SYNTHETIC"), true);
  const first = bundled.find((facility) => facility.facility_key === "1001");
  assert.equal(first.facility_id, "F101");
  assert.equal(first.region_id, "1");
  assert.equal(first.parent_facility_id, "F10");
});

test("Valid source-backed Facility IDs remain exact through generated JSON and gzip", async () => {
  for (const facilityId of ["F102", "F103", "F101"]) {
    assert.equal(generateOptionalFieldOverrides({ facilityId: facilityId }).facilityId, facilityId);
    const filePath = writeJsonFixture(`facility-${facilityId}.json`, {
      listDate: "2026-08-31 16:25:00",
      referrals: [{
        referralNumber: "RF0000000001",
        patient: { patientId: "1", firstName: "A", lastName: "B", ssn: "999-99-0001" },
        facility: { facilityId: "F101", carePackageKey: "69", carePackageId: "OLD" },
      }],
    });
    const result = modifyContent(filePath, "", null, "999-99-0001", 1, 1, { facilityId: facilityId });
    assert.equal(JSON.parse(result.content).referrals[0].facility.facilityId, facilityId);
    const outputDir = fs.mkdtempSync(path.join(tempRoot, `facility-output-${facilityId}-`));
    fs.writeFileSync(path.join(outputDir, "result.json"), result.content);
    const archivePath = await zipOutput(outputDir, `facility-${facilityId}`);
    const archived = JSON.parse(zlib.gunzipSync(fs.readFileSync(archivePath)).toString("utf8"));
    assert.equal(archived.referrals[0].facility.facilityId, facilityId);
  }
});

test("Care Package conversion maps columns, removes version duplicates, and sorts deterministically", () => {
  const worksheet = XLSX.utils.json_to_sheet([
    { "care_package_source_key/Number": 2, care_package_id: "BETA_1.0.1" },
    { "care_package_source_key/Number": 1, care_package_id: "AUD_HEARING EVALUATION_1.0.16" },
    { "care_package_source_key/Number": 1, care_package_id: "AUD_HEARING EVALUATION_1.0.17" },
    { "care_package_source_key/Number": 3, care_package_id: "ALPHA_1.2.3_REV" },
    { "care_package_source_key/Number": 201, care_package_id: "EMR_EMERGENCY CARE_1.2.7" },
    { "care_package_source_key/Number": 201, care_package_id: "EMR_EMERGENCY CARE_1.2.8" },
  ]);
  assert.deepEqual(convertCarePackageWorksheet(worksheet), [
    { carePackageNumber: "3", carePackageId: "ALPHA_1.2.3_REV", name: "ALPHA", displayName: "ALPHA - 3" },
    { carePackageNumber: "1", carePackageId: "AUD_HEARING EVALUATION_1.0.17", name: "AUD_HEARING EVALUATION", displayName: "AUD_HEARING EVALUATION - 1" },
    { carePackageNumber: "2", carePackageId: "BETA_1.0.1", name: "BETA", displayName: "BETA - 2" },
  ]);
  assert.deepEqual(splitVersionedCarePackageId("AUD_HEARING EVALUATION_1.0.17").version, [1, 0, 17]);
});

test("Packaged upgrades refresh the installed Facility ID and special Care Package catalogs", () => {
  const bundleRoot = path.join(tempRoot, "facility-bundle");
  const userDataRoot = path.join(tempRoot, "facility-user-data");
  fs.mkdirSync(path.join(bundleRoot, "config"), { recursive: true });
  fs.mkdirSync(path.join(userDataRoot, "config"), { recursive: true });
  fs.writeFileSync(
    path.join(bundleRoot, "config", "facilities.json"),
    JSON.stringify([{ facility_key: "2242", facility_id: "F102", facility_name: "Example Outpatient Clinic" }])
  );
  fs.writeFileSync(
    path.join(userDataRoot, "config", "facilities.json"),
    JSON.stringify([{ facility_key: "old", facility_id: "OLD", facility_name: "Old facility" }])
  );
  fs.writeFileSync(
    path.join(bundleRoot, "config", "care_package_options.json"),
    JSON.stringify([{ carePackageKey: "1", carePackageId: "AUD_HEARING EVALUATION_1.0.17" }])
  );
  fs.writeFileSync(path.join(userDataRoot, "config", "care_package_options.json"), "[]");
  fs.writeFileSync(
    path.join(bundleRoot, "config", "situational_care_package_options.json"),
    JSON.stringify([{ carePackageNumber: "201", carePackageId: "EMR_EMERGENCY CARE_1.2.8", name: "EMR_EMERGENCY CARE" }])
  );
  fs.writeFileSync(path.join(userDataRoot, "config", "situational_care_package_options.json"), "[]");

  const originalPackaged = process.env.DGFP_IS_PACKAGED;
  const originalBundleRoot = process.env.DGFP_BUNDLE_ROOT;
  const originalUserDataRoot = process.env.DGFP_USER_DATA_ROOT;
  try {
    process.env.DGFP_IS_PACKAGED = "1";
    process.env.DGFP_BUNDLE_ROOT = bundleRoot;
    process.env.DGFP_USER_DATA_ROOT = userDataRoot;
    ensureRuntimeFiles();
    const installed = JSON.parse(fs.readFileSync(path.join(userDataRoot, "config", "facilities.json"), "utf8"));
    assert.equal(installed[0].facility_id, "F102");
    const installedCarePackages = JSON.parse(fs.readFileSync(path.join(userDataRoot, "config", "care_package_options.json"), "utf8"));
    assert.equal(installedCarePackages[0].carePackageKey, "1");
    const installedSituationalCarePackages = JSON.parse(
      fs.readFileSync(path.join(userDataRoot, "config", "situational_care_package_options.json"), "utf8")
    );
    assert.equal(installedSituationalCarePackages[0].carePackageNumber, "201");
  } finally {
    for (const [key, value] of [
      ["DGFP_IS_PACKAGED", originalPackaged],
      ["DGFP_BUNDLE_ROOT", originalBundleRoot],
      ["DGFP_USER_DATA_ROOT", originalUserDataRoot],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("modifyContent randomizes identity data and matches Referral Number and Patient ID endings", () => {
  const filePath = writeJsonFixture("random-identities.json", {
    referrals: [1, 2].map((number) => ({
      referralNumber: `RF000000000${number}`,
      patient: {
        patientId: String(number),
        firstName: "Test",
        lastName: "patient",
        ssn: "999-99-0001",
        dateOfBirth: "1970-01-01",
      },
      facility: { facilityId: "F101", carePackageKey: "69", carePackageId: "OLD" },
    })),
  });

  const result = modifyContent(
    filePath,
    "400",
    null,
    "999-99-0001",
    1,
    1,
    { facilityId: "F102", carePackageKey: "107", carePackageId: "PMR_PHYSICAL THERAPY_1.0.12_PRCT" },
    1,
    preparePatientIdSettings(),
    1,
    { randomizeSsn: true, randomizeDob: true, matchSuffixLength: 5 }
  );
  const referrals = JSON.parse(result.content).referrals;

  assert.deepEqual(referrals.map((item) => item.facility.facilityId), ["F102", "F102"]);
  assert.deepEqual(referrals.map((item) => item.facility.carePackageKey), ["107", "107"]);
  assert.deepEqual(referrals.map((item) => item.facility.carePackageId), [
    "PMR_PHYSICAL THERAPY_1.0.12_PRCT",
    "PMR_PHYSICAL THERAPY_1.0.12_PRCT",
  ]);
  for (const referral of referrals) {
    assert.match(referral.patient.ssn, /^999-\d{2}-\d{4}$/);
    assert.match(referral.patient.dateOfBirth, /^(19|20)\d{2}-\d{2}-\d{2}$/);
    assert.equal(referral.patient.patientId.slice(-5), referral.referralNumber.slice(-5));
  }
  assert.notEqual(referrals[0].patient.ssn, referrals[1].patient.ssn);
});

test("Generated test SSNs always start with 999 and remain unique", () => {
  const generated = Array.from({ length: 1000 }, (_, index) => generateRandomSsn(index + 1));
  assert.equal(new Set(generated).size, generated.length);
  for (const ssn of generated) {
    assert.match(ssn, /^999-\d{2}-\d{4}$/);
  }
  assert.throws(() => validateSsn("995-12-3456"), /must start with 999/);
  assert.doesNotThrow(() => validateSsn("999-12-3456"));
});

test("modifyContent uses only reference Facility IDs in random mode", () => {
  const filePath = writeJsonFixture("random-facilities.json", {
    referrals: [
      { referralNumber: "RF0000000001", facilityId: "BAD", patientId: "1", firstName: "A", lastName: "B", ssn: "999-99-0001" },
      { referralNumber: "RF0000000002", facilityId: "BAD", patientId: "2", firstName: "C", lastName: "D", ssn: "999-99-0001" },
    ],
  });
  const facilityIdentityOptions = {
    randomizeFacilityId: true,
    generatedFacilityKeys: ["NOT-IN-REFERENCE-LIST"],
  };
  const result = modifyContent(
    filePath,
    "",
    null,
    "999-99-0001",
    1,
    2,
    {},
    1,
    preparePatientIdSettings(),
    1,
    facilityIdentityOptions
  );
  const secondResult = modifyContent(
    filePath,
    "",
    null,
    "999-99-0001",
    2,
    2,
    {},
    1,
    preparePatientIdSettings(),
    1,
    facilityIdentityOptions
  );
  const validKeys = new Set(require("../electron/backend/facilityCatalog").loadFacilityOptions().map((option) => option.facilityKey));
  const generatedFacilityIds = [result, secondResult].flatMap((item) =>
    JSON.parse(item.content).referrals.map((referral) => referral.facilityId)
  );
  assert.equal(new Set(generatedFacilityIds).size, generatedFacilityIds.length);
  for (const facilityId of generatedFacilityIds) {
    assert.equal(validKeys.has(facilityId), true);
    assert.match(facilityId, /^[A-Z0-9]{3,7}$/);
    assert.notEqual(facilityId, "2242");
  }
});

test("Optional date overrides reject invalid formats", () => {
  assert.throws(
    () => generateOptionalFieldOverrides({ dateOfBirth: "03/26/2026" }),
    /Date of Birth must use the format YYYY-MM-DD/
  );
  assert.throws(
    () => generateOptionalFieldOverrides({ referralDateTime: "2026-03-26T11:30:00" }),
    /Referral DateTime must use the format YYYY-MM-DD HH:mm:ss/
  );
});

test("Referral number generation preserves the standard prefix and increments", () => {
  assert.equal(generateReferralNumber("123", 1), "RF0000000123");
  assert.equal(generateReferralNumber("123", 2), "RF0000000124");
  assert.equal(generateReferralNumber("ABC123", 2), "RFABC124");
  assert.equal(
    generateReferralNumber("123456789012345678901234567890", 2),
    "RF123456789012345678901234567891"
  );
  assert.equal(
    generateReferralNumber("ALPHABETICREFERRALBODY", 2),
    "RFALPHABETICREFERRALBODY2"
  );
  assert.equal(generateReferralNumber("26S6-00001_TEST", 1), "RF26S6-00001_TEST");
  assert.equal(generateReferralNumber("26S6_TEST-00001", 2), "RF26S6_TEST-00002");
  assert.equal(generateReferralNumber("BODY_TEST", 2), "RFBODY_TEST2");
  assert.equal(generateReferralNumber("26S6_TEST-00001", 1, "RF-TEST_"), "RF-TEST_26S6_TEST-00001");
  assert.equal(generatePatientIdFromReferralNumber("RF26S6_TEST-00001"), "TEST26S6TEST00001");
});

test("Referral uploads reject PROD while preserving it for the separate LEIE workflow", () => {
  assert.throws(
    () => backend.prepareBackgroundPayload("process", {
      upload: {
        enabled: true,
        targets: [{
          server_name: "PROD",
          user_name: "example-user@PROD",
          remote_directory: "/referral_uploads",
        }],
      },
    }),
    /Referral Files can be uploaded only to SQA, DEV, or PPD/
  );
});

test("Referral numbers can use ALT and map directly to matching TEST Patient IDs", () => {
  assert.equal(generateReferralNumber("26S600001", 1, "ALT"), "ALT26S600001");
  assert.equal(generateReferralNumber("26S600001", 2, "ALT"), "ALT26S600002");
  assert.equal(generatePatientIdFromReferralNumber("RF26S600001"), "TEST000026S600001");
  assert.equal(generatePatientIdFromReferralNumber("ALT26S600001"), "TEST000026S600001");
  assert.equal(generateReferralNumber("26S600001", 1, "DGFP"), "DGFP26S600001");
  assert.equal(generatePatientIdFromReferralNumber("DGFP26S600001", ["DGFP"]), "TEST000026S600001");
  assert.equal(generatePatientIdFromReferralNumber("DGFP26S600001", ["DGFP"]).length, 17);
  assert.equal(generateReferralNumber("12345", 1, "RF_TEST_"), "RF_TEST_0000012345");
  assert.equal(
    generateReferralNumber("UNLIMITEDBODY", 1, "CUSTOM_PREFIX_WITHOUT_A_CHARACTER_LIMIT_"),
    "CUSTOM_PREFIX_WITHOUT_A_CHARACTER_LIMIT_UNLIMITEDBODY"
  );
  const longPatientIdOne = generatePatientIdFromReferralNumber("RF12345678901234567890", [], 1);
  const longPatientIdTwo = generatePatientIdFromReferralNumber("RF12345678901234567891", [], 2);
  assert.equal(longPatientIdOne, "TEST1234567890121");
  assert.equal(longPatientIdTwo, "TEST1234567890122");
  assert.equal(longPatientIdOne.length, 17);
  assert.notEqual(longPatientIdOne, longPatientIdTwo);
});

test("Referral generation supports standard, ALT, combined RFALT, and custom prefix modes", async () => {
  const invalidCustomPreview = await backend.handleCommand("preview", {
    referralReplacementCode: "26S600001",
    identityOptions: { referralPrefixMode: "custom", customReferralPrefix: "" },
  });
  assert.match(invalidCustomPreview.fieldErrors.referralPrefix, /Enter a custom Referral Number prefix/);

  const scenarios = [
    { mode: "standard", customReferralPrefix: "", expected: [/^RF/, /^RF/, /^RF/, /^RF/] },
    { mode: "alt", customReferralPrefix: "", expected: [/^ALT/, /^ALT/, /^ALT/, /^ALT/] },
    { mode: "mixed", customReferralPrefix: "", expected: [/^RFALT/, /^RFALT/, /^RFALT/, /^RFALT/] },
    { mode: "custom", customReferralPrefix: "DGFP", expected: [/^DGFP/, /^DGFP/, /^DGFP/, /^DGFP/] },
  ];

  for (const scenario of scenarios) {
    const outputDir = path.join(tempRoot, `prefix-mode-${scenario.mode}`);
    fs.mkdirSync(outputDir, { recursive: true });
    await backend.handleCommand("generate", {
      outputDir,
      fileCount: 1,
      referralsPerFile: 4,
      referralReplacementCode: "26S600001",
      clearOutput: false,
      keepProcessedJson: true,
      archiveBasename: `prefix_${scenario.mode}`,
      patientIdSettings: { mode: PATIENT_ID_MODES.REFERRAL_MATCH },
      identityOptions: {
        referralPrefixMode: scenario.mode,
        customReferralPrefix: scenario.customReferralPrefix,
      },
      upload: { enabled: false },
    });
    const jsonName = fs.readdirSync(outputDir).find((name) => name.endsWith(".json") && !name.endsWith(".manifest.json") && !name.endsWith("_Master.json"));
    const referrals = JSON.parse(fs.readFileSync(path.join(outputDir, jsonName), "utf8")).referrals;
    assert.equal(new Set(referrals.map(referralNumberOf)).size, 4);
    referrals.forEach((referral, index) => {
      assert.match(referralNumberOf(referral), scenario.expected[index]);
      assert.equal(
        referral.patient.patientId,
        generatePatientIdFromReferralNumber(referralNumberOf(referral), [scenario.customReferralPrefix].filter(Boolean))
      );
    });
  }
});

test("modifyContent derives Patient IDs from unique referral numbers and mixes only selected facilities", () => {
  const filePath = writeJsonFixture("matched-referrals.json", {
    referrals: Array.from({ length: 6 }, (_, index) => ({
      referralNumber: `RF000000000${index + 1}`,
      patient: { patientId: String(index + 1), firstName: "A", lastName: "B", ssn: "999-99-0001" },
      facility: { facilityId: "F101" },
    })),
  });
  const result = modifyContent(
    filePath,
    "26S600001",
    null,
    "999-99-0001",
    1,
    1,
    {},
    1,
    preparePatientIdSettings({ mode: PATIENT_ID_MODES.REFERRAL_MATCH }),
    1,
    { selectedFacilityIds: ["F101", "F102", "F104"], referralPrefix: "RF" }
  );
  const referrals = JSON.parse(result.content).referrals;
  assert.equal(new Set(referrals.map((item) => item.referralNumber)).size, referrals.length);
  for (const referral of referrals) {
    assert.equal(referral.patient.patientId, generatePatientIdFromReferralNumber(referral.referralNumber));
    assert.equal(["F101", "F102", "F104"].includes(referral.facility.facilityId), true);
  }
  assert.equal(new Set(referrals.map((item) => item.facility.facilityId)).size, 3);
});

test("Long Referral Numbers stay complete while Referral-derived Patient IDs remain unique and 17 characters", () => {
  const filePath = writeJsonFixture("long-matched-referrals.json", {
    referrals: Array.from({ length: 3 }, (_, index) => ({
      referralNumber: `RF${index + 1}`,
      patient: { patientId: String(index + 1), firstName: "A", lastName: "B", ssn: "999-99-0001" },
    })),
  });
  const result = modifyContent(
    filePath,
    "12345678901234567890",
    null,
    "999-99-0001",
    1,
    1,
    {},
    1,
    preparePatientIdSettings({ mode: PATIENT_ID_MODES.REFERRAL_MATCH }),
    1,
    { referralPrefixMode: "mixed" }
  );
  const referrals = JSON.parse(result.content).referrals;
  assert.deepEqual(
    referrals.map((item) => item.referralNumber),
    [
      "RFALT12345678901234567890",
      "RFALT12345678901234567891",
      "RFALT12345678901234567892",
    ]
  );
  assert.equal(new Set(referrals.map((item) => item.patient.patientId)).size, referrals.length);
  assert.equal(referrals.every((item) => item.patient.patientId.length === 17), true);
  assert.deepEqual(
    referrals.map((item) => item.patient.patientId),
    ["TEST1234567890121", "TEST1234567890122", "TEST1234567890123"]
  );
});

test("Generated batches keep referral numbers unique and share timestamped ALT JSON and gzip names", async () => {
  const outputDir = path.join(tempRoot, "alt-generated-batch");
  fs.mkdirSync(outputDir, { recursive: true });
  const generatedRun = await backend.handleCommand("generate", {
    outputDir,
    fileCount: 3,
    referralsPerFile: 4,
    patientIdSettings: { mode: PATIENT_ID_MODES.REFERRAL_MATCH },
    identityOptions: {
      randomizeSsn: true,
      randomizeDob: true,
      randomizeFacilityId: false,
      selectedFacilityIds: ["F101", "F104"],
      referralPrefix: "ALT",
    },
    archiveBasename: "referrals",
    archiveNamingOptions: { useAltPrefix: true },
    keepProcessedJson: true,
  });

  assert.equal(fs.readdirSync(outputDir).some((name) => name.endsWith(".manifest.json")), false);
  await backend.handleCommand("generate-manifest", { runId: generatedRun.run.runId });
  const names = fs.readdirSync(outputDir).sort();
  const gzipName = names.find((name) => name.endsWith(".gz"));
  const manifestName = names.find((name) => name.endsWith(".manifest.json"));
  const jsonNames = names.filter((name) => name.endsWith(".json") && !name.endsWith(".manifest.json") && !name.endsWith("_Master.json"));
  assert.match(gzipName, /^ALT_referrals_\d{8}_\d{6}\.gz$/);
  assert.equal(jsonNames.length, 3);
  assert.equal(jsonNames.every((name) => name.startsWith(gzipName.slice(0, -3))), true);
  assert.match(manifestName, /^ALT_referrals_\d{8}_\d{6}\.manifest\.json$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, manifestName), "utf8"));
  assert.equal(manifest.referralNumbers.unique, true);
  assert.equal(manifest.counts.referrals, 12);
  assert.match(manifest.archive.sha256, /^[a-f0-9]{64}$/);

  const referrals = jsonNames.flatMap((name) => JSON.parse(
    fs.readFileSync(path.join(outputDir, name), "utf8")
  ).referrals);
  assert.equal(referrals.length, 12);
  assert.equal(new Set(referrals.map(referralNumberOf)).size, referrals.length);
  for (const referral of referrals) {
    assert.match(referralNumberOf(referral), /^ALT/);
    assert.equal(referral.patient.patientId, generatePatientIdFromReferralNumber(referralNumberOf(referral)));
    assert.equal(["F101", "F104"].includes(facilityIdOf(referral)), true);
  }
});

test("Keep existing files preserves unrelated JSON and excludes it from the new archive", async () => {
  const outputDir = path.join(tempRoot, "keep-existing-output");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "unrelated.json"), JSON.stringify({ referrals: [{ referralNumber: "OLD" }] }), "utf8");

  const result = await backend.handleCommand("generate", {
    outputDir,
    fileCount: 1,
    referralsPerFile: 2,
    clearOutput: false,
    keepProcessedJson: false,
    archiveBasename: "safe_keep_test",
    identityOptions: { referralPrefix: "RF" },
    upload: { enabled: false },
  });

  assert.equal(fs.existsSync(path.join(outputDir, "unrelated.json")), true);
  const archived = JSON.parse(zlib.gunzipSync(fs.readFileSync(result.archivePath)).toString("utf8"));
  assert.equal(archived.referrals.length, 2);
  assert.equal(archived.referrals.some((referral) => referral.referralNumber === "OLD"), false);
});

test("A malformed source stops the batch before output or upload artifacts are created", async () => {
  const inputDir = path.join(tempRoot, "fail-closed-input");
  const outputDir = path.join(tempRoot, "fail-closed-output");
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(inputDir, "valid.json"), JSON.stringify({ referrals: [{ referralNumber: "RF0000000001" }] }), "utf8");
  fs.writeFileSync(path.join(inputDir, "invalid.json"), "{ invalid", "utf8");
  fs.writeFileSync(path.join(outputDir, "existing.txt"), "preserve", "utf8");

  await assert.rejects(
    backend.handleCommand("process", {
      inputDir,
      outputDir,
      archiveBasename: "should_not_exist",
      clearOutput: true,
      keepProcessedJson: true,
      upload: { enabled: false },
    }),
    /preflight schema validation failed/
  );
  assert.deepEqual(fs.readdirSync(outputDir), ["existing.txt"]);
});

test("modifyContent keeps the selected Payment Authority Code across referrals", () => {
  const filePath = writeJsonFixture("override-referrals.json", {
    listDate: "2026-01-01 00:00:00",
    referrals: [
      {
        referralNumber: "RF0000000001",
        paymentAuthorityCode: "12000",
        patientId: "1",
        firstName: "John",
        lastName: "Doe",
        ssn: "111-11-1111",
      },
      {
        referralNumber: "RF0000000002",
        paymentAuthorityCode: "12000",
        patientId: "2",
        firstName: "Jane",
        lastName: "Doe",
        ssn: "222-22-2222",
      },
    ],
  });

  const result = modifyContent(
    filePath,
    "200",
    "2026-03-26 11:30:00",
    "999-99-0001",
    1,
    1,
    { paymentAuthorityCode: "21" },
    1
  );
  const parsed = JSON.parse(result.content);

  assert.deepEqual(
    parsed.referrals.map((item) => item.paymentAuthorityCode),
    ["21", "21"]
  );
  assert.deepEqual(
    parsed.referrals.map((item) => item.referralNumber),
    ["RF0000000200", "RF0000000201"]
  );
  assert.equal(parsed.listDate, "2026-03-26 11:30:00");
});

test("modifyContent keeps TEST and generates unique Patient IDs by default", () => {
  const filePath = writeJsonFixture("default-patientId.json", {
    referrals: [
      {
        referralNumber: "RF0000000001",
        patientId: "1",
        firstName: "John",
        lastName: "Doe",
        ssn: "111-11-1111",
      },
      {
        referralNumber: "RF0000000002",
        patientId: "2",
        firstName: "Jane",
        lastName: "Doe",
        ssn: "222-22-2222",
      },
    ],
  });

  const result = modifyContent(filePath, "", null, "999-99-0001", 1, 1, {}, 1);
  const parsed = JSON.parse(result.content);

  assert.match(parsed.referrals[0].patientId, /^TEST\d{13}$/);
  assert.match(parsed.referrals[1].patientId, /^TEST\d{13}$/);
  assert.notEqual(parsed.referrals[0].patientId, parsed.referrals[1].patientId);
});

test("modifyContent supports a custom suffix after TEST", () => {
  const filePath = writeJsonFixture("custom-test-patientId.json", {
    referrals: [
      {
        referralNumber: "RF0000000001",
        patientId: "1",
        firstName: "John",
        lastName: "Doe",
        ssn: "111-11-1111",
      },
      {
        referralNumber: "RF0000000002",
        patientId: "2",
        firstName: "Jane",
        lastName: "Doe",
        ssn: "222-22-2222",
      },
    ],
  });

  const result = modifyContent(
    filePath,
    "",
    null,
    "999-99-0001",
    1,
    1,
    {},
    1,
    preparePatientIdSettings({ mode: PATIENT_ID_MODES.TEST_CUSTOM_SUFFIX, value: "Ab12" }),
    1
  );
  const parsed = JSON.parse(result.content);

  assert.match(parsed.referrals[0].patientId, /^TESTAb12[A-Z0-9]{9}$/);
  assert.match(parsed.referrals[1].patientId, /^TESTAb12[A-Z0-9]{9}$/);
  assert.notEqual(parsed.referrals[0].patientId, parsed.referrals[1].patientId);
});

test("modifyContent supports a fully custom Patient ID base", () => {
  const filePath = writeJsonFixture("custom-full-patientId.json", {
    referrals: [
      {
        referralNumber: "RF0000000001",
        patientId: "1",
        firstName: "John",
        lastName: "Doe",
        ssn: "111-11-1111",
      },
      {
        referralNumber: "RF0000000002",
        patientId: "2",
        firstName: "Jane",
        lastName: "Doe",
        ssn: "222-22-2222",
      },
    ],
  });

  const result = modifyContent(
    filePath,
    "",
    null,
    "999-99-0001",
    1,
    1,
    {},
    1,
    preparePatientIdSettings({ mode: PATIENT_ID_MODES.CUSTOM_FULL, value: "AbCd12" }),
    1
  );
  const parsed = JSON.parse(result.content);

  assert.match(parsed.referrals[0].patientId, /^AbCd12[A-Z0-9]{11}$/);
  assert.equal(parsed.referrals[0].patientId.length, 17);
  assert.equal(parsed.referrals[1].patientId.length, 17);
  assert.notEqual(parsed.referrals[0].patientId, parsed.referrals[1].patientId);
});

test("modifyContent replaces invalid source payment values with approved team codes", () => {
  const filePath = writeJsonFixture("invalid-payment-authority-code.json", {
    referrals: [
      {
        referralNumber: "RF0000000001",
        paymentAuthorityCode: "123456",
        patientId: "1",
        firstName: "John",
        lastName: "Doe",
        ssn: "111-11-1111",
      },
    ],
  });

  const result = modifyContent(filePath, "", null, "999-99-0001", 1, 1, {}, 1);
  assert.equal(require("../electron/backend/paymentAuthorityCatalog").codes.includes(JSON.parse(result.content).referrals[0].paymentAuthorityCode), true);
});

test("runtime cleanup removes tracked temp directories and stale known temp files", () => {
  const trackedDir = registerTemporaryPath(fs.mkdtempSync(path.join(os.tmpdir(), "dgfp_referral_generator_")));
  fs.writeFileSync(path.join(trackedDir, "generated.json"), "{}", "utf8");

  const staleWinscpScript = path.join(os.tmpdir(), `winscp_upload_${Date.now()}_smoke.txt`);
  fs.writeFileSync(staleWinscpScript, "exit", "utf8");
  const staleDate = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(staleWinscpScript, staleDate, staleDate);

  const removedStaleCount = cleanupKnownTemporaryArtifacts({ minimumAgeMs: 5 * 60 * 1000 });
  assert.equal(removedStaleCount, 1);
  assert.equal(fs.existsSync(staleWinscpScript), false);

  const removedRuntimeCount = cleanupRuntimeArtifacts();
  assert.equal(removedRuntimeCount >= 1, true);
  assert.equal(fs.existsSync(trackedDir), false);
});

test("Upload profile summary reports server and user counts", () => {
  const summary = summarizeUploadProfiles({
    servers: [{ name: "DEV" }, { name: "SQA" }],
    users: [{ name: "devuser" }, { name: "sqauser" }, { name: "extrauser" }],
  });

  assert.deepEqual(summary, {
    serverCount: 2,
    userCount: 3,
    targetNames: ["DEV", "SQA"],
  });
});

test("App info exposes the complete searchable facility source", async () => {
  const info = await backend.handleCommand("info", {});

  assert.equal(Array.isArray(info.facilities), true);
  assert.equal(info.facilities.every((facility) => /^[A-Za-z0-9]{1,5}$/.test(facility.facility_id)), true);

  const facilityKeys = info.facilities.map((facility) => facility.facility_key);
  assert.equal(new Set(facilityKeys).size, facilityKeys.length);

  const sample = info.facilities.find((facility) => facility.facility_id === "F101");
  assert.equal(Boolean(sample), true);
  assert.match(sample.facility_name, /Maple Grove Community Clinic/);
  const cedar = info.facilities.find((facility) => facility.facility_id === "F102");
  assert.equal(Boolean(cedar), true);
  assert.match(cedar.facility_name, /Riverbend Regional Medical Center/);
  assert.equal(Object.hasOwn(info.constants, "facilityIdMaxLength"), false);
});

test("App info exposes valid synchronized Care Package pairs", async () => {
  const info = await backend.handleCommand("info", {});
  assert.equal(Array.isArray(info.carePackageOptions), true);
  assert.equal(info.carePackageOptions.length, 12);
  assert.equal(Array.isArray(info.situationalCarePackageOptions), true);
  assert.equal(info.situationalCarePackageOptions.length, 3);
  const hearing = info.carePackageOptions.find((option) => option.displayName === "AUD_HEARING EVALUATION - 101");
  assert.equal(hearing.carePackageKey, "101");
  assert.equal(hearing.carePackageNumber, "101");
  assert.equal(hearing.carePackageId, "AUD_HEARING EVALUATION_1.0.1");
  assert.equal(resolveCarePackageSelection([hearing.selectorKey])[0].carePackageId, hearing.carePackageId);
  assert.equal(resolveCarePackageSelection([], true).length, 12);
  assert.equal(resolveCarePackageSelection([], true, "situational").length, 3);
  assert.deepEqual(
    getSituationalCarePackageOptions().map((option) => [option.carePackageNumber, option.carePackageId]),
    [
      ["202", "BHR_BEHAVIORAL HEALTH RESIDENTIAL_1.1.0"],
      ["201", "EMR_EMERGENCY CARE_1.0.0"],
      ["203", "TRN_TRANSPLANT EVALUATION_1.0.3"],
    ]
  );
  const regularIdentities = new Set(info.carePackageOptions.map((option) => `${option.carePackageNumber}\u0000${option.name}`));
  assert.equal(
    info.situationalCarePackageOptions.some((option) => regularIdentities.has(`${option.carePackageNumber}\u0000${option.name}`)),
    false
  );
  assert.throws(() => resolveCarePackageSelection(["missing::value"]), /no longer available/);
});

test("Care Package and Situational Care Package selections remain paired in generated output", () => {
  const specialKeys = new Set(["201", "202", "203"]);
  const template = JSON.parse(fs.readFileSync(path.join(projectRoot, "templates", "referral-template.json"), "utf8"));
  assert.equal(specialKeys.has(String(template.referral.referral?.carePackageKey || "")), false);

  const filePath = writeJsonFixture("special-carePackage.json", {
    referrals: [{
      referralNumber: "RF0000000001",
      patient: { patientId: "1", firstName: "A", lastName: "B", ssn: "999-99-0001" },
      facility: { facilityId: "F101", carePackageKey: "69", carePackageId: "OLD_PACKAGE_1.0.0" },
    }],
  });
  const result = modifyContent(
    filePath,
    "",
    null,
    "999-99-0001",
    1,
    1,
    {},
    1,
    preparePatientIdSettings(),
    1,
    {
      selectedCarePackagePairs: [{ carePackageKey: "1", carePackageId: "AUD_HEARING EVALUATION_1.0.17" }],
      selectedSituationalCarePackagePairs: [{ carePackageKey: "201", carePackageId: "EMR_EMERGENCY CARE_1.2.8" }],
    }
  );
  const authority = JSON.parse(result.content).referrals[0].facility;
  assert.equal(authority.carePackageKey, "1");
  assert.equal(authority.carePackageId, "AUD_HEARING EVALUATION_1.0.17");
  assert.equal(authority.situationalCarePackageKey, "201");
  assert.equal(authority.situationalCarePackageId, "EMR_EMERGENCY CARE_1.2.8");
});

test("Archive basename can append Network and Referral DateTime safely", () => {
  const now = new Date(2026, 3, 2, 9, 8, 7);
  const archiveBasename = buildArchiveBasename({
    archiveBasename: "My Custom Export",
    archiveNamingOptions: {
      includeNetwork: true,
      includeReferralDateTime: true,
    },
    optionalOverrides: {
      network: "NET1",
      referralDateTime: "2026-04-01 13:45:00",
    },
  }, now);

  assert.equal(archiveBasename, "My_Custom_Export_NET1_2026-04-01_134500_20260402_090807");
  assert.equal(formatArchiveReferralDateTime("2026-04-01 13:45:00"), "2026-04-01_134500");
  assert.equal(formatCurrentDateTime(now), "20260402_090807");
  assert.equal(
    buildArchiveBasename({
      archiveBasename: "referrals",
      archiveNamingOptions: { useAltPrefix: true },
    }, now),
    "ALT_referrals_20260402_090807"
  );
  assert.equal(
    buildArchiveBasename({
      archiveBasename: "ALT_referrals",
      archiveNamingOptions: { useAltPrefix: true },
    }, now),
    "ALT_referrals_20260402_090807"
  );
});

test("Archive naming modes share safe JSON and gzip filenames", () => {
  const now = new Date(2026, 7, 31, 16, 25, 0);
  const basePayload = {
    referralReplacementCode: "12345",
    identityOptions: { referralPrefixMode: "standard" },
    optionalOverrides: { network: "Network1", referralDateTime: "2026-08-31 16:25:00" },
  };
  const scenarios = [
    ["referral-number", "RF12345_Final"],
    ["network", "Network1_RF12345_Final"],
    ["referral-date-time", "RF12345_2026-08-31_162500_Final"],
  ];
  for (const [mode, expected] of scenarios) {
    assert.equal(buildArchiveBasename({ ...basePayload, archiveNamingOptions: { mode } }, now), expected);
  }
  const custom = buildOutputFileNames({
    ...basePayload,
    archiveNamingOptions: {
      mode: "custom",
      customText: "DEV:DGFP",
      customValues: ["referralNumber", "customText"],
    },
  }, now);
  assert.deepEqual(custom, {
    basename: "RF12345_DEV_DGFP_Final",
    json: "RF12345_DEV_DGFP_Final.json",
    gzip: "RF12345_DEV_DGFP_Final.gz",
  });
  assert.equal(
    buildArchiveBasename({ ...basePayload, archiveNamingOptions: { mode: "prefix" } }, now),
    "RF12345_Final"
  );
  assert.equal(
    buildArchiveBasename({
      ...basePayload,
      optionalOverrides: {
        network: "Network1",
        referralDate: "2026-08-30",
        referralDateTime: "2026-08-31 16:25:00",
      },
      archiveNamingOptions: {
        mode: "custom",
        customText: "DEV",
        customValues: ["customText", "dateTime", "date", "networkName", "referralPrefix", "referralNumber"],
      },
    }, now),
    "RF12345_RF_Network1_2026-08-30_2026-08-31_162500_DEV_Final"
  );
  assert.throws(
    () => buildArchiveBasename({ ...basePayload, archiveNamingOptions: { mode: "custom", customValues: [] } }, now),
    /Choose at least one value/
  );
  assert.throws(
    () => buildArchiveBasename({
      ...basePayload,
      optionalOverrides: {},
      archiveNamingOptions: { mode: "custom", customValues: ["networkName"] },
    }, now),
    /Choose a Network/
  );
  assert.throws(
    () => buildArchiveBasename({
      ...basePayload,
      archiveNamingOptions: { mode: "custom", customValues: ["customText"] },
    }, now),
    /Enter Custom text/
  );
});

test("UI settings normalize legacy theme values and persist user choices", () => {
  const originalOverride = process.env.DGFP_USER_DATA_ROOT;
  const settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-user-settings-"));

  try {
    process.env.DGFP_USER_DATA_ROOT = settingsRoot;

    const normalized = normalizeUiSettings({
      theme_mode: "Dark",
      archiveAppendNetwork: true,
      archiveAppendReferralDateTime: true,
      archiveBasename: "my_exports",
      uploadTargets: {
        DEV: {
          enabled: true,
          userName: "devuser",
          remoteDirectory: "/referral_uploads",
        },
      },
    });

    assert.equal(normalized.theme, "dark");
    assert.equal(normalized.archiveAppendNetwork, true);
    assert.equal(normalized.archiveAppendReferralDateTime, true);
    assert.equal(normalized.uploadTargets.DEV.userName, "devuser");
    assert.equal(normalized.acknowledgedReleaseKey, "");
    assert.equal(normalizeUiSettings({ useAltReferralPrefix: true }).referralPrefixMode, "alt");
    assert.equal(normalizeUiSettings({ referralPrefixMode: "mixed" }).referralPrefixMode, "custom");
    assert.equal(
      normalizeUiSettings({ referralPrefixMode: "custom", customReferralPrefix: "DGFP_TEST" }).customReferralPrefix,
      "DGFP_TEST"
    );
    assert.equal(
      normalizeUiSettings({ referralPrefixMode: "custom", customReferralPrefix: "DGFP-TEST_" }).customReferralPrefix,
      "DGFP-TEST_"
    );
    const longReferralPrefix = "DGFP_LONG_REFERRAL_PREFIX_WITHOUT_A_CHARACTER_LIMIT";
    assert.equal(
      normalizeUiSettings({ referralPrefixMode: "custom", customReferralPrefix: longReferralPrefix }).customReferralPrefix,
      longReferralPrefix
    );
    const namedSettings = normalizeUiSettings({
      archiveNamingMode: "custom",
      archiveCustomText: "DEV",
      archiveCustomValues: ["networkName", "referralNumber", "networkName"],
      selectedCarePackageKeys: ["1::A", "1::A"],
      useAllSituationalCarePackages: true,
    });
    assert.equal(namedSettings.schemaVersion, 4);
    assert.equal(namedSettings.archiveNamingMode, "custom");
    assert.deepEqual(namedSettings.archiveCustomValues, ["referralNumber", "networkName"]);
    assert.deepEqual(namedSettings.selectedCarePackageKeys, ["1::A"]);
    assert.equal(namedSettings.useAllSituationalCarePackages, true);
    assert.deepEqual(
      normalizeUiSettings({ overrideCarePackageKey: "107", overrideCarePackageId: "PMR_PHYSICAL THERAPY_1.0.12_PRCT" }).selectedCarePackageKeys,
      ["107::PMR_PHYSICAL%20THERAPY_1.0.12_PRCT"]
    );

    saveUiSettings({
      ...DEFAULT_UI_SETTINGS,
      theme: "dark",
      archiveBasename: "session_export",
      archiveAppendNetwork: true,
      archiveNamingMode: "custom",
      archiveCustomValues: ["referralNumber", "customText"],
      archiveCustomText: "DGFP",
      selectedCarePackageKeys: ["1::PMR"],
      selectedSituationalCarePackageKeys: ["107::PT"],
      acknowledgedReleaseKey: "1.2.0|Production V1.2",
    });

    const loaded = loadUiSettings();
    assert.equal(loaded.theme, "dark");
    assert.equal(loaded.archiveBasename, "session_export");
    assert.equal(loaded.archiveAppendNetwork, true);
    assert.equal(loaded.archiveNamingMode, "custom");
    assert.equal(loaded.archiveCustomText, "DGFP");
    assert.deepEqual(loaded.archiveCustomValues, ["referralNumber", "customText"]);
    assert.deepEqual(loaded.selectedCarePackageKeys, ["1::PMR"]);
    assert.deepEqual(loaded.selectedSituationalCarePackageKeys, ["107::PT"]);
    assert.equal(loaded.acknowledgedReleaseKey, "1.2.0|Production V1.2");
    assert.deepEqual(
      normalizeUiSettings({ archiveCustomPattern: "{customText}_{referralNumber}_Final" }).archiveCustomValues,
      ["referralNumber", "customText"]
    );
    assert.equal(normalizeUiSettings({ archiveNamingMode: "prefix" }).archiveNamingMode, "referral-number");
  } finally {
    if (originalOverride === undefined) {
      delete process.env.DGFP_USER_DATA_ROOT;
    } else {
      process.env.DGFP_USER_DATA_ROOT = originalOverride;
    }
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  }
});

test("App info exposes one-time release announcement metadata", async () => {
  const originalOverride = process.env.DGFP_USER_DATA_ROOT;
  const settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-release-announcement-"));

  try {
    process.env.DGFP_USER_DATA_ROOT = settingsRoot;

    const initialInfo = await backend.handleCommand("info", {});
    assert.equal(initialInfo.appVersion.version, "1.5.3");
    assert.equal(initialInfo.appVersion.label, "Version 1.5.3");
    assert.equal(Array.isArray(initialInfo.releaseAnnouncement.notes), true);
    assert.equal(initialInfo.releaseAnnouncement.notes.length > 0, true);
    assert.equal(initialInfo.releaseAnnouncement.shouldShow, true);

    await backend.handleCommand("acknowledge-release-announcement", {
      releaseKey: initialInfo.releaseAnnouncement.releaseKey,
    });

    const acknowledgedInfo = await backend.handleCommand("info", {});
    assert.equal(acknowledgedInfo.releaseAnnouncement.shouldShow, false);
    assert.equal(loadUiSettings().acknowledgedReleaseKey, initialInfo.releaseAnnouncement.releaseKey);
  } finally {
    if (originalOverride === undefined) {
      delete process.env.DGFP_USER_DATA_ROOT;
    } else {
      process.env.DGFP_USER_DATA_ROOT = originalOverride;
    }
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  }
});

test("Release notes appear once after upgrading from an older release", async () => {
  const originalOverride = process.env.DGFP_USER_DATA_ROOT;
  const settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-release-upgrade-"));
  const olderReleaseKey = "v1.2.5|Version 1.2.5|2026-08-19";

  try {
    process.env.DGFP_USER_DATA_ROOT = settingsRoot;
    saveUiSettings({
      ...DEFAULT_UI_SETTINGS,
      acknowledgedReleaseKey: olderReleaseKey,
    });

    const upgradedInfo = await backend.handleCommand("info", {});
    assert.equal(upgradedInfo.releaseAnnouncement.acknowledgedReleaseKey, olderReleaseKey);
    assert.notEqual(upgradedInfo.releaseAnnouncement.releaseKey, olderReleaseKey);
    assert.equal(upgradedInfo.releaseAnnouncement.notes.length > 0, true);
    assert.equal(upgradedInfo.releaseAnnouncement.shouldShow, true);

    await backend.handleCommand("acknowledge-release-announcement", {
      releaseKey: upgradedInfo.releaseAnnouncement.releaseKey,
    });

    const acknowledgedInfo = await backend.handleCommand("info", {});
    assert.equal(acknowledgedInfo.releaseAnnouncement.shouldShow, false);
  } finally {
    if (originalOverride === undefined) {
      delete process.env.DGFP_USER_DATA_ROOT;
    } else {
      process.env.DGFP_USER_DATA_ROOT = originalOverride;
    }
    fs.rmSync(settingsRoot, { recursive: true, force: true });
  }
});

test("LEIE inspection detects duplicates and LEIE processing removes them when configured", async () => {
  const sourceDir = fs.mkdtempSync(path.join(tempRoot, "leie-source-"));
  const outputDir = fs.mkdtempSync(path.join(tempRoot, "leie-output-"));
  const sourcePath = path.join(sourceDir, "leie_source.xlsx");

  writeXlsxFixture(sourcePath, [
    { ssn: "111-11-1111", NPI: "1234567890", Name: "A" },
    { ssn: "222-22-2222", NPI: "1234567891", Name: "B" },
    { ssn: "111-11-1111", NPI: "1234567890", Name: "A" },
  ]);

  const inspection = await backend.handleCommand("inspect-leie-source", {
    inputDir: sourceDir,
    duplicateKey: "full-row",
  });

  assert.equal(inspection.fileCount, 1);
  assert.equal(inspection.outputNameSuggestion, "leie_source");
  assert.equal(inspection.hasDuplicates, true);
  assert.equal(inspection.duplicates.length, 1);
  assert.equal(inspection.duplicates[0].rowNumber, 4);

  await assert.rejects(
    backend.handleCommand("process-leie", {
      inputDir: sourceDir,
      outputDir,
      outputFileName: "processed_leie",
      duplicateKey: "full-row",
      duplicateHandling: "manual",
      upload: { enabled: false, targets: [] },
    }),
    /Duplicates were found/
  );

  const processed = await backend.handleCommand("process-leie", {
    inputDir: sourceDir,
    outputDir,
    outputFileName: "processed_leie",
    duplicateKey: "full-row",
    duplicateHandling: "auto-remove",
    upload: { enabled: false, targets: [] },
  });

  assert.equal(processed.outputFileName, "processed_leie.xlsx");
  assert.equal(fs.existsSync(path.join(outputDir, "processed_leie.xlsx")), true);
  assert.equal(processed.duplicatesRemoved, 1);

  const defaultNamed = await backend.handleCommand("process-leie", {
    inputDir: sourceDir,
    outputDir,
    outputFileName: "",
    duplicateKey: "full-row",
    duplicateHandling: "auto-remove",
    upload: { enabled: false, targets: [] },
  });

  assert.equal(defaultNamed.outputFileName, "leie_source.xlsx");
  assert.equal(fs.existsSync(path.join(outputDir, "leie_source.xlsx")), true);
});

test("SFTP upload verifies the remote file and does not hang when disconnect stalls", async () => {
  const localPath = path.join(tempRoot, "verified-upload.xlsx");
  fs.writeFileSync(localPath, "verified upload payload", "utf8");
  let destroyed = false;
  let uploadedRemotePath = "";

  const fakeClient = {
    client: {
      destroy() {
        destroyed = true;
      },
    },
    async connect() {},
    async stat(remotePath) {
      if (remotePath.endsWith("verified-upload.xlsx")) {
        return { size: fs.statSync(localPath).size };
      }
      return { type: "d" };
    },
    async mkdir() {},
    async put(_sourcePath, remotePath) {
      uploadedRemotePath = remotePath;
    },
    end() {
      return new Promise(() => {});
    },
  };

  const remotePath = await uploadFileWithSftp(
    localPath,
    "/incoming/leie",
    { host: "example.test", port: 22, username: "tester", password: "secret" },
    fakeClient,
    { connectTimeoutMs: 100, operationTimeoutMs: 100, closeTimeoutMs: 10 }
  );

  assert.equal(remotePath, "/incoming/leie/verified-upload.xlsx");
  assert.equal(uploadedRemotePath, remotePath);
  assert.equal(destroyed, true);
});

test("App info points to the PDF user guide when built, otherwise the Markdown guide", async () => {
  const info = await backend.handleCommand("info", {});
  assert.equal(typeof info.docs?.userGuidePath, "string");
  assert.match(info.docs.userGuidePath, /USER_GUIDE\.(pdf|md)$/);
});

test("Preview validation reports field-level errors without throwing", async () => {
  const preview = await backend.handleCommand("preview", {
    referralReplacementCode: "123",
    patientIdSettings: {
      mode: PATIENT_ID_MODES.TEST_CUSTOM_SUFFIX,
      value: "",
    },
    ssnValue: "9999990001",
    identityOptions: { randomizeSsn: false },
    optionalOverrides: {
      dateOfBirth: "2026/03/26",
      paymentAuthorityCode: "100000",
    },
    fileCount: 0,
    referralsPerFile: 0,
    upload: {
      enabled: true,
      targets: [{ server_name: "DEV", user_name: "", remote_directory: "" }],
    },
  });

  assert.equal(preview.fieldErrors.ssnValue, "SSN must start with 999 and use the format 999-99-0001.");
  assert.equal(preview.fieldErrors.patientIdValue, "Enter up to 13 letters or numbers after TEST.");
  assert.equal(preview.fieldErrors.paymentAuthorityCode, "Choose a Payment Authority Code from the configured reference list.");
  assert.equal(preview.fieldErrors.dateOfBirth, "Date of Birth must use the format YYYY-MM-DD.");
  assert.equal(preview.fieldErrors.fileCount, "Number of JSON files to generate must be greater than zero.");
  assert.equal(preview.fieldErrors.referralsPerFile, "Number of referrals per file must be greater than zero.");
  assert.equal(preview.fieldErrors["upload:DEV:user_name"], "Please choose a user for DEV.");
  assert.equal(
    preview.fieldErrors["upload:DEV:remote_directory"],
    "Please enter the remote upload location for DEV."
  );
});

test("Live preview resolves Referral Number, formatted Patient ID, and archive tokens together", async () => {
  const preview = await backend.handleCommand("preview", {
    referralReplacementCode: "26S600001",
    identityOptions: { referralPrefixMode: "custom", customReferralPrefix: "DGFP" },
    patientIdSettings: { mode: PATIENT_ID_MODES.REFERRAL_MATCH },
    archiveNamingOptions: {
      mode: "custom",
      customText: "DEV",
      customValues: ["referralNumber", "referralPrefix", "customText"],
    },
    optionalOverrides: {},
    fileCount: 1,
    referralsPerFile: 1,
  });

  assert.equal(preview.referralNumber, "DGFP26S600001");
  assert.equal(preview.patientIdPreview, "Preview: TEST000026S600001");
  assert.equal(preview.outputFileNames.json, "DGFP26S600001_DGFP_DEV_Final.json");
  assert.equal(preview.outputFileNames.gzip, "DGFP26S600001_DGFP_DEV_Final.gz");
});

test("Preview validation requires archive naming fields when append options are enabled", async () => {
  const preview = await backend.handleCommand("preview", {
    archiveBasename: "customname",
    archiveNamingOptions: {
      includeNetwork: true,
      includeReferralDateTime: true,
    },
    optionalOverrides: {
      network: "",
      referralDateTime: "",
    },
  });

  assert.equal(
    preview.fieldErrors.archiveBasename,
    "Choose a Network before adding it to the archive name."
  );
});

test("Release export uses the display label for shareable file names", () => {
  assert.equal(
    getDisplayVersion({ label: "Production V1.1 <>:/\\|?*" }, { version: "1.1.0" }),
    "Production V1.1"
  );
  assert.equal(getDisplayVersion({ label: "" }, { version: "1.1.0" }), "1.1.0");
});

test("Windows packaging targets only the setup installer", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const targetNames = packageJson.build.win.target.map((target) => target.target);

  assert.deepEqual(targetNames, ["nsis"]);
  assert.equal(Object.hasOwn(packageJson.scripts, "dist:portable"), false);
});

test("Release builds use temporary storage outside the project", () => {
  const paths = resolveReleasePaths({ repoRoot: projectRoot });

  assert.doesNotThrow(() => assertSafeTemporaryWorkRoot(paths.workRoot, projectRoot));
  assert.throws(
    () => assertSafeTemporaryWorkRoot(projectRoot, projectRoot),
    /unsafe release work directory/
  );
  assert.throws(
    () => assertPathInsideWorkRoot(projectRoot, paths.workRoot),
    /must stay inside the temporary work directory/
  );
});

test("Release export copies only the verified setup executable into release", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-release-export-"));

  try {
    fs.mkdirSync(path.join(repoRoot, "config"), { recursive: true });
    const distRoot = path.join(repoRoot, "temporary-dist");
    const releaseRoot = path.join(repoRoot, "temporary-publish");
    fs.mkdirSync(distRoot, { recursive: true });
    fs.mkdirSync(releaseRoot, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ version: "1.1.0" }, null, 2)
    );
    fs.writeFileSync(
      path.join(repoRoot, "config", "app_version.json"),
      JSON.stringify({ version: "1.1.0", label: "Production V1.1" }, null, 2)
    );

    const setupSource = path.join(
      repoRoot,
      "temporary-dist",
      "Data Generator & File Processing Setup 1.1.0.exe"
    );

    writeWindowsExecutableFixture(setupSource);
    const stalePortableOutput = path.join(
      repoRoot,
      "temporary-publish",
      "Data Generator & File Processing Production V1.0.exe"
    );
    writeWindowsExecutableFixture(stalePortableOutput);

    const result = exportReleaseArtifacts({ repoRoot, distRoot, releaseRoot });

    const setupOutput = path.join(
      repoRoot,
      "temporary-publish",
      "Data Generator & File Processing Setup Production V1.1.exe"
    );

    assert.equal(result.exportedPaths.length, 1);
    assert.equal(fs.existsSync(stalePortableOutput), false);
    assert.equal(fs.existsSync(setupOutput), true);
    assert.equal(isRealWindowsExecutable(setupOutput), true);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("Release export rejects incomplete executables", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-release-invalid-"));

  try {
    fs.mkdirSync(path.join(repoRoot, "config"), { recursive: true });
    const distRoot = path.join(repoRoot, "temporary-dist");
    const releaseRoot = path.join(repoRoot, "temporary-publish");
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({ version: "1.1.0" }, null, 2)
    );
    fs.writeFileSync(
      path.join(repoRoot, "config", "app_version.json"),
      JSON.stringify({ version: "1.1.0", label: "Production V1.1" }, null, 2)
    );

    const setupSource = path.join(distRoot, "Data Generator & File Processing Setup 1.1.0.exe");
    fs.writeFileSync(setupSource, "version https://git-lfs.github.com/spec/v1\n");

    assert.throws(
      () => exportReleaseArtifacts({ repoRoot, distRoot, releaseRoot }),
      /Git LFS pointer|verified Windows executable/
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

(async () => {
  try {
    for (const { name, callback } of tests) {
      try {
        await callback();
        console.log(`PASS ${name}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}`);
        console.error(`  ${error.message}`);
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (failures > 0) {
    process.exitCode = 1;
  } else {
    console.log("Smoke tests passed.");
  }
})();
