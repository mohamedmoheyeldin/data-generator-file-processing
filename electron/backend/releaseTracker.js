const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeFileAtomic } = require("./atomicFile");

const USER_CONFIG_DIRECTORY_NAME = "Data Generator & File Processing";
const RELEASE_TRACKER_PATH = "config/release_tracker.json";

function getGlobalUserConfigRoot() {
  const overridePath = String(process.env.DGFP_USER_DATA_ROOT || "").trim();
  if (overridePath) {
    return overridePath;
  }

  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), ".config");
  return path.join(appDataRoot, USER_CONFIG_DIRECTORY_NAME);
}

function getReleaseTrackerPath() {
  const [relativeDirectory, fileName] = RELEASE_TRACKER_PATH.split("/");
  return path.join(getGlobalUserConfigRoot(), relativeDirectory, fileName);
}

function loadReleaseTracker() {
  const trackerPath = getReleaseTrackerPath();
  try {
    if (fs.existsSync(trackerPath)) {
      const parsed = JSON.parse(fs.readFileSync(trackerPath, "utf8"));
      return {
        acknowledgedReleaseKey: String(
          parsed.acknowledgedReleaseKey || parsed.acknowledged_release_key || ""
        ).trim(),
      };
    }
  } catch (_error) {
    // Ignore invalid tracker state and fall back to defaults.
  }

  return {
    acknowledgedReleaseKey: "",
  };
}

function saveReleaseTracker(rawValue = {}) {
  const normalized = {
    acknowledgedReleaseKey: String(rawValue.acknowledgedReleaseKey || "").trim(),
  };

  const trackerPath = getReleaseTrackerPath();
  writeFileAtomic(
    trackerPath,
    `${JSON.stringify(
      {
        ...normalized,
        acknowledged_release_key: normalized.acknowledgedReleaseKey,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return normalized;
}

module.exports = {
  getReleaseTrackerPath,
  loadReleaseTracker,
  saveReleaseTracker,
};
