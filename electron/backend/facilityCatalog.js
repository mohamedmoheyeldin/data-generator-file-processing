const fs = require("fs");
const { bundlePath, dataPath } = require("./appPaths");

const FACILITIES_FILE = "facilities.json";
const DISPLAY_FIELDS = [
  "facility_key",
  "facility_id",
  "region_id",
  "facility_name",
  "parent_facility_id",
];

let cachedFacilities = null;

function normalizeFacility(facility) {
  if (!facility || typeof facility !== "object") {
    return null;
  }

  const normalized = Object.fromEntries(Object.entries(facility).map(([key, value]) => {
    if (value === undefined || value === null || String(value).trim().toUpperCase() === "NULL") {
      return [key, null];
    }
    return [key, String(value).trim().replace(/\s+/g, " ")];
  }));
  normalized.facility_key = normalized.facility_key || normalized.facilityKey || null;
  normalized.facility_id = normalized.facility_id || normalized.facilityId || null;
  normalized.facility_name = normalized.facility_name || normalized.facilityName || null;

  if (!normalized.facility_key) {
    return null;
  }

  return normalized;
}

function normalizeFacilities(rawFacilities) {
  const facilities = [];
  const seenKeys = new Set();

  for (const rawFacility of Array.isArray(rawFacilities) ? rawFacilities : []) {
    const facility = normalizeFacility(rawFacility);
    if (!facility || seenKeys.has(facility.facility_key)) {
      continue;
    }

    seenKeys.add(facility.facility_key);
    facilities.push(facility);
  }

  return facilities;
}

function tryLoadFacilities(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return normalizeFacilities(raw);
}

function loadFacilities() {
  if (cachedFacilities) {
    return cachedFacilities;
  }

  for (const filePath of [
    dataPath("config", FACILITIES_FILE),
    bundlePath("config", FACILITIES_FILE),
  ]) {
    try {
      const facilities = tryLoadFacilities(filePath);
      if (facilities) {
        cachedFacilities = facilities;
        return cachedFacilities;
      }
    } catch (_error) {
      // Ignore invalid catalog files and fall back to the next location.
    }
  }

  cachedFacilities = [];
  return cachedFacilities;
}

function loadFacilityOptions() {
  return loadFacilities()
    .filter((facility) => /^[A-Za-z0-9]{1,5}$/.test(facility.facility_id || ""))
    .map((facility) => ({
      facilityKey: facility.facility_id,
      facilityName: facility.facility_name || `Facility key ${facility.facility_key}`,
    }));
}

module.exports = {
  DISPLAY_FIELDS,
  loadFacilities,
  loadFacilityOptions,
  normalizeFacilities,
};
