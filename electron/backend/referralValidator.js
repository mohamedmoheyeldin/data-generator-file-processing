const fs = require("fs");
const path = require("path");

const REFERRAL_SCHEMA_VERSION = 1;

function validateReferralFile(filePath) {
  let content;
  try {
    content = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { fileName: path.basename(filePath), valid: false, errors: [`Invalid JSON: ${error.message}`], referralCount: 0 };
  }
  const errors = [];
  if (!content || typeof content !== "object" || Array.isArray(content)) errors.push("The top-level JSON value must be an object.");
  if (!Array.isArray(content?.referrals)) errors.push("The top-level Referrals field must be an array.");
  const referrals = Array.isArray(content?.referrals) ? content.referrals : [];
  referrals.forEach((referral, index) => {
    if (!referral || typeof referral !== "object" || Array.isArray(referral)) errors.push(`Referrals[${index}] must be an object.`);
  });
  return { fileName: path.basename(filePath), valid: errors.length === 0, errors, referralCount: referrals.length };
}

function validateReferralSourceFiles(files) {
  const results = files.map(validateReferralFile);
  const invalid = results.filter((result) => !result.valid);
  if (invalid.length > 0) {
    const details = invalid.slice(0, 5).map((result) => `${result.fileName}: ${result.errors.join(" ")}`).join("; ");
    throw new Error(`Referral preflight schema validation failed for ${invalid.length} file${invalid.length === 1 ? "" : "s"}. ${details}${invalid.length > 5 ? "; ..." : ""}`);
  }
  return { schemaVersion: REFERRAL_SCHEMA_VERSION, fileCount: results.length, referralCount: results.reduce((total, result) => total + result.referralCount, 0), results };
}

module.exports = { REFERRAL_SCHEMA_VERSION, validateReferralFile, validateReferralSourceFiles };
