const DEFAULT_LIMITS = Object.freeze({
  maxSourceFileBytes: 250 * 1024 * 1024,
  maxTotalSourceBytes: 1024 * 1024 * 1024,
  maxLeieRows: 1_000_000,
  maxGeneratedFiles: 500,
  maxReferralsPerFile: 10_000,
  maxGeneratedReferrals: 1_000_000,
});

function envLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getProcessingLimits() {
  return {
    maxSourceFileBytes: envLimit("DGFP_MAX_SOURCE_FILE_BYTES", DEFAULT_LIMITS.maxSourceFileBytes),
    maxTotalSourceBytes: envLimit("DGFP_MAX_TOTAL_SOURCE_BYTES", DEFAULT_LIMITS.maxTotalSourceBytes),
    maxLeieRows: envLimit("DGFP_MAX_LEIE_ROWS", DEFAULT_LIMITS.maxLeieRows),
    maxGeneratedFiles: envLimit("DGFP_MAX_GENERATED_FILES", DEFAULT_LIMITS.maxGeneratedFiles),
    maxReferralsPerFile: envLimit("DGFP_MAX_REFERRALS_PER_FILE", DEFAULT_LIMITS.maxReferralsPerFile),
    maxGeneratedReferrals: envLimit("DGFP_MAX_GENERATED_REFERRALS", DEFAULT_LIMITS.maxGeneratedReferrals),
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function assertSourceFilesWithinLimits(filePaths) {
  const limits = getProcessingLimits();
  let totalBytes = 0;
  for (const filePath of filePaths) {
    const size = require("fs").statSync(filePath).size;
    if (size > limits.maxSourceFileBytes) {
      throw new Error(`Source file exceeds the ${formatBytes(limits.maxSourceFileBytes)} safety limit: ${filePath}`);
    }
    totalBytes += size;
  }
  if (totalBytes > limits.maxTotalSourceBytes) {
    throw new Error(`Selected source files exceed the ${formatBytes(limits.maxTotalSourceBytes)} combined safety limit.`);
  }
  return totalBytes;
}

module.exports = {
  DEFAULT_LIMITS,
  assertSourceFilesWithinLimits,
  formatBytes,
  getProcessingLimits,
};
