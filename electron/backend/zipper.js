const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { once } = require("events");
const { finished } = require("node:stream/promises");

const DEFAULT_ARCHIVE_BASENAME = "referrals";
const ALT_FILENAME_PREFIX = "ALT";
const RF_ALT_FILENAME_PREFIX = "RFALT";
const ARCHIVE_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const ARCHIVE_NAMING_MODES = {
  REFERRAL_NUMBER: "referral-number",
  NETWORK: "network",
  REFERRAL_DATE_TIME: "referral-date-time",
  CUSTOM: "custom",
};
const ARCHIVE_CUSTOM_VALUES = [
  "referralNumber",
  "referralPrefix",
  "networkName",
  "date",
  "dateTime",
  "customText",
];

function sanitizeArchiveBasename(value) {
  let basename = (value || "").trim();
  if (!basename) {
    return DEFAULT_ARCHIVE_BASENAME;
  }

  basename = basename.replace(/(?:\.(?:json|gz))+$/i, "");
  basename = basename.replace(/\s+/g, "_");
  basename = basename.replace(/[<>:"/\\|?*]+/g, "_");
  basename = basename.replace(/_+/g, "_");
  basename = basename.replace(/^[ .]+|[ .]+$/g, "");
  return basename || DEFAULT_ARCHIVE_BASENAME;
}

function sanitizeArchiveSegment(value) {
  const sanitized = sanitizeArchiveBasename(value || "").replace(/^_+|_+$/g, "");
  return sanitized === DEFAULT_ARCHIVE_BASENAME && !(value || "").trim() ? "" : sanitized;
}

function formatArchiveReferralDateTime(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(ARCHIVE_DATE_TIME_PATTERN);
  if (!match) {
    throw new Error("Enter Referral DateTime in Referral Details using YYYY-MM-DD HH:mm:ss to append it to the .gz name.");
  }

  return `${match[1]}-${match[2]}-${match[3]}_${match[4]}${match[5]}${match[6]}`;
}

function formatCurrentDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function resolveReferralPrefix(identityOptions = {}) {
  const mode = String(identityOptions.referralPrefixMode || "standard").trim().toLowerCase();
  if (mode === "alt") return ALT_FILENAME_PREFIX;
  if (mode === "mixed") return RF_ALT_FILENAME_PREFIX;
  if (mode === "custom") return sanitizeArchiveSegment(identityOptions.customReferralPrefix || "RF") || "RF";
  return "RF";
}

function resolveArchivePrefixToken(identityOptions = {}) {
  return resolveReferralPrefix(identityOptions);
}

function resolveReferralNumber(payload = {}) {
  const value = String(payload.referralReplacementCode || "").trim();
  if (!value) return DEFAULT_ARCHIVE_BASENAME;
  const prefix = resolveReferralPrefix(payload.identityOptions);
  if (/^(?:rf|alt)/i.test(value) || value.toLowerCase().startsWith(prefix.toLowerCase())) {
    return sanitizeArchiveSegment(value);
  }
  return sanitizeArchiveSegment(`${prefix}${value}`);
}

function resolveNamingTokens(payload = {}, now = new Date()) {
  const optionalOverrides = payload.optionalOverrides || {};
  const referralDateTime = String(optionalOverrides.referralDateTime || "").trim();
  const dateTime = referralDateTime ? formatArchiveReferralDateTime(referralDateTime) : formatCurrentDateTime(now);
  const date = sanitizeArchiveSegment(
    optionalOverrides.referralDate || referralDateTime.slice(0, 10) ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  );
  return {
    referralNumber: resolveReferralNumber(payload),
    referralPrefix: resolveArchivePrefixToken(payload.identityOptions),
    patientId: sanitizeArchiveSegment(payload.patientIdPreview || ""),
    networkName: sanitizeArchiveSegment(
      optionalOverrides.network || payload.identityOptions?.selectedNetworks?.[0] || ""
    ),
    date,
    dateTime,
    customText: sanitizeArchiveSegment(payload.archiveNamingOptions?.customText || ""),
  };
}

function resolveNamingPattern(pattern, tokens) {
  const resolved = String(pattern || "").replace(
    /\{(referralNumber|referralPrefix|patientId|networkName|date|dateTime|customText)\}/g,
    (_match, tokenName) => tokens[tokenName] || ""
  );
  return sanitizeArchiveBasename(resolved.replace(/_+/g, "_"));
}

function normalizeArchiveCustomValues(values) {
  if (!Array.isArray(values)) return [];
  const selected = new Set(values.map((value) => String(value || "").trim()));
  return ARCHIVE_CUSTOM_VALUES.filter((value) => selected.has(value));
}

function buildCustomNamingPattern(archiveNamingOptions, tokens) {
  const hasCheckboxValues = Array.isArray(archiveNamingOptions.customValues);
  if (!hasCheckboxValues) {
    return archiveNamingOptions.customPattern || "{customText}_{referralNumber}_Final";
  }

  const selectedValues = normalizeArchiveCustomValues(archiveNamingOptions.customValues);
  if (selectedValues.length === 0) {
    throw new Error("Choose at least one value for Custom archive naming.");
  }
  if (selectedValues.includes("networkName") && !tokens.networkName) {
    throw new Error("Choose a Network or clear Network Name from Custom archive naming.");
  }
  if (selectedValues.includes("customText") && !tokens.customText) {
    throw new Error("Enter Custom text or clear Custom text from Custom archive naming.");
  }
  return `${selectedValues.map((value) => `{${value}}`).join("_")}_Final`;
}

function buildArchiveBasename(payload = {}, now = new Date()) {
  const archiveNamingOptions = payload.archiveNamingOptions || {};
  const rawRequestedMode = String(archiveNamingOptions.mode || "").trim();
  const requestedMode = rawRequestedMode === "prefix"
    ? ARCHIVE_NAMING_MODES.REFERRAL_NUMBER
    : rawRequestedMode;
  if (!Object.values(ARCHIVE_NAMING_MODES).includes(requestedMode)) {
    const legacySegments = [];
    const baseSegment = sanitizeArchiveBasename(payload.archiveBasename || DEFAULT_ARCHIVE_BASENAME);
    if (archiveNamingOptions.useAltPrefix && !/^alt(?:_|$)/i.test(baseSegment)) legacySegments.push(ALT_FILENAME_PREFIX);
    legacySegments.push(baseSegment);
    if (archiveNamingOptions.includeNetwork) {
      const networkSegment = sanitizeArchiveSegment(payload.optionalOverrides?.network || "");
      if (!networkSegment) throw new Error("Choose a Network before adding it to the archive name.");
      legacySegments.push(networkSegment);
    }
    if (archiveNamingOptions.includeReferralDateTime) {
      legacySegments.push(formatArchiveReferralDateTime(payload.optionalOverrides?.referralDateTime || ""));
    }
    legacySegments.push(formatCurrentDateTime(now));
    return sanitizeArchiveBasename(legacySegments.join("_"));
  }

  const tokens = resolveNamingTokens(payload, now);
  if (requestedMode === ARCHIVE_NAMING_MODES.NETWORK && !tokens.networkName) {
    throw new Error("Choose a Network before using Network Name archive naming.");
  }
  const patterns = {
    [ARCHIVE_NAMING_MODES.REFERRAL_NUMBER]: "{referralNumber}_Final",
    [ARCHIVE_NAMING_MODES.NETWORK]: "{networkName}_{referralNumber}_Final",
    [ARCHIVE_NAMING_MODES.REFERRAL_DATE_TIME]: "{referralNumber}_{dateTime}_Final",
  };
  const pattern = requestedMode === ARCHIVE_NAMING_MODES.CUSTOM
    ? buildCustomNamingPattern(archiveNamingOptions, tokens)
    : patterns[requestedMode];
  const basename = resolveNamingPattern(pattern, tokens);
  if (!basename || basename === DEFAULT_ARCHIVE_BASENAME) {
    throw new Error("Archive naming must produce a non-empty filename.");
  }
  return basename;
}

function buildOutputFileNames(payload = {}, now = new Date()) {
  const basename = buildArchiveBasename(payload, now);
  return { basename, json: `${basename}.json`, gzip: `${basename}.gz` };
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function zipOutput(folder, archiveBasename = DEFAULT_ARCHIVE_BASENAME, masterName = "") {
  if (!fs.existsSync(folder)) {
    return null;
  }

  const normalizedArchiveBase = sanitizeArchiveBasename(archiveBasename);
  const jsonFiles = fs.readdirSync(folder).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).filter((filename) => {
    const filePath = path.join(folder, filename);
    return fs.statSync(filePath).isFile() && filename.toLowerCase().endsWith(".json");
  });
  if (jsonFiles.length === 0) return null;

  const archivePath = path.join(folder, `${normalizedArchiveBase}.gz`);
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
  const output = fs.createWriteStream(archivePath);
  gzip.pipe(output);
  const master = masterName ? fs.createWriteStream(path.join(folder, masterName)) : null;
  let streamError;
  const streams = [gzip, output, master].filter(Boolean);
  const completion = Promise.all([finished(output), ...(master ? [finished(master)] : [])]);
  completion.catch(() => {});
  for (const stream of streams) stream.on("error", (error) => {
    streamError = error;
    for (const other of streams) if (!other.destroyed) other.destroy(error);
  });
  async function writeContent(chunk) {
    if (streamError) throw streamError;
    await writeChunk(gzip, chunk);
    if (master) await writeChunk(master, chunk);
  }
  try {

  const firstPath = path.join(folder, jsonFiles[0]);
  let firstContent;
  try {
    firstContent = JSON.parse(fs.readFileSync(firstPath, "utf8"));
  } catch (_error) {
    firstContent = null;
  }
  const referralMode = Boolean(firstContent && typeof firstContent === "object" && Array.isArray(firstContent.referrals));

  if (referralMode) {
    const metadata = { ...firstContent };
    delete metadata.referrals;
    const metadataEntries = Object.entries(metadata).map(([key, value]) =>
      `    ${JSON.stringify(key)}: ${JSON.stringify(value, null, 4).replace(/\n/g, "\n    ")}`
    );
    await writeContent(`{\n${metadataEntries.length ? metadataEntries.join(",\n") + ",\n" : ""}    "referrals": [`);
    let firstReferral = true;
    for (const filename of jsonFiles) {
      const content = JSON.parse(fs.readFileSync(path.join(folder, filename), "utf8"));
      for (const referral of Array.isArray(content.referrals) ? content.referrals : []) {
        await writeContent(`${firstReferral ? "\n" : ",\n"}${JSON.stringify(referral, null, 4).split("\n").map((line) => `        ${line}`).join("\n")}`);
        firstReferral = false;
      }
    }
    await writeContent(`${firstReferral ? "" : "\n    "}]\n}\n`);
  } else {
    await writeContent( "[");
    for (let index = 0; index < jsonFiles.length; index += 1) {
      const filename = jsonFiles[index];
      const rawContent = fs.readFileSync(path.join(folder, filename), "utf8");
      let content = rawContent;
      try {
        content = JSON.parse(rawContent);
      } catch (_error) {
        // Preserve non-JSON input as text in the fallback archive format.
      }
      await writeContent( `${index ? "," : ""}${JSON.stringify({ filename, content })}`);
    }
    await writeContent( "]");
  }

  gzip.end();
  if (master) master.end();
  await completion;
  if (streamError) throw streamError;
  return archivePath;
  } finally { gzip.destroy(); output.destroy(); master?.destroy(); }
}

module.exports = {
  ARCHIVE_NAMING_MODES,
  buildArchiveBasename,
  buildOutputFileNames,
  DEFAULT_ARCHIVE_BASENAME,
  ALT_FILENAME_PREFIX,
  formatCurrentDateTime,
  formatArchiveReferralDateTime,
  sanitizeArchiveBasename,
  resolveNamingPattern,
  resolveNamingTokens,
  zipOutput,
};
