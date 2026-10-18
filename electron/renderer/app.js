const DATE_PARTS = [
  { key: "year", width: 4, min: 0, max: 9999 },
  { key: "month", width: 2, min: 0, max: 12 },
  { key: "day", width: 2, min: 0, max: 31 },
  { key: "hour", width: 2, min: 0, max: 23 },
  { key: "minute", width: 2, min: 0, max: 59 },
  { key: "second", width: 2, min: 0, max: 59 },
];
const PAYMENT_AUTHORITY_CODE_MAX = 99999;
const FACILITY_RESULT_LIMIT = 60;
const CARE_PACKAGE_RESULT_LIMIT = 60;
let referralUploadTargetNames = new Set(["SQA", "DEV", "PPD"]);
const NETWORK_VALUES = Object.freeze(["NET1", "NET2", "NET3", "NET4", "NET5"]);
const ACTIVE_STATUS_PATTERN = /working|processing|generating|uploading|importing|scanning|validating|packaging|archive|cancelling|testing|preparing/i;
const { buildLeieValidationSql, highlightSql } = window.dgfpLeieSql;
const {
  LEIE_DEFAULT_UPLOAD_DIRECTORY,
  REFERRAL_DEFAULT_UPLOAD_DIRECTORY,
  resolveUploadDirectoryForWorkflow,
} = window.dgfpUploadDefaults;

const state = {
  info: null,
  busy: false,
  activityActive: false,
  statusLabel: "Ready",
  progressCurrent: 0,
  progressTotal: 0,
  theme: "light",
  mainTab: "referral",
  subTab: "edit",
  leieDuplicateKey: "full-row",
  leieDuplicateHandling: "manual",
  leieInspection: null,
  leieInspectionError: "",
  leieScanRequestId: 0,
  leieLastScannedInput: "",
  leieSourceValid: false,
  leieOutputFileName: "",
  sourceInspection: null,
  sourceListDate: "",
  listDateTouched: false,
  optionalFieldsVisible: false,
  liveListDateTimer: null,
  uploadImportState: "idle",
  uiSettingsSaveTimer: null,
  acknowledgedReleaseKey: "",
  releaseAnnouncementOpen: false,
  jobCancellable: false,
  cancelRequested: false,
  previewTimer: null,
  previewRequestId: 0,
  selectedFacilityIds: [],
  selectedNetworks: [],
  selectedPaymentCodes: [],
  paymentCodeBySelectorKey: new Map(),
  paymentCodeSearchIndex: [],
  selectedCarePackageKeys: [],
  selectedSituationalCarePackageKeys: [],
  carePackageBySelectorKey: new Map(),
  carePackageSearchIndex: [],
  situationalCarePackageBySelectorKey: new Map(),
  situationalCarePackageSearchIndex: [],
  facilityById: new Map(),
  facilitySearchIndex: [],
  facilitySelectableCount: 0,
  facilityRenderFrame: null,
  lastSavedUiSettingsSignature: "",
  previewCacheSignature: "",
  previewCacheResult: null,
  currentPhase: "idle",
  lastRun: null,
};

const elements = {};
const STATIC_HELPER_IDS = [
  "outputDirHelp",
  "ssnHelp",
  "archiveNameHelp",
  "fileCountHelp",
  "referralsPerFileHelp",
  "dobHelp",
  "referralDateHelp",
  "referralDateTimeHelp",
  "referralExpirationDateHelp",
  "referralLastUpdateDateHelp",
];

function $(id) {
  return document.getElementById(id);
}

function captureStaticHelperDefaults() {
  for (const key of STATIC_HELPER_IDS) {
    const element = elements[key];
    if (element && !element.dataset.defaultText) {
      element.dataset.defaultText = element.textContent;
    }
  }
}

function setInputValidity(input, hasError) {
  if (!input) {
    return;
  }
  input.classList.toggle("is-invalid", Boolean(hasError));
  input.closest(".combo-shell")?.classList.toggle("is-invalid", Boolean(hasError));
}

function setStaticHelperState(helperElement, inputElement, message = "") {
  if (!helperElement) {
    return;
  }

  const hasError = Boolean(message);
  helperElement.classList.toggle("is-error", hasError);
  helperElement.classList.toggle("is-success", false);
  helperElement.textContent = hasError ? message : helperElement.dataset.defaultText || "";
  setInputValidity(inputElement, hasError);
}

function setPreviewHelperState(helperElement, inputElement, message = "") {
  if (!helperElement) {
    return;
  }
  const hasError = Boolean(message);
  helperElement.classList.toggle("is-error", hasError);
  helperElement.classList.toggle("is-success", false);
  if (hasError) {
    helperElement.textContent = message;
  }
  setInputValidity(inputElement, hasError);
}

function setUploadTargetStatus(row, message = "", stateName = "") {
  const statusElement = row?.querySelector(".upload-test-status");
  if (!statusElement) {
    return;
  }
  statusElement.textContent = message || "Not tested yet.";
  statusElement.classList.toggle("is-error", stateName === "error");
  statusElement.classList.toggle("is-success", stateName === "success");
  statusElement.classList.toggle("is-working", stateName === "working");
}

function setStatus(label, message) {
  const normalizedLabel = String(label || "Ready").trim();
  state.statusLabel = normalizedLabel;
  state.activityActive = state.busy || ACTIVE_STATUS_PATTERN.test(normalizedLabel);
  elements.statusBadge.textContent = normalizedLabel;
  elements.statusMessage.textContent = String(message || "The app is ready.").trim();

  const badgeClass = normalizedLabel.toLowerCase();
  elements.statusBadge.className = "status-badge";
  if (badgeClass.includes("failed") || badgeClass.includes("warning")) {
    elements.statusBadge.classList.add("failed");
  } else if (badgeClass.includes("complete") || badgeClass.includes("ready to save") || badgeClass.includes("uploaded")) {
    elements.statusBadge.classList.add("completed");
  } else if (state.activityActive) {
    elements.statusBadge.classList.add("working");
  } else {
    elements.statusBadge.classList.add("idle");
  }
  window.dgfpJobUi.syncWorkflowProgress(normalizedLabel, state.currentPhase);
  setJobProgress(state.progressCurrent, state.progressTotal);
}

function setJobProgress(current = 0, total = 0) {
  state.progressCurrent = Number(current) || 0;
  state.progressTotal = Number(total) || 0;
  window.dgfpJobUi.updateProgress({
    progressElement: elements.jobProgress,
    progressWrap: elements.jobProgressWrap,
    progressLabel: elements.jobProgressLabel,
    progressValue: elements.jobProgressValue,
    active: state.activityActive,
    current: state.progressCurrent,
    total: state.progressTotal,
  });
}

function setBusy(busy, cancellable = false) {
  state.busy = busy;
  if (elements.openBatchManifest) elements.openBatchManifest.disabled = busy || !state.lastRun?.manifestData;
  state.jobCancellable = Boolean(busy && cancellable);
  if (!busy) {
    state.cancelRequested = false;
    state.currentPhase = "idle";
  }
  state.activityActive = busy || ACTIVE_STATUS_PATTERN.test(state.statusLabel);
  window.dgfpJobUi.updateBusyControls({
    busy,
    cancellable: state.jobCancellable,
    cancelRequested: state.cancelRequested,
    cancelButton: elements.cancelJob,
  });
  setJobProgress(0, 0);
  if (!busy) {
    syncIdentityControls();
    window.dgfpJobUi.syncWorkflowProgress(state.statusLabel, state.currentPhase);
  }
}

async function cancelActiveJob() {
  if (!state.jobCancellable || state.cancelRequested) return;
  state.cancelRequested = true;
  elements.cancelJob.disabled = true;
  setStatus("Cancelling", "Stopping the current operation safely...");
  const result = await window.dgfp.cancelJob();
  if (!result?.cancelled) {
    state.cancelRequested = false;
    elements.cancelJob.disabled = false;
    setStatus("Working", "The current operation is already finishing.");
  }
}

function setReleaseAnnouncementOpen(isOpen) {
  state.releaseAnnouncementOpen = Boolean(isOpen);
  elements.releaseAnnouncementOverlay?.classList.toggle("hidden", !state.releaseAnnouncementOpen);
  document.body.classList.toggle("modal-open", state.releaseAnnouncementOpen);
  if (state.releaseAnnouncementOpen) {
    window.requestAnimationFrame(() => {
      elements.releaseAnnouncementAccept?.focus({ preventScroll: true });
    });
  }
}

function syncReleaseAnnouncement() {
  if (!elements.releaseAnnouncementOverlay || !elements.releaseAnnouncementList) {
    return;
  }

  const announcement = state.info?.releaseAnnouncement || null;
  const notes = Array.isArray(announcement?.notes) ? announcement.notes : [];
  elements.releaseAnnouncementTitle.textContent = announcement?.label
    ? `What's new in ${announcement.label}`
    : "What's new in this release";
  elements.releaseAnnouncementVersion.textContent = announcement?.label || "";
  elements.releaseAnnouncementList.innerHTML = "";

  for (const note of notes) {
    const item = document.createElement("li");
    item.textContent = note;
    elements.releaseAnnouncementList.appendChild(item);
  }

  const shouldOpen = Boolean(
    announcement?.releaseKey &&
      (announcement?.shouldShow === true || state.acknowledgedReleaseKey !== announcement.releaseKey)
  );
  setReleaseAnnouncementOpen(shouldOpen);
}

async function acknowledgeReleaseAnnouncement() {
  const announcement = state.info?.releaseAnnouncement;
  if (!announcement?.releaseKey) {
    setReleaseAnnouncementOpen(false);
    return;
  }

  const previousReleaseKey = state.acknowledgedReleaseKey;
  state.acknowledgedReleaseKey = announcement.releaseKey;

  try {
    await window.dgfp.acknowledgeReleaseAnnouncement(announcement.releaseKey);
    if (state.info?.releaseAnnouncement) {
      state.info.releaseAnnouncement.shouldShow = false;
    }
    setReleaseAnnouncementOpen(false);
  } catch (_error) {
    state.acknowledgedReleaseKey = previousReleaseKey;
    setStatus("Failed", "Unable to save the release acknowledgement.");
  }
}

function readValue(id) {
  return $(id).value.trim();
}

function readChecked(id) {
  return $(id).checked;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function isExcelPath(value) {
  return /\.(xlsx|xls|xlsm|xlsb)$/i.test(String(value || "").trim());
}

function syncLeieValidationSql() {
  if (!elements.leieValidationSql || !elements.leieValidationBatchId) {
    return;
  }
  const sqlText = buildLeieValidationSql(elements.leieValidationBatchId.value);
  elements.leieValidationSql.dataset.rawSql = sqlText;
  elements.leieValidationSql.innerHTML = `<code>${highlightSql(sqlText)}</code>`;
}

async function copyLeieValidationSql() {
  if (!elements.leieValidationSql) {
    return;
  }

  const sqlText = elements.leieValidationSql.dataset.rawSql || elements.leieValidationSql.textContent;
  let copied = false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(sqlText);
      copied = true;
    } catch (_error) {
      copied = false;
    }
  }

  if (!copied) {
    const copyField = document.createElement("textarea");
    copyField.value = sqlText;
    copyField.setAttribute("readonly", "");
    copyField.className = "clipboard-copy-field";
    document.body.appendChild(copyField);
    copyField.select();
    copied = document.execCommand("copy");
    copyField.remove();
  }

  elements.leieValidationCopyStatus.textContent = copied
    ? "SQL copied. Run it against the database for the selected environment."
    : "Unable to copy automatically. Select the SQL and copy it manually.";
  elements.leieValidationCopyStatus.classList.toggle("is-success", copied);
  elements.leieValidationCopyStatus.classList.toggle("is-error", !copied);
}

function getFacilityOptions() {
  return Array.isArray(state.info?.facilities) ? state.info.facilities : [];
}

function getCarePackageOptions(situational = false) {
  const key = situational ? "situationalCarePackageOptions" : "carePackageOptions";
  return Array.isArray(state.info?.[key]) ? state.info[key] : [];
}

function getCarePackageVisibleName(option = {}) {
  return String(option.name || option.carePackageId || option.displayName || "").trim();
}

function getSelectedNetworkValues() {
  return elements.useAllNetworks?.checked ? [...NETWORK_VALUES] : [...state.selectedNetworks];
}

function setNetworkMenuOpen(open) {
  elements.networkCombobox?.classList.toggle("is-open", Boolean(open));
  elements.networkMenu?.classList.toggle("hidden", !open);
  elements.networkSearch?.setAttribute("aria-expanded", String(Boolean(open)));
}

function renderNetworkSelection() {
  if (elements.useAllNetworks.checked) state.selectedNetworks = [];
  elements.selectedNetworks.innerHTML = "";
  for (const value of state.selectedNetworks) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selected-facility-chip";
    chip.textContent = `${value} ×`;
    chip.setAttribute("aria-label", `Remove ${value}`);
    chip.addEventListener("click", () => {
      state.selectedNetworks = state.selectedNetworks.filter((item) => item !== value);
      renderNetworkSelection();
      renderNetworkMenu();
      updatePreviews();
      scheduleUiSettingsSave();
    });
    elements.selectedNetworks.append(chip);
  }

  const selectedValues = getSelectedNetworkValues();
  if (elements.useAllNetworks.checked) {
    elements.networkMatch.textContent = "All five Network values will be mixed across the referrals.";
  } else if (selectedValues.length === 1) {
    elements.networkMatch.textContent = `${selectedValues[0]} will be used for every referral.`;
  } else if (selectedValues.length > 1) {
    elements.networkMatch.textContent = `Each referral will receive a value mixed from the ${selectedValues.length} selected Networks.`;
  } else {
    elements.networkMatch.textContent = "Automatic mode keeps each referral's source Network.";
  }
  elements.networkSearch.disabled = false;
  elements.networkToggle.disabled = false;
}

function renderNetworkMenu() {
  const query = elements.networkSearch.value.trim().toLowerCase();
  const matches = NETWORK_VALUES.filter((value) => !query || value.toLowerCase().includes(query));
  elements.networkMenu.innerHTML = "";
  for (const value of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "combo-option";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(state.selectedNetworks.includes(value)));
    const title = document.createElement("span");
    title.className = "combo-option-title";
    title.textContent = value;
    const copy = document.createElement("span");
    copy.className = "combo-option-copy";
    copy.textContent = state.selectedNetworks.includes(value) ? "Selected — choose again to remove" : "Choose this Network";
    button.append(title, copy);
    button.addEventListener("click", () => {
      elements.useAllNetworks.checked = false;
      state.selectedNetworks = state.selectedNetworks.includes(value)
        ? state.selectedNetworks.filter((item) => item !== value)
        : [...state.selectedNetworks, value];
      elements.networkSearch.value = "";
      renderNetworkSelection();
      renderNetworkMenu();
      updatePreviews();
      scheduleUiSettingsSave();
    });
    elements.networkMenu.append(button);
  }
}

function getCarePackageSelectorConfig(situational = false) {
  if (situational === "payment") return {
    selectedKey: "selectedPaymentCodes", combobox: elements.paymentCodeCombobox,
    input: $("override-payment-authority-code"), toggle: elements.paymentCodeToggle,
    menu: elements.paymentCodeMenu, selected: elements.selectedPaymentCodes,
    match: elements.paymentCodeMatch, useAll: elements.useAllPaymentCodes,
    label: "Payment Authority Code", payment: true,
    optionMapKey: "paymentCodeBySelectorKey", searchIndexKey: "paymentCodeSearchIndex",
  };
  return situational
    ? {
        selectedKey: "selectedSituationalCarePackageKeys",
        combobox: elements.situationalCarePackageCombobox,
        input: elements.situationalCarePackageSearch,
        toggle: elements.situationalCarePackageToggle,
        menu: elements.situationalCarePackageMenu,
        selected: elements.selectedSituationalCarePackages,
        match: elements.situationalCarePackageMatch,
        useAll: elements.useAllSituationalCarePackages,
        label: "Situational Care Package",
        situational: true,
        optionMapKey: "situationalCarePackageBySelectorKey",
        searchIndexKey: "situationalCarePackageSearchIndex",
      }
    : {
        selectedKey: "selectedCarePackageKeys",
        combobox: elements.carePackageCombobox,
        input: elements.carePackageSearch,
        toggle: elements.carePackageToggle,
        menu: elements.carePackageMenu,
        selected: elements.selectedCarePackages,
        match: elements.carePackageMatch,
        useAll: elements.useAllCarePackages,
        label: "Care Package",
        situational: false,
        optionMapKey: "carePackageBySelectorKey",
        searchIndexKey: "carePackageSearchIndex",
      };
}

function syncCarePackageOverrideWarning() {
  const hasManualChoice = state.selectedSituationalCarePackageKeys.length > 0 ||
    Boolean(elements.useAllSituationalCarePackages?.checked);
  elements.carePackageOverrideWarning?.classList.toggle("hidden", !hasManualChoice);
}

function setCarePackageMenuOpen(config, open) {
  config.combobox?.classList.toggle("is-open", Boolean(open));
  config.menu?.classList.toggle("hidden", !open);
  config.input?.setAttribute("aria-expanded", String(Boolean(open)));
}

function renderSelectedCarePackages(config) {
  if (config.useAll.checked) state[config.selectedKey] = [];
  config.selected.innerHTML = "";
  for (const selectorKey of state[config.selectedKey]) {
    const option = state[config.optionMapKey].get(selectorKey);
    if (!option) continue;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selected-facility-chip";
    chip.dataset.carePackageSelectorKey = selectorKey;
    const visibleName = getCarePackageVisibleName(option);
    chip.textContent = `${visibleName} ×`;
    chip.title = `Remove ${visibleName}`;
    config.selected.append(chip);
  }
  if (config.useAll.checked) {
    config.match.textContent = `All ${state[config.optionMapKey].size.toLocaleString()} available ${config.label} values will be used.`;
  } else if (state[config.selectedKey].length > 0) {
    config.match.textContent = `${state[config.selectedKey].length.toLocaleString()} ${config.label} value${state[config.selectedKey].length === 1 ? "" : "s"} selected.`;
  } else {
    config.match.textContent = config.payment ? "Automatic mode mixes only configured payment codes." : config.situational
      ? "Manual only: no Situational Care Package is added unless you select one here."
      : "Automatic mode mixes approved Care Package Number and ID pairs from the reference list.";
  }
  config.input.disabled = false;
  config.toggle.disabled = false;
  syncCarePackageOverrideWarning();
}

function renderCarePackageMenu(config) {
  const query = config.input.value.trim().toLowerCase();
  const matches = state[config.searchIndexKey].filter((entry) => !query || entry.searchText.includes(query));
  config.menu.innerHTML = "";
  for (const entry of matches.slice(0, CARE_PACKAGE_RESULT_LIMIT)) {
    const option = entry.option;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `combo-option${state[config.selectedKey].includes(option.selectorKey) ? " is-selected" : ""}`;
    button.dataset.carePackageSelectorKey = option.selectorKey;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(state[config.selectedKey].includes(option.selectorKey)));
    const title = document.createElement("span");
    title.className = "combo-option-title";
    title.textContent = getCarePackageVisibleName(option);
    const copy = document.createElement("span");
    copy.className = "combo-option-copy";
    button.append(title);
    if (!config.payment) {
      copy.textContent = `Care Package Number: ${option.carePackageNumber}`;
      button.append(copy);
    }
    config.menu.append(button);
  }
  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "combo-empty";
    empty.textContent = `No matching ${config.label} values.`;
    config.menu.append(empty);
  } else if (matches.length > CARE_PACKAGE_RESULT_LIMIT) {
    const summary = document.createElement("div");
    summary.className = "combo-result-summary";
    summary.textContent = `Showing ${CARE_PACKAGE_RESULT_LIMIT} of ${matches.length.toLocaleString()} matches. Keep typing to narrow the list.`;
    config.menu.append(summary);
  }
}

function syncIdentityControls() {
  $("ssn-value").disabled = readChecked("randomize-ssn");
  $("override-dob").disabled = readChecked("randomize-dob");
  elements.overrideFacilityId.disabled = false;
  elements.facilityIdToggle.disabled = false;
}

function renderSelectedFacilities() {
  if (readChecked("randomize-facility-id")) state.selectedFacilityIds = [];
  if (!elements.selectedFacilities) return;
  elements.selectedFacilities.innerHTML = "";
  for (const facilityId of state.selectedFacilityIds) {
    const facility = findFacilityOption(facilityId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selected-facility-chip";
    chip.textContent = `${facilityId} — ${facility?.facility_name || "Selected facility"} ×`;
    chip.title = `Remove Facility ID ${facilityId}`;
    chip.addEventListener("click", () => {
      state.selectedFacilityIds = state.selectedFacilityIds.filter((value) => value !== facilityId);
      renderSelectedFacilities();
      scheduleFacilityOptionsRender();
      updateFacilityIdMatch();
      schedulePreviewUpdate();
      scheduleUiSettingsSave();
    });
    elements.selectedFacilities.appendChild(chip);
  }
}

function findFacilityOption(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  return state.facilityById.get(normalized) || null;
}

function scheduleFacilityOptionsRender() {
  if (state.facilityRenderFrame !== null) {
    window.cancelAnimationFrame(state.facilityRenderFrame);
  }
  state.facilityRenderFrame = window.requestAnimationFrame(() => {
    state.facilityRenderFrame = null;
    renderFacilityOptions();
  });
}

function renderFacilityOptions() {
  if (!elements.facilityIdMenu) {
    return;
  }
  const normalizedQuery = readValue("override-facility-id").toLowerCase();
  const fragment = document.createDocumentFragment();
  const matchingEntries = normalizedQuery
    ? state.facilitySearchIndex.filter((entry) => entry.searchText.includes(normalizedQuery))
    : state.facilitySearchIndex;
  const filteredOptions = matchingEntries.slice(0, FACILITY_RESULT_LIMIT).map((entry) => entry.option);

  if (filteredOptions.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "combo-empty";
    emptyState.textContent = "No matching facility found. Search by facility key, ID, Region, name, or parent facility ID.";
    fragment.appendChild(emptyState);
  }

  for (const option of filteredOptions) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "combo-option";
    element.setAttribute("role", "option");
    element.dataset.facilityId = option.facility_id || "";
    const isSelected = state.selectedFacilityIds.includes(option.facility_id);
    element.setAttribute("aria-selected", String(isSelected));
    element.classList.toggle("is-selected", isSelected);
    element.disabled = !option.facility_id;
    element.title = option.facility_id
      ? `${option.facility_id} - ${option.facility_name || "Unnamed facility"}`
      : "This source row has no facility_id and cannot be selected.";
    const title = document.createElement("span");
    title.className = "combo-option-title";
    title.textContent = option.facility_name || "Unnamed facility";
    element.appendChild(title);
    const details = document.createElement("span");
    details.className = "facility-option-fields";
    for (const [label, value] of [
      ["facility_key", option.facility_key],
      ["facility_id", option.facility_id],
      ["region_id", option.region_id],
      ["facility_name", option.facility_name],
      ["parent_facility_id", option.parent_facility_id],
    ]) {
      const field = document.createElement("span");
      field.className = "facility-option-field";
      const fieldLabel = document.createElement("strong");
      fieldLabel.textContent = `${label}:`;
      field.append(fieldLabel, document.createTextNode(` ${value || "—"}`));
      details.appendChild(field);
    }
    element.appendChild(details);
    fragment.appendChild(element);
  }

  if (matchingEntries.length > FACILITY_RESULT_LIMIT) {
    const resultSummary = document.createElement("div");
    resultSummary.className = "combo-result-summary";
    resultSummary.textContent = normalizedQuery
      ? `Showing the first ${FACILITY_RESULT_LIMIT} of ${matchingEntries.length.toLocaleString()} matches. Keep typing to narrow the list.`
      : `Showing ${FACILITY_RESULT_LIMIT} of ${matchingEntries.length.toLocaleString()} facilities. Type to search the complete catalog.`;
    fragment.appendChild(resultSummary);
  }

  elements.facilityIdMenu.replaceChildren(fragment);
}

function setFacilityMenuOpen(isOpen) {
  if (!elements.facilityIdCombobox || !elements.facilityIdMenu) {
    return;
  }

  elements.facilityIdCombobox.classList.toggle("is-open", Boolean(isOpen));
  elements.facilityIdMenu.classList.toggle("hidden", !isOpen);
  elements.overrideFacilityId.setAttribute("aria-expanded", String(Boolean(isOpen)));
}

function updateFacilityIdMatch() {
  if (!elements.facilityIdMatch) {
    return;
  }

  if (readChecked("randomize-facility-id")) {
    elements.facilityIdMatch.classList.add("is-success");
    elements.facilityIdMatch.classList.remove("is-error");
    elements.facilityIdMatch.textContent = `Random selection will use the ${state.facilitySelectableCount.toLocaleString()} rows that have a facility_id.`;
    return;
  }

  if (state.selectedFacilityIds.length > 0) {
    elements.facilityIdMatch.classList.add("is-success");
    elements.facilityIdMatch.classList.remove("is-error");
    elements.facilityIdMatch.textContent = `${state.selectedFacilityIds.length.toLocaleString()} facility${state.selectedFacilityIds.length === 1 ? "" : "s"} selected. Referrals will be assigned randomly from this selected set.`;
    return;
  }

  const facilityId = readValue("override-facility-id");
  if (!facilityId) {
    elements.facilityIdMatch.classList.remove("is-success", "is-error");
    elements.facilityIdMatch.textContent = `Loaded all ${getFacilityOptions().length.toLocaleString()} facility rows. Selection is optional; search any of the five displayed fields.`;
    return;
  }

  const match = findFacilityOption(facilityId);
  if (match) {
    elements.facilityIdMatch.classList.add("is-success");
    elements.facilityIdMatch.classList.remove("is-error");
    elements.facilityIdMatch.textContent = `Selected: facility_key ${match.facility_key} | facility_id ${match.facility_id} | Region ${match.region_id || "—"} | ${match.facility_name || "Unnamed facility"} | parent ${match.parent_facility_id || "—"}`;
    return;
  }

  elements.facilityIdMatch.classList.remove("is-success");
  elements.facilityIdMatch.classList.add("is-error");
  elements.facilityIdMatch.textContent = "Search results are shown above. Choose a facility to apply its facility_id, or clear this optional field.";
}

function sanitizePaymentAuthorityCodeInput(value, fallbackValue = "") {
  const digitsOnly = ((String(value || "").match(/\d/g) || []).join("")).slice(0, 5);
  if (!digitsOnly) {
    return "";
  }

  if (Number(digitsOnly) > PAYMENT_AUTHORITY_CODE_MAX) {
    return fallbackValue;
  }

  return digitsOnly;
}

function getSelectedPatientIdMode() {
  const selected = document.querySelector('input[name="patient-id-mode"]:checked');
  return selected?.value || "test-dynamic";
}

function getPatientIdConstants() {
  return {
    testPrefix: state.info?.constants?.patientIdTestPrefix || "TEST",
    suffixLength: Number(state.info?.constants?.patientIdSuffixLength || 13),
    totalLength: Number(state.info?.constants?.patientIdTotalLength || 17),
  };
}

function sanitizePatientIdInput(value, mode = getSelectedPatientIdMode()) {
  const { suffixLength, totalLength } = getPatientIdConstants();
  if (mode === "test-custom-suffix") {
    return ((String(value || "").match(/[A-Za-z0-9]/g) || []).join("")).slice(0, suffixLength);
  }

  if (mode === "custom-full") {
    return ((String(value || "").match(/[A-Za-z0-9]/g) || []).join("")).slice(0, totalLength);
  }

  return "";
}

function sanitizeReferralNumberInput(value) {
  let normalized = String(value || "").trim();
  const prefixOptions = getReferralPrefixOptions();
  const prefixes = [prefixOptions.customReferralPrefix, "RFALT", "ALT", "RF"]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const prefix of prefixes) {
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }

  return (normalized.match(/[A-Za-z0-9_-]/g) || []).join("");
}

function sanitizeLeieFileNameInput(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/g, "");
}

function formatUploadProfileSummary(summary) {
  if (!summary || !summary.serverCount || !summary.userCount) {
    return "";
  }
  return `${summary.serverCount} server${summary.serverCount === 1 ? "" : "s"}, ${summary.userCount} user${summary.userCount === 1 ? "" : "s"}`;
}

function setValueIfEmpty(id, value) {
  if (!value || readValue(id)) {
    return;
  }
  $(id).value = value;
}

function setTheme(themeName) {
  state.theme = themeName === "dark" ? "dark" : "light";
  document.body.classList.toggle("theme-dark", state.theme === "dark");
  for (const button of document.querySelectorAll("[data-theme]")) {
    button.classList.toggle("is-active", button.dataset.theme === state.theme);
    button.setAttribute("aria-pressed", String(button.dataset.theme === state.theme));
  }
}

function syncTabState() {
  for (const current of document.querySelectorAll("[data-main-tab]")) {
    current.classList.toggle("is-active", current.dataset.mainTab === state.mainTab);
    current.setAttribute("aria-selected", String(current.dataset.mainTab === state.mainTab));
  }
  for (const current of document.querySelectorAll("[data-sub-tab]")) {
    current.classList.toggle("is-active", current.dataset.subTab === state.subTab);
    current.setAttribute("aria-selected", String(current.dataset.subTab === state.subTab));
  }
}

function syncOptionalFieldsVisibility() {
  elements.optionalFields.classList.toggle("hidden", !state.optionalFieldsVisible);
  elements.toggleOptionalFields.textContent = state.optionalFieldsVisible ? "Hide Additional Fields" : "Show Additional Fields";
  elements.toggleOptionalFields.classList.toggle("is-active", state.optionalFieldsVisible);
}

function normalizeDigits(value, width) {
  return (String(value || "").match(/\d/g) || []).join("").slice(0, width);
}

function setDateParts(dateText) {
  const normalized = String(dateText || "").trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  const values = match
    ? {
        year: match[1],
        month: match[2],
        day: match[3],
        hour: match[4],
        minute: match[5],
        second: match[6],
      }
    : {
        year: "0000",
        month: "00",
        day: "00",
        hour: "00",
        minute: "00",
        second: "00",
      };

  for (const part of DATE_PARTS) {
    $(`list-date-${part.key}`).value = values[part.key];
  }
}

function getListDateOverride() {
  const values = {};
  for (const part of DATE_PARTS) {
    values[part.key] = normalizeDigits(readValue(`list-date-${part.key}`), part.width).padStart(part.width, "0");
  }
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function markDateTouched() {
  state.listDateTouched = true;
}

function resumeLiveListDate(syncNow = true) {
  state.listDateTouched = false;
  if (syncNow) {
    setDateParts(nowAsListDate());
  }
}

function adjustDatePart(partKey, delta) {
  const part = DATE_PARTS.find((entry) => entry.key === partKey);
  if (!part) {
    return;
  }

  markDateTouched();
  const input = $(`list-date-${part.key}`);
  const rawValue = normalizeDigits(input.value, part.width);
  let current = Number(rawValue || part.min);
  if (Number.isNaN(current)) {
    current = part.min;
  }

  current += delta;
  if (current > part.max) {
    current = part.min;
  }
  if (current < part.min) {
    current = part.max;
  }

  input.value = String(current).padStart(part.width, "0");
}

const referralDateFields = {
  "override-referral-date": "referralDate",
  "override-referral-date-time": "referralDateTime",
  "override-referral-expiration-date": "expirationDate",
  "override-referral-last-update-date": "lastUpdateDate",
};

function collectOptionalOverrides() {
  const rawValues = {
    facilityId: "",
    paymentAuthorityCode: "",
    referralPeriod: readValue("override-referral-period"),
    dateOfBirth: readChecked("randomize-dob") ? "" : readValue("override-dob"),
    category: readValue("override-referral-category"),
    referralDate: readValue("override-referral-date"),
    referralDateTime: readValue("override-referral-date-time"),
    expirationDate: readValue("override-referral-expiration-date"),
    lastUpdateDate: readValue("override-referral-last-update-date"),
  };

  if (state.subTab === "generate" && readChecked("use-current-referral-dates")) {
    for (const key of Object.values(referralDateFields)) delete rawValues[key];
  }
  return Object.fromEntries(
    Object.entries(rawValues).filter(([, value]) => value)
  );
}

function collectUploadSettings() {
  const enabled = readChecked("upload-enabled");
  const targets = [];

  for (const row of document.querySelectorAll(".upload-target")) {
    if (!isUploadTargetAvailableForWorkflow(row.dataset.target)) {
      continue;
    }
    const useTarget = row.querySelector(".upload-enabled").checked;
    if (!useTarget) {
      continue;
    }

    targets.push({
      server_name: row.dataset.target,
      user_name: row.querySelector(".upload-user").value,
      remote_directory: row.querySelector(".upload-path").value.trim(),
    });
  }

  return { enabled, targets };
}

function isUploadTargetAvailableForWorkflow(targetName) {
  if (state.mainTab !== "referral") {
    return true;
  }
  return referralUploadTargetNames.has(String(targetName || "").trim().toUpperCase());
}

function collectPatientIdSettings() {
  return {
    mode: getSelectedPatientIdMode(),
    value: readValue("patient-id-custom-value"),
  };
}

function collectArchiveNamingOptions() {
  return {
    mode: document.querySelector('input[name="archive-naming-mode"]:checked')?.value || "referral-number",
    customValues: [...document.querySelectorAll(".archive-custom-value:checked")]
      .map((input) => input.value),
    customText: readValue("archive-custom-text"),
  };
}

function syncArchiveNamingState() {
  const isCustom = collectArchiveNamingOptions().mode === "custom";
  elements.archiveCustomFields?.classList.toggle("hidden", !isCustom);
  const valueInputs = [...document.querySelectorAll(".archive-custom-value")];
  const selectedValues = valueInputs.filter((input) => input.checked);
  if (elements.archiveCustomSelectAll) {
    elements.archiveCustomSelectAll.checked = valueInputs.length > 0 && selectedValues.length === valueInputs.length;
    elements.archiveCustomSelectAll.indeterminate = selectedValues.length > 0 && selectedValues.length < valueInputs.length;
  }
  if (elements.archiveCustomText) {
    elements.archiveCustomText.disabled = !isCustom || !readChecked("archive-custom-value-custom-text");
  }
}

function syncReferralPrefixState() {
  const { referralPrefixMode, customReferralPrefix } = getReferralPrefixOptions();
  const isCustom = referralPrefixMode === "custom";
  elements.customReferralPrefixRow?.classList.toggle("hidden", !isCustom);
  const prefix = referralPrefixMode === "alt"
    ? "ALT"
    : isCustom
      ? customReferralPrefix || "your custom prefix"
      : referralPrefixMode === "mixed"
        ? "RFALT"
        : "RF";
  if (elements.referralCode) {
    elements.referralCode.placeholder = `Enter the part after ${prefix}`;
  }
  if (elements.referralPrefixHelp) {
    elements.referralPrefixHelp.textContent = `${prefix} will be added automatically. The body can include letters, numbers, hyphens (-), and underscores (_).`;
  }
}

function getReferralPrefixMode() {
  return document.querySelector('input[name="referral-prefix-mode"]:checked')?.value || "standard";
}

function getReferralPrefixOptions() {
  const referralPrefixMode = getReferralPrefixMode();
  const customReferralPrefix = readValue("custom-referral-prefix");
  return {
    referralPrefixMode,
    customReferralPrefix,
    referralPrefix: referralPrefixMode === "alt" ? "ALT" : "RF",
  };
}

function sharedPayload() {
  return {
    outputDir: readValue("output-dir"),
    replacementCode: readValue("replacement-code"),
    archiveBasename: readValue("archive-basename"),
    archiveNamingOptions: collectArchiveNamingOptions(),
    referralReplacementCode: readValue("referral-code"),
    patientIdSettings: collectPatientIdSettings(),
    ssnValue: readValue("ssn-value"),
    identityOptions: {
      randomizeSsn: readChecked("randomize-ssn"),
      randomizeDob: readChecked("randomize-dob"),
      selectedPaymentCodes: [...state.selectedPaymentCodes],
      useAllPaymentCodes: readChecked("use-all-payment-codes"),
      randomizeFacilityId: readChecked("randomize-facility-id"),
      selectedFacilityIds: readChecked("randomize-facility-id") ? [] : [...state.selectedFacilityIds],
      selectedNetworks: getSelectedNetworkValues(),
      selectedCarePackageKeys: [...state.selectedCarePackageKeys],
      useAllCarePackages: readChecked("use-all-care-packages"),
      selectedSituationalCarePackageKeys: [...state.selectedSituationalCarePackageKeys],
      useAllSituationalCarePackages: readChecked("use-all-situational-care-packages"),
      ...getReferralPrefixOptions(),
      matchSuffixLength: Number(readValue("match-suffix-length")),
    },
    listDateOverride: getListDateOverride(),
    clearOutput: readChecked("clear-output"),
    keepMasterJson: readChecked("keep-master-json"),
    keepProcessedJson: readChecked("keep-processed-json"),
    optionalOverrides: collectOptionalOverrides(),
    upload: collectUploadSettings(),
  };
}

function collectPersistedUploadTargets() {
  const uploadTargets = {};

  for (const row of document.querySelectorAll(".upload-target")) {
    const targetName = row.dataset.target;
    if (!targetName) {
      continue;
    }

    uploadTargets[targetName] = {
      enabled: row.querySelector(".upload-enabled")?.checked || false,
      userName: row.querySelector(".upload-user")?.value || "",
      remoteDirectory: row.querySelector(".upload-path")?.value.trim() || "",
    };
  }

  return uploadTargets;
}

function collectUiSettings() {
  return {
    theme: state.theme,
    mainTab: state.mainTab,
    subTab: state.subTab,
    optionalFieldsVisible: state.optionalFieldsVisible,
    acknowledgedReleaseKey: state.acknowledgedReleaseKey,
    inputDir: readValue("input-dir"),
    outputDir: readValue("output-dir"),
    replacementCode: readValue("replacement-code"),
    archiveBasename: readValue("archive-basename"),
    archiveAppendNetwork: readChecked("archive-append-network"),
    archiveAppendReferralDateTime: readChecked("archive-append-referral-date-time"),
    useAltFilenamePrefix: readChecked("use-alt-filename-prefix"),
    archiveNamingMode: collectArchiveNamingOptions().mode,
    archiveCustomValues: collectArchiveNamingOptions().customValues,
    archiveCustomText: readValue("archive-custom-text"),
    referralPrefixMode: getReferralPrefixMode(),
    customReferralPrefix: readValue("custom-referral-prefix"),
    referralCode: readValue("referral-code"),
    ssnValue: readValue("ssn-value"),
    randomizeSsn: readChecked("randomize-ssn"),
    randomizeDob: readChecked("randomize-dob"),
    randomizeFacilityId: readChecked("randomize-facility-id"),
    matchSuffixLength: readValue("match-suffix-length"),
    patientIdMode: getSelectedPatientIdMode(),
    patientIdCustomValue: readValue("patient-id-custom-value"),
    selectedFacilityIds: [...state.selectedFacilityIds],
    selectedNetworks: [...state.selectedNetworks],
    useAllNetworks: readChecked("use-all-networks"),
    selectedCarePackageKeys: [...state.selectedCarePackageKeys],
    useAllCarePackages: readChecked("use-all-care-packages"),
    selectedSituationalCarePackageKeys: [...state.selectedSituationalCarePackageKeys],
    useAllSituationalCarePackages: readChecked("use-all-situational-care-packages"),
    selectedPaymentCodes: [...state.selectedPaymentCodes],
    useAllPaymentCodes: readChecked("use-all-payment-codes"),
    overrideReferralPeriod: readValue("override-referral-period"),
    overrideDob: readValue("override-dob"),
    overrideReferralCategory: readValue("override-referral-category"),
    useCurrentReferralDates: readChecked("use-current-referral-dates"),
    overrideReferralDate: readValue("override-referral-date"),
    overrideReferralDateTime: readValue("override-referral-date-time"),
    overrideReferralExpirationDate: readValue("override-referral-expiration-date"),
    overrideReferralLastUpdateDate: readValue("override-referral-last-update-date"),
    fileCount: readValue("file-count"),
    referralsPerFile: readValue("referrals-per-file"),
    clearOutput: readChecked("clear-output"),
    keepMasterJson: readChecked("keep-master-json"),
    keepProcessedJson: readChecked("keep-processed-json"),
    uploadEnabled: readChecked("upload-enabled"),
    uploadTargets: collectPersistedUploadTargets(),
    leieDuplicateKey: state.leieDuplicateKey,
    leieDuplicateHandling: state.leieDuplicateHandling,
    leieOutputFileName: state.mainTab === "leie" ? readValue("replacement-code") : state.leieOutputFileName,
    leieValidationBatchId: readValue("leie-validation-batch-id"),
  };
}

function scheduleUiSettingsSave() {
  clearTimeout(state.uiSettingsSaveTimer);
  state.uiSettingsSaveTimer = window.setTimeout(async () => {
    const settings = collectUiSettings();
    const signature = JSON.stringify(settings);
    if (signature === state.lastSavedUiSettingsSignature) return;
    try {
      await window.dgfp.saveUiSettings(settings);
      state.lastSavedUiSettingsSignature = signature;
    } catch (error) {
      console.error("Unable to save UI settings.", error);
    }
  }, 450);
}

function applyUploadTargetSettings(uploadTargets = {}) {
  for (const row of document.querySelectorAll(".upload-target")) {
    const targetName = row.dataset.target;
    const targetSettings = uploadTargets[targetName];
    if (!targetSettings) {
      continue;
    }

    row.querySelector(".upload-enabled").checked = Boolean(targetSettings.enabled);
    if (targetSettings.userName && row.querySelector(".upload-user")) {
      row.querySelector(".upload-user").value = targetSettings.userName;
    }
    if (row.querySelector(".upload-path")) {
      row.querySelector(".upload-path").value = resolveUploadDirectoryForWorkflow(
        targetSettings.remoteDirectory,
        state.mainTab,
        row.dataset.referralDefaultDirectory
      );
    }
  }
}

function syncWorkflowUploadDirectories() {
  for (const row of document.querySelectorAll(".upload-target")) {
    const pathInput = row.querySelector(".upload-path");
    const pathHelp = row.querySelector(".upload-path-help");
    if (!pathInput) {
      continue;
    }

    pathInput.value = resolveUploadDirectoryForWorkflow(
      pathInput.value,
      state.mainTab,
      row.dataset.referralDefaultDirectory
    );
    if (pathHelp) {
      pathHelp.textContent = state.mainTab === "leie"
        ? `LEIE Data uploads default to ${LEIE_DEFAULT_UPLOAD_DIRECTORY}. This is separate from the Referral default ${REFERRAL_DEFAULT_UPLOAD_DIRECTORY}.`
        : `Referral uploads default to ${REFERRAL_DEFAULT_UPLOAD_DIRECTORY}. This is separate from the LEIE Data default ${LEIE_DEFAULT_UPLOAD_DIRECTORY}.`;
    }
  }
}

async function applyUiSettings(settings = {}) {
  setTheme(settings.theme || "light");
  state.mainTab = ["referral", "leie", "other"].includes(settings.mainTab) ? settings.mainTab : "referral";
  state.subTab = settings.subTab === "generate" ? "generate" : "edit";
  state.leieDuplicateKey = settings.leieDuplicateKey || "full-row";
  state.leieDuplicateHandling = settings.leieDuplicateHandling === "auto-remove" ? "auto-remove" : "manual";
  state.leieOutputFileName = String(settings.leieOutputFileName || "").trim();
  if (state.mainTab !== "referral") {
    state.subTab = "edit";
  }
  syncTabState();

  state.optionalFieldsVisible = Boolean(settings.optionalFieldsVisible);
  syncOptionalFieldsVisibility();

  $("use-current-referral-dates").checked = settings.useCurrentReferralDates !== false;
  const valueMap = {
    "input-dir": settings.inputDir,
    "output-dir": settings.outputDir,
    "replacement-code": settings.replacementCode,
    "archive-basename": settings.archiveBasename,
    "archive-custom-text": settings.archiveCustomText,
    "referral-code": settings.referralCode,
    "ssn-value": settings.ssnValue,
    "patient-id-custom-value": settings.patientIdCustomValue,

    "override-referral-period": settings.overrideReferralPeriod,
    "override-dob": settings.overrideDob,
    "match-suffix-length": settings.matchSuffixLength || "5",
    "override-referral-category": settings.overrideReferralCategory,
    "override-referral-date": settings.overrideReferralDate,
    "override-referral-date-time": settings.overrideReferralDateTime,
    "override-referral-expiration-date": settings.overrideReferralExpirationDate,
    "override-referral-last-update-date": settings.overrideReferralLastUpdateDate,
    "file-count": settings.fileCount,
    "referrals-per-file": settings.referralsPerFile,
    "leie-validation-batch-id": settings.leieValidationBatchId,
  };

  for (const [id, value] of Object.entries(valueMap)) {
    if ($(id) && value !== undefined && value !== null) {
      $(id).value = String(value);
    }
  }

  if (state.mainTab === "leie") {
    $("replacement-code").value = state.leieOutputFileName;
  }

  const selectedPatientIdMode = String(settings.patientIdMode || "test-dynamic").trim();
  const patientIdModeInput = document.querySelector(`input[name="patient-id-mode"][value="${selectedPatientIdMode}"]`);
  if (patientIdModeInput) {
    patientIdModeInput.checked = true;
  }

  $("archive-append-network").checked = Boolean(settings.archiveAppendNetwork);
  $("archive-append-referral-date-time").checked = Boolean(settings.archiveAppendReferralDateTime);
  $("use-alt-filename-prefix").checked = Boolean(settings.useAltFilenamePrefix);
  const archiveNamingMode = ["referral-number", "network", "referral-date-time", "custom"].includes(settings.archiveNamingMode)
    ? settings.archiveNamingMode
    : "referral-number";
  const archiveModeInput = document.querySelector(`input[name="archive-naming-mode"][value="${archiveNamingMode}"]`);
  if (archiveModeInput) archiveModeInput.checked = true;
  const selectedArchiveCustomValues = new Set(
    Array.isArray(settings.archiveCustomValues)
      ? settings.archiveCustomValues
      : ["referralNumber", "customText"]
  );
  for (const input of document.querySelectorAll(".archive-custom-value")) {
    input.checked = selectedArchiveCustomValues.has(input.value);
  }
  const referralPrefixMode = ["standard", "alt", "mixed", "custom"].includes(settings.referralPrefixMode)
    ? settings.referralPrefixMode
    : settings.useAltReferralPrefix
      ? "alt"
      : "standard";
  const referralPrefixInput = document.querySelector(`input[name="referral-prefix-mode"][value="${referralPrefixMode}"]`);
  if (referralPrefixInput) referralPrefixInput.checked = true;
  $("custom-referral-prefix").value = settings.customReferralPrefix || "";
  $("clear-output").checked = Boolean(settings.clearOutput);
  $("keep-existing-files").checked = !Boolean(settings.clearOutput);
  $("use-all-payment-codes").checked = settings.useAllPaymentCodes !== false;
  state.selectedPaymentCodes = [...new Set((settings.selectedPaymentCodes || [settings.overridePaymentAuthorityCode]).filter((code) => state.paymentCodeBySelectorKey.has(code)))];
  $("keep-master-json").checked = settings.keepMasterJson !== false;
  $("keep-processed-json").checked = settings.keepProcessedJson !== false;
  $("upload-enabled").checked = Boolean(settings.uploadEnabled);
  $("randomize-ssn").checked = settings.randomizeSsn !== false;
  $("randomize-dob").checked = settings.randomizeDob !== false;
  $("randomize-facility-id").checked = Boolean(settings.randomizeFacilityId);
  state.selectedFacilityIds = [...new Set(
    (Array.isArray(settings.selectedFacilityIds)
      ? settings.selectedFacilityIds
      : [settings.overrideFacilityId])
      .map((value) => String(value || "").trim().toUpperCase())
      .filter((value) => findFacilityOption(value))
  )];
  state.selectedCarePackageKeys = [...new Set(
    (Array.isArray(settings.selectedCarePackageKeys) ? settings.selectedCarePackageKeys : [])
      .map((value) => String(value || ""))
      .filter((value) => state.carePackageBySelectorKey.has(value))
  )];
  state.selectedSituationalCarePackageKeys = [...new Set(
    (Array.isArray(settings.selectedSituationalCarePackageKeys) ? settings.selectedSituationalCarePackageKeys : [])
      .map((value) => String(value || ""))
      .filter((value) => state.situationalCarePackageBySelectorKey.has(value))
  )];
  state.selectedNetworks = [...new Set(
    (Array.isArray(settings.selectedNetworks)
      ? settings.selectedNetworks
      : settings.overrideNetwork ? [settings.overrideNetwork] : [])
      .map((value) => String(value || "").trim().toUpperCase())
      .filter((value) => NETWORK_VALUES.includes(value))
  )];
  elements.useAllCarePackages.checked = Boolean(settings.useAllCarePackages);
  elements.useAllSituationalCarePackages.checked = Boolean(settings.useAllSituationalCarePackages);
  elements.useAllNetworks.checked = Boolean(settings.useAllNetworks);

  syncPatientIdFieldState();
  syncReferralPrefixState();
  syncArchiveNamingState();
  syncIdentityControls();
  syncLeieValidationSql();
  updateTemplateSummary();
  syncWorkflowText();
  $("leie-action-auto").checked = state.leieDuplicateHandling === "auto-remove";
  $("leie-action-manual").checked = state.leieDuplicateHandling !== "auto-remove";
  renderSelectedFacilities();
  renderNetworkSelection();
  renderNetworkMenu();
  renderSelectedCarePackages(getCarePackageSelectorConfig("payment"));
  renderSelectedCarePackages(getCarePackageSelectorConfig(false));
  renderSelectedCarePackages(getCarePackageSelectorConfig(true));
  applyUploadTargetSettings(settings.uploadTargets || {});
  syncUploadTargetState();
  state.lastSavedUiSettingsSignature = JSON.stringify(collectUiSettings());

  try {
    if (readValue("input-dir")) {
      await inspectSourceFolder();
    } else {
      updatePreviews();
    }
  } catch (error) {
    console.error("Unable to inspect source while restoring settings.", error);
  }
  syncReleaseAnnouncement();
}

function setUploadReadyState(mode = "idle") {
  state.uploadImportState = mode;
  elements.uploadReadyPill.className = "pill-note";

  if (mode === "importing") {
    elements.uploadReadyPill.classList.add("is-working");
    elements.uploadReadyPill.textContent = "Importing upload config...";
    return;
  }

  if (mode === "failed") {
    elements.uploadReadyPill.classList.add("is-error");
    elements.uploadReadyPill.textContent = "Upload config import failed";
    return;
  }

  if (state.info?.profileSource?.path) {
    elements.uploadReadyPill.classList.add("is-success");
    const summaryText = formatUploadProfileSummary(state.info.uploadProfileSummary);
    elements.uploadReadyPill.textContent = summaryText
      ? `Upload profiles imported: ${summaryText}`
      : "Upload profiles imported";
    return;
  }

  elements.uploadReadyPill.textContent = "No upload config imported";
}

function getPreviewFileCount() {
  if (state.subTab === "generate") {
    return Math.max(Number(readValue("file-count") || 1), 1);
  }

  return Math.max(Number(state.sourceInspection?.fileCount || 0), 1);
}

function formatJsonPreviewList(baseName, fileCount) {
  if (!baseName) {
    return state.subTab === "generate"
      ? "Preview: generated JSON names will be used"
      : "Preview: original JSON names will be used";
  }

  if (fileCount <= 1) {
    return `Preview: ${baseName}.json`;
  }

  const visibleCount = Math.min(fileCount, 3);
  const fileNames = [];
  for (let index = 1; index <= visibleCount; index += 1) {
    fileNames.push(`${baseName}_${index}.json`);
  }

  if (fileCount > visibleCount) {
    fileNames.push(`+${fileCount - visibleCount} more`);
  }

  return `Preview: ${fileNames.join(", ")}`;
}

function renderUploadTargets(targets) {
  elements.uploadTargets.innerHTML = "";

  for (const target of targets) {
    const wrapper = document.createElement("div");
    wrapper.className = "upload-target";
    wrapper.dataset.target = target.name;
    wrapper.dataset.referralDefaultDirectory = target.defaultRemoteDirectory || REFERRAL_DEFAULT_UPLOAD_DIRECTORY;
    const defaultRemoteDirectory = resolveUploadDirectoryForWorkflow(
      "",
      state.mainTab,
      wrapper.dataset.referralDefaultDirectory
    );

    const userOptions = (target.users || [])
      .map((user) => `<option value="${user}">${user}</option>`)
      .join("");

    wrapper.innerHTML = `
      <div class="upload-target-header">
        <div class="upload-target-copy">
          <strong>${target.name} Server: ${target.serverDisplay || "No server found yet"}</strong>
          <span class="upload-target-note">Choose the account and remote destination for ${target.name}.</span>
        </div>
        <label class="checkbox-chip">
          <input class="upload-enabled" type="checkbox" />
          <span>Upload to ${target.name}</span>
        </label>
      </div>
      <div class="form-grid two-col upload-target-grid">
        <label class="field-block">
          <span>User</span>
          <select class="upload-user">${userOptions}</select>
          <small class="helper-text upload-user-help">Choose the account for this upload target.</small>
        </label>
        <label class="field-block">
          <span>Remote Directory</span>
          <input class="upload-path" type="text" value="${defaultRemoteDirectory}" />
          <small class="helper-text upload-path-help">Referral uploads default to ${REFERRAL_DEFAULT_UPLOAD_DIRECTORY}.</small>
        </label>
      </div>
      <div class="upload-target-actions">
        <button type="button" class="toolbar-button upload-test-connection">Test Connection</button>
        <span class="upload-test-status">Not tested yet.</span>
      </div>
    `;

    const userSelect = wrapper.querySelector(".upload-user");
    const pathInput = wrapper.querySelector(".upload-path");
    const enabledInput = wrapper.querySelector(".upload-enabled");
    const testButton = wrapper.querySelector(".upload-test-connection");

    userSelect.addEventListener("change", () => {
      setUploadTargetStatus(wrapper);
      updatePreviews();
      scheduleUiSettingsSave();
    });
    pathInput.addEventListener("input", () => {
      setUploadTargetStatus(wrapper);
      updatePreviews();
      scheduleUiSettingsSave();
    });
    enabledInput.addEventListener("change", () => {
      setUploadTargetStatus(wrapper);
      syncUploadTargetState();
      updatePreviews();
      scheduleUiSettingsSave();
    });
    testButton.addEventListener("click", () => testUploadTarget(wrapper));

    elements.uploadTargets.appendChild(wrapper);
  }

  syncUploadTargetState();
}

function syncUploadTargetState() {
  const uploadEnabled = Boolean(elements.uploadEnabled?.checked);

  for (const row of document.querySelectorAll(".upload-target")) {
    const targetToggle = row.querySelector(".upload-enabled");
    const userSelect = row.querySelector(".upload-user");
    const pathInput = row.querySelector(".upload-path");
    const testButton = row.querySelector(".upload-test-connection");

    if (!targetToggle) {
      continue;
    }

    const available = isUploadTargetAvailableForWorkflow(row.dataset.target);
    row.classList.toggle("hidden", !available);
    row.setAttribute("aria-hidden", String(!available));
    targetToggle.disabled = !available || !uploadEnabled;
    const targetActive = available && uploadEnabled && targetToggle.checked;

    if (userSelect) {
      userSelect.disabled = !targetActive;
    }
    if (pathInput) {
      pathInput.disabled = !targetActive;
    }
    if (testButton) {
      testButton.disabled = !targetActive;
    }
  }
}

function syncPatientIdFieldState() {
  const mode = getSelectedPatientIdMode();
  const input = elements.patientIdCustomValue;
  const { testPrefix, suffixLength, totalLength } = getPatientIdConstants();
  if (!input) {
    return;
  }

  input.disabled = mode === "test-dynamic" || mode === "referral-match";
  input.value = sanitizePatientIdInput(input.value, mode);

  if (mode === "test-custom-suffix") {
    input.placeholder = `Enter up to ${suffixLength} letters or numbers after ${testPrefix}`;
    return;
  }

  if (mode === "custom-full") {
    input.placeholder = `Enter up to ${totalLength} letters or numbers`;
    return;
  }

  if (mode === "referral-match") {
    input.value = "";
    input.placeholder = "Generated from each Referral Number";
    return;
  }

  input.placeholder = `Using ${testPrefix} + generated digits`;
}

function applyGeneratorDefaults() {
  const defaults = state.info?.generatorDefaults || {};

  setValueIfEmpty("override-referral-period", defaults.referralPeriod);
  setValueIfEmpty("override-referral-category", defaults.category);
  if (state.subTab === "generate" && readChecked("use-current-referral-dates")) {
    const now = new Date();
    const text = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const period = readValue("override-referral-period").match(/^(\d+)\s*(?:days?)?$/i);
    const expiration = new Date(now);
    expiration.setDate(expiration.getDate() + (period ? Number(period[1]) : 990));
    $("override-referral-date").value = text(now);
    $("override-referral-date-time").value = `${text(now)} ${[now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, "0")).join(":")}`;
    $("override-referral-expiration-date").value = text(expiration);
    $("override-referral-last-update-date").value = text(now);
  }
}

function applyInfo(info) {
  state.info = info;
  referralUploadTargetNames = new Set(info.workflowPolicy?.referralUploadTargets || ["SQA", "DEV", "PPD"]);
  state.paymentCodeBySelectorKey = new Map();
  state.paymentCodeSearchIndex = (info.paymentAuthorityCodes || []).map((code) => {
    const option = { selectorKey: code, name: code };
    state.paymentCodeBySelectorKey.set(code, option);
    return { option, searchText: code.toLowerCase() };
  });
  state.facilityById = new Map();
  state.facilitySelectableCount = 0;
  state.facilitySearchIndex = (info.facilities || []).map((option) => {
    const facilityId = String(option.facility_id || "").trim().toUpperCase();
    if (facilityId && !state.facilityById.has(facilityId)) {
      state.facilityById.set(facilityId, option);
    }
    if (facilityId) state.facilitySelectableCount += 1;
    return {
      option,
      searchText: [
        option.facility_key,
        option.facility_id,
        option.region_id,
        option.facility_name,
        option.parent_facility_id,
      ].filter(Boolean).join(" ").toLowerCase(),
    };
  });
  state.carePackageBySelectorKey = new Map();
  state.carePackageSearchIndex = (info.carePackageOptions || []).map((option) => {
    state.carePackageBySelectorKey.set(option.selectorKey, option);
    return {
      option,
      searchText: [option.displayName, option.name, option.carePackageNumber, option.carePackageKey, option.carePackageId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });
  state.situationalCarePackageBySelectorKey = new Map();
  state.situationalCarePackageSearchIndex = (info.situationalCarePackageOptions || []).map((option) => {
    state.situationalCarePackageBySelectorKey.set(option.selectorKey, option);
    return {
      option,
      searchText: [option.displayName, option.name, option.carePackageNumber, option.carePackageKey, option.carePackageId]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });
  state.acknowledgedReleaseKey = String(
    info.releaseAnnouncement?.acknowledgedReleaseKey || state.acknowledgedReleaseKey || ""
  ).trim();
  elements.appVersionBadge.textContent = info.appVersionLabel || "";
  elements.appVersionBadge.classList.toggle("hidden", !info.appVersionLabel);
  document.title = info.appVersionLabel
    ? `Data Generator & File Processing | ${info.appVersionLabel}`
    : "Data Generator & File Processing";
  setUploadReadyState("idle");
  state.leieOutputFileName = String(info.uiSettings?.leieOutputFileName || state.leieOutputFileName || "").trim();
  renderUploadTargets(info.uploadTargets || []);
  const limits = info.constants?.processingLimits || {};
  if (limits.maxGeneratedFiles) elements.fileCount.max = String(limits.maxGeneratedFiles);
  if (limits.maxReferralsPerFile) elements.referralsPerFile.max = String(limits.maxReferralsPerFile);
  if (limits.maxGeneratedFiles) {
    elements.fileCountHelp.dataset.defaultText = `Maximum ${Number(limits.maxGeneratedFiles).toLocaleString()} files per run.`;
    elements.fileCountHelp.textContent = elements.fileCountHelp.dataset.defaultText;
  }
  if (limits.maxReferralsPerFile) {
    elements.referralsPerFileHelp.dataset.defaultText = `Maximum ${Number(limits.maxReferralsPerFile).toLocaleString()} referrals per file.`;
    elements.referralsPerFileHelp.textContent = elements.referralsPerFileHelp.dataset.defaultText;
  }
  applyGeneratorDefaults();
  applyUploadTargetSettings(info.uiSettings?.uploadTargets || {});
  syncUploadTargetState();
  updateTemplateSummary();
  updatePreviews();
  syncReleaseAnnouncement();
}

function applySourceInspection(inspection) {
  state.sourceInspection = inspection;
  const fileCount = Number(inspection?.fileCount || 0);
  elements.sourceFileCount.textContent = fileCount
    ? `${fileCount} source JSON file${fileCount === 1 ? "" : "s"} selected (${formatBytes(inspection.totalSourceBytes)}).`
    : "No JSON files were found in the selected folder.";

  state.sourceListDate = inspection?.firstListDate || "";
  elements.listDateSourceValue.textContent = state.sourceListDate
    ? state.sourceListDate
    : "No source ListDate found yet.";

  const defaults = inspection?.defaults || {};
  setValueIfEmpty("override-referral-period", defaults.referralPeriod);
  setValueIfEmpty("override-dob", defaults.dateOfBirth);
  setValueIfEmpty("override-referral-category", defaults.category);
  setValueIfEmpty("override-referral-date", defaults.referralDate);
  setValueIfEmpty("override-referral-date-time", defaults.referralDateTime);
  setValueIfEmpty("override-referral-expiration-date", defaults.expirationDate);
  setValueIfEmpty("override-referral-last-update-date", defaults.lastUpdateDate);

  updatePreviews();
}

function renderLeieDuplicateTable(duplicates = []) {
  elements.leieDuplicateTableBody.innerHTML = "";
  for (const duplicate of duplicates) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${duplicate.fileName}</td>
      <td>${duplicate.rowNumber}</td>
      <td>${duplicate.duplicateValue || "(blank)"}</td>
      <td>${duplicate.columnName}</td>
    `;
    elements.leieDuplicateTableBody.appendChild(row);
  }
  elements.leieDuplicateTableWrap.classList.toggle("hidden", duplicates.length === 0);
}

function hasLeieBlockingIssues() {
  if (state.mainTab !== "leie") {
    return false;
  }

  const inspection = state.leieInspection;
  if (!inspection || !inspection.fileCount) {
    return true;
  }
  if ((inspection.validationErrors || []).length > 0) {
    return true;
  }
  if (inspection.hasDuplicates && state.leieDuplicateHandling !== "auto-remove") {
    return true;
  }

  return false;
}

function setLeieResultTone(tone = "neutral") {
  const classMap = ["is-success", "is-error", "is-working"];
  elements.leieDuplicateResult.classList.remove(...classMap);
  elements.leieDuplicateSummary.classList.remove(...classMap);

  if (tone === "success") {
    elements.leieDuplicateResult.classList.add("is-success");
    elements.leieDuplicateSummary.classList.add("is-success");
    return;
  }

  if (tone === "error") {
    elements.leieDuplicateResult.classList.add("is-error");
    elements.leieDuplicateSummary.classList.add("is-error");
    return;
  }

  if (tone === "working") {
    elements.leieDuplicateResult.classList.add("is-working");
    elements.leieDuplicateSummary.classList.add("is-working");
  }
}

function syncLeieUiState() {
  if (state.mainTab !== "leie") {
    return;
  }

  const inspection = state.leieInspection;
  const inspectionError = String(state.leieInspectionError || "").trim();
  const duplicates = inspection?.duplicates || [];
  const validationErrors = inspection?.validationErrors || [];
  const hasDuplicates = Boolean(inspection?.hasDuplicates);
  const hasBlockingIssues = hasLeieBlockingIssues();

  elements.leieDuplicateActions.classList.toggle("hidden", !hasDuplicates);
  elements.outputCard.classList.toggle("is-disabled", hasBlockingIssues);
  elements.runProcess.disabled = hasBlockingIssues;

  if (inspectionError) {
    setLeieResultTone("error");
    elements.leieDuplicateResult.value = "LEIE scan failed";
    elements.leieDuplicateSummary.textContent = inspectionError;
  } else if (!inspection || !inspection.fileCount) {
    setLeieResultTone("neutral");
    elements.leieDuplicateResult.value = "No LEIE source folder selected.";
    elements.leieDuplicateSummary.textContent = "Pick a source file and click Rescan to run duplicate detection.";
  } else if (validationErrors.length > 0) {
    setLeieResultTone("error");
    elements.leieDuplicateResult.value = `${validationErrors.length} file validation issue${validationErrors.length === 1 ? "" : "s"} found`;
    elements.leieDuplicateSummary.textContent = "Please fix the file issues and run Rescan.";
  } else if (hasDuplicates) {
    setLeieResultTone("error");
    elements.leieDuplicateResult.value = `${duplicates.length} duplicate row${duplicates.length === 1 ? "" : "s"} found`;
    elements.leieDuplicateSummary.textContent = "Exact full-row duplicates were detected. Review rows in the table below.";
  } else {
    setLeieResultTone("success");
    elements.leieDuplicateResult.value = "No duplicate rows found";
    elements.leieDuplicateSummary.textContent = "Scan complete. Every row is unique across all columns.";
  }

  renderLeieDuplicateTable(duplicates);
}

async function inspectLeieSourceFolder(options = {}) {
  const force = Boolean(options.force);
  const inputDir = readValue("input-dir");
  if (!inputDir) {
    state.leieInspection = null;
    state.leieInspectionError = "";
    state.leieLastScannedInput = "";
    elements.sourceFileCount.textContent = "No LEIE source file or folder selected.";
    elements.listDateSourceValue.textContent = "Select an Excel file or folder to scan for LEIE data.";
    syncLeieUiState();
    updatePreviews();
    return;
  }
  const sourceChanged = inputDir !== state.leieLastScannedInput;
  if (!force && !sourceChanged) {
    return;
  }

  const requestId = state.leieScanRequestId + 1;
  state.leieScanRequestId = requestId;

  state.leieInspectionError = "";
  // Reflect user selection immediately so the UI never looks stale while inspection runs.
  setStatus("Scanning LEIE", "Reading the selected Excel data and checking every row for exact duplicates...");
  elements.sourceFileCount.textContent = "Scanning selected LEIE source...";
  elements.listDateSourceValue.textContent = inputDir;
  setLeieResultTone("working");
  elements.leieDuplicateResult.value = "Scanning duplicate rows...";
  elements.leieDuplicateSummary.textContent = "Running full-row duplicate scan...";

  try {
    const inspection = await window.dgfp.inspectLeieSource(inputDir, "full-row");
    if (requestId !== state.leieScanRequestId) {
      return;
    }
    state.leieInspection = inspection;
    state.leieInspectionError = "";
    state.leieLastScannedInput = inputDir;
    if (sourceChanged || !readValue("replacement-code")) {
      state.leieOutputFileName = inspection.outputNameSuggestion || "";
      elements.replacementCode.value = state.leieOutputFileName;
    }

    elements.sourceFileCount.textContent = inspection.fileCount
      ? `${inspection.fileCount} source Excel file${inspection.fileCount === 1 ? "" : "s"} selected: ${inspection.totalRowCount.toLocaleString()} rows, ${formatBytes(inspection.totalSourceBytes)}.`
      : "No Excel files were found in the selected source path.";
    if (inspection.excelFiles?.length) {
      const names = inspection.excelFiles.slice(0, 3).map((file) => file.name).join(", ");
      const more = inspection.excelFiles.length > 3 ? ` +${inspection.excelFiles.length - 3} more` : "";
      elements.listDateSourceValue.textContent = `Detected Excel files: ${names}${more}`;
    } else {
      elements.listDateSourceValue.textContent = "No Excel files detected yet.";
    }

    if (inspection.validationErrors.length > 0) {
      const firstValidationError = inspection.validationErrors[0];
      setStatus("Failed", `${firstValidationError.fileName}: ${firstValidationError.message}`);
    } else if (inspection.hasDuplicates) {
      setStatus("Duplicates Found", "Resolve duplicates before saving the processed LEIE file.");
    } else if (inspection.fileCount > 0) {
      setStatus("Source Ready", `${inspection.fileCount} LEIE file${inspection.fileCount === 1 ? " is" : "s are"} loaded with ${inspection.totalRowCount.toLocaleString()} rows and no duplicates. Select Save Processed File when ready.`);
    } else {
      setStatus("Ready", "No Excel files were found. Choose a supported LEIE workbook or another folder.");
    }
  } catch (error) {
    if (requestId !== state.leieScanRequestId) {
      return;
    }
    state.leieInspection = null;
    state.leieInspectionError = error.message || "Unknown error while scanning LEIE source.";
    state.leieLastScannedInput = "";
    elements.sourceFileCount.textContent = "Unable to scan selected LEIE source.";
    elements.listDateSourceValue.textContent = inputDir;
    setStatus("Failed", error.message);
  }

  syncLeieUiState();
  updatePreviews();
}

async function inspectSourceFolder() {
  if (state.mainTab === "leie" || isExcelPath(readValue("input-dir"))) {
    await inspectLeieSourceFolder();
    return;
  }

  const inputDir = readValue("input-dir");
  if (!inputDir) {
    state.sourceInspection = null;
    state.sourceListDate = "";
    elements.sourceFileCount.textContent = "No source folder selected.";
    elements.listDateSourceValue.textContent = "Default ListDate will appear after you choose a source folder.";
    if (!state.listDateTouched) {
      setDateParts("0000-00-00 00:00:00");
    }
    updatePreviews();
    return;
  }

  setStatus("Scanning Referral Files", "Reading the selected folder and checking the available JSON files...");
  try {
    const inspection = await window.dgfp.inspectSource(inputDir);
    applySourceInspection(inspection);
    setStatus(
      inspection.fileCount > 0 ? "Source Ready" : "Ready",
      inspection.fileCount > 0
        ? `${inspection.fileCount} Referral JSON file${inspection.fileCount === 1 ? " is" : "s are"} ready. Review the settings, then select Run Processing.`
        : "No Referral JSON files were found. Choose another source folder."
    );
  } catch (error) {
    setStatus("Failed", error.message);
  }
}

function applyFieldErrors(fieldErrors = {}) {
  setStaticHelperState(elements.outputDirHelp, $("output-dir"), fieldErrors.outputDir);
  setStaticHelperState(elements.ssnHelp, $("ssn-value"), fieldErrors.ssnValue);
  setStaticHelperState(elements.archiveNameHelp, $("archive-basename"), fieldErrors.archiveBasename);
  setStaticHelperState(elements.fileCountHelp, $("file-count"), fieldErrors.fileCount);
  setStaticHelperState(elements.referralsPerFileHelp, $("referrals-per-file"), fieldErrors.referralsPerFile);
  setStaticHelperState(elements.dobHelp, $("override-dob"), fieldErrors.dateOfBirth);
  setStaticHelperState(elements.referralDateHelp, $("override-referral-date"), fieldErrors.referralDate);
  setStaticHelperState(elements.referralDateTimeHelp, $("override-referral-date-time"), fieldErrors.referralDateTime);
  setStaticHelperState(
    elements.referralExpirationDateHelp,
    $("override-referral-expiration-date"),
    fieldErrors.expirationDate
  );
  setStaticHelperState(
    elements.referralLastUpdateDateHelp,
    $("override-referral-last-update-date"),
    fieldErrors.lastUpdateDate
  );
  const referralError = fieldErrors.referralPrefix || fieldErrors.referralReplacementCode;
  setPreviewHelperState(
    elements.referralPreview,
    fieldErrors.referralPrefix ? $("custom-referral-prefix") : $("referral-code"),
    referralError
  );
  setInputValidity($("referral-code"), Boolean(fieldErrors.referralReplacementCode));
  setInputValidity($("custom-referral-prefix"), Boolean(fieldErrors.referralPrefix));
  setPreviewHelperState(elements.patientIdPreview, $("patient-id-custom-value"), fieldErrors.patientIdValue);
  setPreviewHelperState(elements.facilityIdPreview, $("override-facility-id"), fieldErrors.facilityId);
  setPreviewHelperState(
    elements.paymentAuthorityCodePreview,
    $("override-payment-authority-code"),
    fieldErrors.paymentAuthorityCode
  );

  for (const row of document.querySelectorAll(".upload-target")) {
    const serverName = row.dataset.target || "target";
    const userError = fieldErrors[`upload:${serverName}:user_name`] || "";
    const pathError = fieldErrors[`upload:${serverName}:remote_directory`] || "";
    const userHelp = row.querySelector(".upload-user-help");
    const pathHelp = row.querySelector(".upload-path-help");
    const userInput = row.querySelector(".upload-user");
    const pathInput = row.querySelector(".upload-path");

    if (userHelp && !userHelp.dataset.defaultText) {
      userHelp.dataset.defaultText = userHelp.textContent;
    }
    if (pathHelp && !pathHelp.dataset.defaultText) {
      pathHelp.dataset.defaultText = pathHelp.textContent;
    }

    setStaticHelperState(userHelp, userInput, userError);
    setStaticHelperState(pathHelp, pathInput, pathError);
  }
}

async function testUploadTarget(row) {
  const serverName = row.dataset.target;
  const userName = row.querySelector(".upload-user").value;
  const remoteDirectory = row.querySelector(".upload-path").value.trim();
  const button = row.querySelector(".upload-test-connection");

  button.disabled = true;
  setUploadTargetStatus(row, "Testing connection...", "working");
  setStatus("Testing Connection", `Connecting to ${serverName} and confirming access to ${remoteDirectory || "the selected remote directory"}...`);

  try {
    const result = await window.dgfp.testUploadTarget({
      server_name: serverName,
      user_name: userName,
      remote_directory: remoteDirectory,
    });
    setUploadTargetStatus(row, result.message, "success");
    setStatus("Connection Ready", `${result.message} This target is ready for the next upload.`);
  } catch (error) {
    setUploadTargetStatus(row, error.message, "error");
    setStatus("Failed", error.message);
  } finally {
    button.disabled = false;
  }
}

async function updatePreviews() {
  if (!state.info) {
    return null;
  }

  if (state.mainTab === "leie") {
    const outputBaseName = sanitizeLeieFileNameInput(readValue("replacement-code"));
    if (readValue("replacement-code") !== outputBaseName) {
      elements.replacementCode.value = outputBaseName;
    }
    state.leieOutputFileName = outputBaseName;
    elements.outputJsonPreview.textContent = outputBaseName
      ? `Preview: ${outputBaseName}.xlsx`
      : "Preview: original source file name will be used with .xlsx";
    elements.archivePreview.textContent = "Preview: not used for LEIE";
    return { fieldErrors: {} };
  }

  const previewPayload = {
    inputDir: readValue("input-dir"),
    outputDir: readValue("output-dir"),
    replacementCode: readValue("replacement-code"),
    archiveBasename: readValue("archive-basename"),
    archiveNamingOptions: collectArchiveNamingOptions(),
    referralReplacementCode: readValue("referral-code"),
    patientIdSettings: collectPatientIdSettings(),
    ssnValue: readValue("ssn-value"),
    identityOptions: {
      randomizeSsn: readChecked("randomize-ssn"),
      randomizeDob: readChecked("randomize-dob"),
      selectedPaymentCodes: [...state.selectedPaymentCodes],
      useAllPaymentCodes: readChecked("use-all-payment-codes"),
      randomizeFacilityId: readChecked("randomize-facility-id"),
      selectedFacilityIds: readChecked("randomize-facility-id") ? [] : [...state.selectedFacilityIds],
      selectedNetworks: getSelectedNetworkValues(),
      selectedCarePackageKeys: [...state.selectedCarePackageKeys],
      useAllCarePackages: readChecked("use-all-care-packages"),
      selectedSituationalCarePackageKeys: [...state.selectedSituationalCarePackageKeys],
      useAllSituationalCarePackages: readChecked("use-all-situational-care-packages"),
      ...getReferralPrefixOptions(),
      matchSuffixLength: Number(readValue("match-suffix-length")),
    },
    optionalOverrides: collectOptionalOverrides(),
    fileCount: Number(readValue("file-count") || 0),
    referralsPerFile: Number(readValue("referrals-per-file") || 0),
    upload: collectUploadSettings(),
  };
  const previewSignature = JSON.stringify(previewPayload);
  const requestId = state.previewRequestId + 1;
  try {
    let preview = state.previewCacheSignature === previewSignature
      ? state.previewCacheResult
      : null;
    if (!preview) {
      state.previewRequestId = requestId;
      preview = await window.dgfp.getPreview(previewPayload);
      if (requestId !== state.previewRequestId) return preview;
      state.previewCacheSignature = previewSignature;
      state.previewCacheResult = preview;
    }

    elements.outputJsonPreview.textContent = formatJsonPreviewList(
      preview.replacementCode,
      getPreviewFileCount()
    );
    elements.archivePreview.textContent = `${preview.outputFileNames.basename}_Master.json · ${preview.outputFileNames.gzip}`;
    elements.referralPreview.textContent = preview.referralNumber
      ? `Preview: ${preview.referralNumber}`
      : "Preview: default referral numbers from source files";
    elements.patientIdPreview.textContent = preview.patientIdPreview || "Preview: TEST + 13 generated digits";
    elements.facilityIdPreview.textContent = readChecked("randomize-facility-id")
      ? "Preview: randomized from all reference facilities"
      : state.selectedFacilityIds.length > 0
        ? `Preview: randomized from ${state.selectedFacilityIds.join(", ")}`
        : "Preview: no Facility ID override";
    updateFacilityIdMatch();
    elements.paymentAuthorityCodePreview.textContent = (readChecked("use-all-payment-codes") || !state.selectedPaymentCodes.length) ? "Preview: mixed from the configured reference codes" : `Preview: ${[...state.selectedPaymentCodes].join(", ")}`;
    applyFieldErrors(preview.fieldErrors || {});
    return preview;
  } catch (error) {
    if (requestId !== state.previewRequestId) return null;
    updateFacilityIdMatch();
    elements.referralPreview.textContent = error.message;
    elements.referralPreview.classList.add("is-error");
    return null;
  }
}

function schedulePreviewUpdate() {
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(() => updatePreviews(), 110);
}

function showResultActions(run) {
  state.lastRun = run || null;
  const hasRun = Boolean(run?.outputDir || run?.archivePath || run?.manifestPath);
  elements.resultActions?.classList.toggle("hidden", !hasRun);
  elements.openOutputFolder.disabled = !run?.outputDir;
  elements.openBatchManifest.disabled = !run?.manifestData || state.busy;
  elements.copyArchivePath.disabled = !run?.archivePath;
  elements.retryFailedUploads.classList.toggle("hidden", !run?.retryable && run?.status !== "upload-failed");
}

function buildReviewItems(command, payload) {
  return window.dgfpRunReview.buildItems(command, payload, state.sourceInspection);
}

function confirmPreRun(command, payload) {
  return window.dgfpRunReview.confirm({ command, payload, sourceInspection: state.sourceInspection, elements: { overlay: elements.preRunOverlay, summary: elements.preRunSummary, prodWrap: elements.prodConfirmWrap, prodInput: elements.prodConfirmInput, confirmButton: elements.preRunConfirm } });
}

function closePreRun(confirmed) {
  window.dgfpRunReview.close({ overlay: elements.preRunOverlay }, confirmed);
}

async function validateCurrentForm() {
  if (state.mainTab === "leie") {
    if (hasLeieBlockingIssues()) {
      setStatus("Failed", "Resolve LEIE duplicate or validation issues before saving.");
      return false;
    }
    return true;
  }

  const preview = await updatePreviews();
  const fieldErrors = preview?.fieldErrors || {};
  if (Object.keys(fieldErrors).length > 0) {
    setStatus("Failed", "Please fix the highlighted fields before running.");
    return false;
  }
  return true;
}

function updateTemplateSummary() {
  const fileCount = Math.max(Number(readValue("file-count") || 1), 1);
  const referralsPerFile = Math.max(Number(readValue("referrals-per-file") || 1), 1);
  const totalReferrals = fileCount * referralsPerFile;
  const fileLabel = `${fileCount} JSON file${fileCount === 1 ? "" : "s"}`;
  const referralLabel = `${referralsPerFile} referral${referralsPerFile === 1 ? "" : "s"} per file`;
  const totalLabel = `${totalReferrals} total referral${totalReferrals === 1 ? "" : "s"}`;
  elements.templateSummaryPill.textContent = `Generation setup: ${fileLabel} | ${referralLabel} | ${totalLabel}`;
  elements.generatorFileCountDisplay.textContent = String(fileCount);
  elements.generatorReferralsPerFileDisplay.textContent = String(referralsPerFile);
  elements.generatorTotalReferralsDisplay.textContent = String(totalReferrals);
}

function updateLiveListDate() {
  if (state.listDateTouched) {
    return;
  }
  setDateParts(nowAsListDate());
}

function startLiveListDateClock() {
  if (state.liveListDateTimer) {
    clearInterval(state.liveListDateTimer);
  }
  updateLiveListDate();
  state.liveListDateTimer = setInterval(updateLiveListDate, 1000);
}

function syncWorkflowText() {
  const isReferral = state.mainTab === "referral";
  const isLeie = state.mainTab === "leie";
  const isGenerate = state.subTab === "generate" && isReferral;
  $("current-referral-dates-control").classList.toggle("hidden", !isGenerate);
  const isOther = state.mainTab === "other";

  elements.heroTitle.textContent = "Data Generator & File Processing";
  elements.heroSubtitle.textContent = "Use the tabs below to work with referral files and related processing workflows.";
  elements.mainTabCopy.textContent = isReferral
    ? "Choose source files, apply targeted JSON updates, and export clean output in one pass."
    : isLeie
      ? "Process LEIE Excel files, detect duplicates, save clean output, and upload."
    : "Future file types will appear here.";
  elements.workflowTitle.textContent = isGenerate
    ? "Referral Generation"
    : isReferral
      ? "Referral Processing"
      : isLeie
        ? "LEIE Data Processing"
        : "Other File Processing";
  elements.workflowSubtitle.textContent = isGenerate
    ? "Create fresh referral JSON files, then process and package them."
    : isReferral
      ? "Choose source files, apply targeted JSON updates, and export clean output in one pass."
      : isLeie
        ? "Choose an Excel file or folder, scan for duplicate rows, and resolve duplicates before saving."
        : "This area is reserved for future workflow implementations.";
  elements.sourceTitle.textContent = isGenerate ? "Template Output" : "Source";
  elements.sourceSubtitle.textContent = isGenerate
    ? "Generator mode creates fresh files directly, so no source folder is required."
    : isLeie
      ? "Pick an incoming LEIE Excel file or a folder containing LEIE Excel files."
      : "Pick the folder that contains the incoming JSON files.";
  elements.outputSubtitle.textContent = isGenerate
    ? "Choose where the generated referral JSON files should be saved and how the final output should be kept."
    : isLeie
      ? "Choose where the processed LEIE Excel file should be saved."
      : "Choose where the processed JSON files should be saved and how the final output should be kept.";
  elements.outputNameLabel.textContent = isLeie
    ? "Output File Name"
    : "Name for the processed JSON files";
  elements.outputNameHelp.textContent = isLeie
    ? "Defaults to the original source file name. You can enter a different base name; the app saves as .xlsx automatically."
    : "Leave blank to keep original JSON names.";
  elements.outputJsonPreview.classList.toggle("hidden", false);
  elements.inputDir.placeholder = isLeie
    ? "Choose a LEIE Excel file (.xlsx, .xls, .xlsm, .xlsb) or a source folder"
    : "Choose the folder that contains source JSON files";
  elements.outputDir.placeholder = isLeie
    ? "Choose where processed .xlsx files should be written"
    : "Choose where JSON and .gz files should be written";
  elements.uploadSubtitle.textContent = isLeie
    ? "Optionally upload the processed LEIE .xlsx file to one or more saved environment profiles."
    : "Optionally upload the final .gz file to the DEV, PPD, or SQA Server. PROD is not available for Referral Files.";
  elements.uploadEnabledLabel.textContent = isLeie
    ? "Upload the .xlsx file after processing"
    : "Upload the .gz file after processing";
  syncWorkflowUploadDirectories();
  syncUploadTargetState();

  elements.subtabRow.classList.toggle("hidden", !isReferral);
  elements.generatorCard.classList.toggle("hidden", !isGenerate);
  elements.workflowCard.classList.toggle("hidden", isOther);
  elements.futureCard.classList.toggle("hidden", !isOther);
  elements.sourceCard.classList.toggle("hidden", isGenerate || isOther);
  elements.referralDetailsCard.classList.toggle("hidden", isOther || isLeie);
  elements.leieDuplicateCard.classList.toggle("hidden", !isLeie);
  elements.outputCard.classList.toggle("hidden", isOther);
  elements.archiveNamingCard?.classList.toggle("hidden", isLeie);
  elements.outputRetentionCard?.classList.toggle("hidden", isLeie);
  elements.outputHelp?.classList.toggle("hidden", isLeie);
  elements.leieOutputHelp?.classList.toggle("hidden", !isLeie);
  elements.uploadCard.classList.toggle("hidden", isOther);
  elements.runCard.classList.toggle("hidden", isOther);
  elements.runProcess.classList.toggle("hidden", isGenerate || isOther);
  elements.runGenerate.classList.toggle("hidden", !isGenerate || isOther);
  elements.templateSummaryPill.classList.toggle("hidden", !isGenerate || isOther);
  elements.runProcess.textContent = isLeie ? "Save Processed File" : "Run Processing";
  elements.leieGuideBanner?.classList.toggle("hidden", !isLeie);
  elements.leieUploadValidationCard?.classList.toggle("hidden", !isLeie);

  if (isGenerate) {
    applyGeneratorDefaults();
  }

  if (isLeie) {
    elements.replacementCode.placeholder = "Original source file name";
    elements.replacementCode.value = state.leieOutputFileName || elements.replacementCode.value;
    state.sourceInspection = null;
    state.sourceListDate = "";
  } else {
    elements.replacementCode.placeholder = "Leave blank to keep original JSON names";
  }

  syncLeieUiState();
  syncLeieValidationSql();
  updatePreviews();
  if (!state.busy) {
    if (isGenerate) {
      setStatus("Ready", "Ready to generate Referral Files. Choose an output folder and generation options, then select Generate Files.");
    } else if (isReferral) {
      setStatus("Ready", "Ready to process Referral Files. Choose the source and output folders, review the settings, then select Run Processing.");
    } else if (isLeie) {
      setStatus("Ready", "Ready for LEIE Data. Choose an Excel file or folder to scan, resolve any duplicate issues, then save the processed file.");
    }
  }
}

function setupTabs() {
  for (const button of document.querySelectorAll("[data-main-tab]")) {
    button.addEventListener("click", () => {
      state.mainTab = button.dataset.mainTab;
      if (state.mainTab !== "referral") {
        state.subTab = "edit";
      }
      syncTabState();
      syncWorkflowText();
      inspectSourceFolder();
      scheduleUiSettingsSave();
    });
  }

  for (const button of document.querySelectorAll("[data-sub-tab]")) {
    button.addEventListener("click", () => {
      state.subTab = button.dataset.subTab;
      syncTabState();
      syncWorkflowText();
      scheduleUiSettingsSave();
    });
  }
}

function toggleOptionalFields() {
  state.optionalFieldsVisible = !state.optionalFieldsVisible;
  syncOptionalFieldsVisibility();
}

function wireDateControls() {
  for (const field of document.querySelectorAll(".date-field")) {
    const partKey = field.dataset.datePart;
    const input = field.querySelector("input");
    input.addEventListener("input", () => {
      markDateTouched();
      const part = DATE_PARTS.find((entry) => entry.key === partKey);
      input.value = normalizeDigits(input.value, part.width);
    });
    input.addEventListener("blur", () => {
      const part = DATE_PARTS.find((entry) => entry.key === partKey);
      let value = Number(normalizeDigits(input.value, part.width) || part.min);
      if (Number.isNaN(value) || value < part.min) {
        value = part.min;
      }
      if (value > part.max) {
        value = part.max;
      }
      input.value = String(value).padStart(part.width, "0");
    });
    for (const stepButton of field.querySelectorAll(".date-step")) {
      stepButton.addEventListener("click", () => {
        adjustDatePart(partKey, Number(stepButton.dataset.step));
      });
    }
  }
}

async function refreshInfo() {
  const info = await window.dgfp.getInfo();
  applyInfo(info);
  updatePreviews();
}

async function pickDirectory(targetId) {
  let selected = "";
  if (targetId === "input-dir" && state.mainTab === "leie") {
    selected = await window.dgfp.pickFile([
      { name: "Excel Files", extensions: ["xlsx", "xls", "xlsm", "xlsb"] },
      { name: "All Files", extensions: ["*"] },
    ]);
  } else {
    selected = await window.dgfp.pickDirectory();
  }
  if (!selected) {
    return;
  }

  $(targetId).value = selected;
  if (targetId === "input-dir") {
    if (state.mainTab === "leie") {
      state.leieInspection = null;
      state.leieLastScannedInput = "";
    }
    if (state.mainTab === "leie" || isExcelPath(selected)) {
      await inspectLeieSourceFolder({ force: true });
    } else {
      await inspectSourceFolder();
    }
  }
  scheduleUiSettingsSave();
}

async function importUploadSource() {
  const sourcePath = await window.dgfp.pickFile([{ name: "Upload Config", extensions: ["ini", "json"] }]);
  if (!sourcePath) {
    return;
  }

  setBusy(true);
  setUploadReadyState("importing");
  setStatus("Importing", "Reading the selected upload configuration and preparing the available server accounts...");

  try {
    const result = await window.dgfp.importUploadSource(sourcePath);
    applyInfo(result.info);
    setUploadReadyState("ready");
    const summaryText = formatUploadProfileSummary(result.importResult?.profile_summary || result.info?.uploadProfileSummary);
    setStatus(
      "Configuration Ready",
      summaryText
        ? `Upload configuration imported successfully. ${summaryText} ready for use.`
        : "Upload configuration imported successfully."
    );
  } catch (error) {
    setUploadReadyState("failed");
    setStatus("Failed", error.message);
  } finally {
    setBusy(false);
  }
}

async function exportDiagnostics() {
  const outputDir = await window.dgfp.pickDirectory();
  if (!outputDir) return;
  setBusy(true);
  setStatus("Preparing Diagnostics", "Collecting non-sensitive application details and writing the diagnostic report...");
  try {
    const result = await window.dgfp.exportDiagnostics(outputDir);
    setStatus("Completed", `${result.message} The report does not include credentials or source-file contents.`);
  } catch (error) {
    setStatus("Failed", error.message);
  } finally {
    setBusy(false);
  }
}

async function runProcess() {
  if (state.mainTab === "leie") {
    await runLeieProcess();
    return;
  }

  if (!(await validateCurrentForm())) {
    return;
  }
  if (!state.listDateTouched) {
    setDateParts(nowAsListDate());
  }
  await runJob("process", { ...sharedPayload(), inputDir: readValue("input-dir") }, "Processing");
}

async function runLeieProcess() {
  if (!(await validateCurrentForm())) {
    return;
  }

  const payload = {
    inputDir: readValue("input-dir"),
    outputDir: readValue("output-dir"),
    outputFileName: sanitizeLeieFileNameInput(readValue("replacement-code")),
    duplicateKey: "full-row",
    duplicateHandling: state.leieDuplicateHandling,
    upload: collectUploadSettings(),
  };

  if (!(await confirmPreRun("process-leie", payload))) return;

  setBusy(true, true);
  setStatus("Processing LEIE", "Loading the selected workbook, checking duplicate handling, and preparing the processed output...");
  try {
    const result = await window.dgfp.runJob("process-leie", payload);
    if (payload.upload.enabled && payload.upload.targets.length > 0) {
      setStatus(result.retryable ? "Upload Warning" : "Upload Complete", result.message || "LEIE upload completed.");
    } else {
      setStatus("Ready to Save", result.message || "LEIE file saved.");
    }
    if (result.outputDir || result.archivePath || result.manifestPath) showResultActions(result.run || result);
  } catch (error) {
    setStatus("Failed", error.message);
  } finally {
    setBusy(false);
  }
}

function nowAsListDate() {
  const now = new Date();
  const parts = [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `${parts[0]}-${parts[1]}-${parts[2]} ${parts[3]}:${parts[4]}:${parts[5]}`;
}

async function runGenerate() {
  if (!(await validateCurrentForm())) {
    return;
  }
  if (!state.listDateTouched) {
    setDateParts(nowAsListDate());
  }
  const payload = {
    ...sharedPayload(),
    fileCount: Number(readValue("file-count")),
    referralsPerFile: Number(readValue("referrals-per-file")),
  };
  await runJob("generate", payload, "Generating");
}

async function runJob(command, payload, label) {
  if (!(await confirmPreRun(command, payload))) {
    setStatus("Ready", "The run was not started. Review or change the settings when ready.");
    return;
  }
  setBusy(true, true);
  setStatus(
    label,
    command === "generate"
      ? `Creating ${Number(payload.fileCount || 0).toLocaleString()} JSON file${Number(payload.fileCount || 0) === 1 ? "" : "s"} with ${Number(payload.referralsPerFile || 0).toLocaleString()} referral${Number(payload.referralsPerFile || 0) === 1 ? "" : "s"} per file...`
      : "Reading the Referral Files, applying the selected changes, and preparing the final archive..."
  );

  try {
    const result = await window.dgfp.runJob(command, payload);
    setStatus(result.retryable ? "Upload Warning" : "Completed", result.message || `${label} completed.`);
    const run = { ...(result.run || {}), archivePath: result.archivePath, manifestPath: result.manifestPath, outputDir: result.outputDir, retryable: result.retryable };
    showResultActions(run);
  } catch (error) {
    setStatus("Failed", error.message);
  } finally {
    setBusy(false);
    resumeLiveListDate(true);
  }
}

async function retryFailedUploads() {
  if (!state.lastRun?.runId) return;
  setBusy(true, true);
  state.currentPhase = "upload";
  setStatus("Retrying Uploads", "Using the existing archive to retry only the failed destinations...");
  try {
    const result = await window.dgfp.runJob("retry-upload", { runId: state.lastRun.runId });
    const run = { ...(result.run || state.lastRun), archivePath: result.archivePath, manifestPath: result.manifestPath, outputDir: result.outputDir, retryable: result.retryable };
    showResultActions(run);
    setStatus(result.retryable ? "Upload Warning" : "Upload Complete", result.message);
  } catch (error) {
    setStatus("Failed", error.message);
  } finally {
    setBusy(false);
    state.currentPhase = "idle";
  }
}

function wireCarePackageSelector(config) {
  const refresh = () => {
    renderSelectedCarePackages(config);
    renderCarePackageMenu(config);
    schedulePreviewUpdate();
    scheduleUiSettingsSave();
  };
  config.input.addEventListener("input", () => {
    renderCarePackageMenu(config);
    setCarePackageMenuOpen(config, true);
  });
  config.input.addEventListener("focus", () => {
    renderCarePackageMenu(config);
    setCarePackageMenuOpen(config, true);
  });
  config.input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setCarePackageMenuOpen(config, false);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      renderCarePackageMenu(config);
      setCarePackageMenuOpen(config, true);
    }
  });
  config.input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!config.combobox.contains(document.activeElement)) setCarePackageMenuOpen(config, false);
    }, 120);
  });
  config.toggle.addEventListener("click", () => {
    renderCarePackageMenu(config);
    setCarePackageMenuOpen(config, !config.combobox.classList.contains("is-open"));
    config.input.focus();
  });
  config.menu.addEventListener("click", (event) => {
    const selectorKey = event.target.closest("[data-care-package-selector-key]")?.dataset.carePackageSelectorKey;
    if (!selectorKey) return;
    config.useAll.checked = false;
    state[config.selectedKey] = state[config.selectedKey].includes(selectorKey)
      ? state[config.selectedKey].filter((value) => value !== selectorKey)
      : [...state[config.selectedKey], selectorKey];
    config.input.value = "";
    refresh();
    config.input.focus();
    setCarePackageMenuOpen(config, true);
  });
  config.selected.addEventListener("click", (event) => {
    const selectorKey = event.target.closest("[data-care-package-selector-key]")?.dataset.carePackageSelectorKey;
    if (!selectorKey) return;
    state[config.selectedKey] = state[config.selectedKey].filter((value) => value !== selectorKey);
    refresh();
  });
  config.useAll.addEventListener("change", refresh);
}

function setupEventHandlers() {
  $("use-current-referral-dates").addEventListener("change", () => {
    applyGeneratorDefaults(); schedulePreviewUpdate(); scheduleUiSettingsSave();
  });
  $("keep-master-json").addEventListener("change", scheduleUiSettingsSave);
  setupTabs();
  wireDateControls();
  elements.cancelJob?.addEventListener("click", cancelActiveJob);
  elements.exportDiagnostics?.addEventListener("click", exportDiagnostics);
  elements.preRunCancel?.addEventListener("click", () => closePreRun(false));
  elements.preRunConfirm?.addEventListener("click", () => closePreRun(true));
  elements.prodConfirmInput?.addEventListener("input", () => {
    elements.preRunConfirm.disabled = elements.prodConfirmInput.value.trim().toUpperCase() !== "PROD";
  });
  elements.openOutputFolder?.addEventListener("click", () => state.lastRun?.outputDir && window.dgfp.openPath(state.lastRun.outputDir));
  elements.openBatchManifest?.addEventListener("click", async () => {
    if (!state.lastRun?.runId || state.busy) return;
    elements.openBatchManifest.disabled = true;
    try {
      const result = await window.dgfp.runJob("generate-manifest", { runId: state.lastRun.runId });
      showResultActions(result.run);
      setStatus("Manifest Generated", result.message);
    } catch (error) {
      setStatus("Manifest Not Generated", error.message);
    } finally {
      elements.openBatchManifest.disabled = !state.lastRun?.manifestData;
    }
  });
  elements.copyArchivePath?.addEventListener("click", () => {
    if (!state.lastRun?.archivePath) return;
    window.dgfp.copyText(state.lastRun.archivePath);
    setStatus("Copied", "The archive path was copied to the clipboard.");
  });
  elements.retryFailedUploads?.addEventListener("click", retryFailedUploads);
  for (const button of document.querySelectorAll("[data-theme]")) {
    button.addEventListener("click", () => {
      setTheme(button.dataset.theme);
      scheduleUiSettingsSave();
    });
  }

  for (const button of document.querySelectorAll("[data-pick]")) {
    button.addEventListener("click", () => pickDirectory(button.dataset.pick));
  }

  for (const id of [
    "output-dir",
    "replacement-code",
    "archive-basename",
    "archive-append-network",
    "archive-append-referral-date-time",
    "use-alt-filename-prefix",
    "archive-custom-text",
    "referral-code",
    "referral-prefix-standard",
    "referral-prefix-custom",
    "custom-referral-prefix",
    "patient-id-custom-value",
    "ssn-value",
    "match-suffix-length",
    "override-facility-id",
    "override-referral-period",
    "override-dob",
    "override-referral-category",
    "override-referral-date",
    "override-referral-date-time",
    "override-referral-expiration-date",
    "override-referral-last-update-date",
    "file-count",
    "referrals-per-file",
  ]) {
    $(id).addEventListener("input", () => {
      if (state.subTab === "generate" && referralDateFields[id]) $("use-current-referral-dates").checked = false;
      if (id === "override-referral-period") applyGeneratorDefaults();
      if (id === "replacement-code" && state.mainTab === "leie") {
        $(id).value = sanitizeLeieFileNameInput($(id).value);
      }
      if (id === "referral-code") {
        $(id).value = sanitizeReferralNumberInput($(id).value);
      }
      if (id.startsWith("referral-prefix-") || id === "custom-referral-prefix") {
        if (id === "custom-referral-prefix") {
          $(id).value = (String($(id).value || "").match(/[A-Za-z0-9_-]/g) || []).join("");
        }
        syncReferralPrefixState();
      }
      if (id === "patient-id-custom-value") {
        $(id).value = sanitizePatientIdInput($(id).value);
      }
      if (id === "override-facility-id") {
        scheduleFacilityOptionsRender();
        setFacilityMenuOpen(true);
      }
      if (id === "override-payment-authority-code") {
        const input = $(id);
        input.value = sanitizePaymentAuthorityCodeInput(input.value, input.dataset.lastValidValue || "");
        input.dataset.lastValidValue = input.value;
      }
      if (id === "file-count" || id === "referrals-per-file") {
        updateTemplateSummary();
      }
      schedulePreviewUpdate();
      scheduleUiSettingsSave();
    });
  }

  elements.leieActionAuto.addEventListener("change", () => {
    if (elements.leieActionAuto.checked) {
      state.leieDuplicateHandling = "auto-remove";
      syncLeieUiState();
      scheduleUiSettingsSave();
    }
  });
  elements.leieActionManual.addEventListener("change", () => {
    if (elements.leieActionManual.checked) {
      state.leieDuplicateHandling = "manual";
      syncLeieUiState();
      scheduleUiSettingsSave();
    }
  });
  elements.leieRescan.addEventListener("click", async () => {
    await inspectLeieSourceFolder({ force: true });
    scheduleUiSettingsSave();
  });
  elements.leieCancelProcess.addEventListener("click", () => {
    $("input-dir").value = "";
    state.leieInspection = null;
    syncLeieUiState();
    inspectSourceFolder();
    scheduleUiSettingsSave();
  });

  elements.overrideFacilityId.addEventListener("focus", () => {
    scheduleFacilityOptionsRender();
    setFacilityMenuOpen(true);
  });
  elements.overrideFacilityId.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setFacilityMenuOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      scheduleFacilityOptionsRender();
      setFacilityMenuOpen(true);
    }
  });
  elements.overrideFacilityId.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!elements.facilityIdCombobox.contains(document.activeElement)) {
        setFacilityMenuOpen(false);
      }
    }, 120);
  });
  elements.facilityIdToggle.addEventListener("click", () => {
    scheduleFacilityOptionsRender();
    setFacilityMenuOpen(!elements.facilityIdCombobox.classList.contains("is-open"));
    elements.overrideFacilityId.focus();
  });
  elements.facilityIdMenu.addEventListener("click", (event) => {
    const facilityOption = event.target.closest("[data-facility-id]");
    const facilityId = facilityOption?.dataset.facilityId;
    if (!facilityId || facilityOption.disabled) return;
    $("randomize-facility-id").checked = false;
    if (state.selectedFacilityIds.includes(facilityId)) {
      state.selectedFacilityIds = state.selectedFacilityIds.filter((value) => value !== facilityId);
    } else {
      state.selectedFacilityIds.push(facilityId);
    }
    elements.overrideFacilityId.value = "";
    renderSelectedFacilities();
    scheduleFacilityOptionsRender();
    setFacilityMenuOpen(true);
    updateFacilityIdMatch();
    schedulePreviewUpdate();
    scheduleUiSettingsSave();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!elements.facilityIdCombobox.contains(event.target)) {
      setFacilityMenuOpen(false);
    }
    for (const config of [getCarePackageSelectorConfig(false), getCarePackageSelectorConfig(true), getCarePackageSelectorConfig("payment")]) {
      if (!config.combobox.contains(event.target)) setCarePackageMenuOpen(config, false);
    }
    if (!elements.networkCombobox.contains(event.target)) setNetworkMenuOpen(false);
  });
  wireCarePackageSelector(getCarePackageSelectorConfig("payment"));
  wireCarePackageSelector(getCarePackageSelectorConfig(false));
  wireCarePackageSelector(getCarePackageSelectorConfig(true));

  elements.networkSearch.addEventListener("input", () => {
    renderNetworkMenu();
    setNetworkMenuOpen(true);
  });
  elements.networkSearch.addEventListener("focus", () => {
    renderNetworkMenu();
    setNetworkMenuOpen(true);
  });
  elements.networkSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNetworkMenuOpen(false);
  });
  elements.networkToggle.addEventListener("click", () => {
    renderNetworkMenu();
    setNetworkMenuOpen(!elements.networkCombobox.classList.contains("is-open"));
    elements.networkSearch.focus();
  });
  elements.useAllNetworks.addEventListener("change", () => {
    if (elements.useAllNetworks.checked) setNetworkMenuOpen(false);
    renderNetworkSelection();
    updatePreviews();
    scheduleUiSettingsSave();
  });
  for (const id of ["randomize-ssn", "randomize-dob", "randomize-facility-id"]) {
    $(id).addEventListener("change", () => {
      if (id === "randomize-facility-id" && $(id).checked) { state.selectedFacilityIds = []; renderSelectedFacilities(); }
      syncIdentityControls();
      updateFacilityIdMatch();
      updatePreviews();
      scheduleUiSettingsSave();
    });
  }
  for (const input of document.querySelectorAll('input[name="archive-naming-mode"]')) {
    input.addEventListener("change", () => {
      syncArchiveNamingState();
      updatePreviews();
      scheduleUiSettingsSave();
    });
  }
  for (const input of document.querySelectorAll(".archive-custom-value")) {
    input.addEventListener("change", () => {
      syncArchiveNamingState();
      updatePreviews();
      scheduleUiSettingsSave();
    });
  }
  elements.archiveCustomSelectAll?.addEventListener("change", () => {
    for (const input of document.querySelectorAll(".archive-custom-value")) {
      input.checked = elements.archiveCustomSelectAll.checked;
    }
    syncArchiveNamingState();
    updatePreviews();
    scheduleUiSettingsSave();
  });
  for (const input of document.querySelectorAll('input[name="patient-id-mode"]')) {
    input.addEventListener("change", () => {
      syncPatientIdFieldState();
      updatePreviews();
      scheduleUiSettingsSave();
    });
  }
  elements.uploadEnabled.addEventListener("change", () => {
    syncUploadTargetState();
    updatePreviews();
    scheduleUiSettingsSave();
  });

  elements.inputDir.addEventListener("change", async () => {
    if (state.mainTab === "leie") {
      state.leieInspection = null;
      state.leieLastScannedInput = "";
    }
    if (state.mainTab === "leie" || isExcelPath(readValue("input-dir"))) {
      await inspectLeieSourceFolder();
    } else {
      await inspectSourceFolder();
    }
    scheduleUiSettingsSave();
  });
  elements.toggleOptionalFields.addEventListener("click", () => {
    toggleOptionalFields();
    scheduleUiSettingsSave();
  });
  elements.clearOutput.addEventListener("change", scheduleUiSettingsSave);
  elements.keepExistingFiles.addEventListener("change", scheduleUiSettingsSave);
  elements.keepProcessedJson.addEventListener("change", scheduleUiSettingsSave);
  elements.runProcess.addEventListener("click", runProcess);
  elements.runGenerate.addEventListener("click", runGenerate);
  elements.importUploadSource.addEventListener("click", importUploadSource);
  elements.openUserGuide.addEventListener("click", () => {
    if (state.info?.docs?.userGuidePath) {
      window.dgfp.openPath(state.info.docs.userGuidePath);
    }
  });
  elements.openLeieValidationGuide?.addEventListener("click", () => {
    if (state.info?.docs?.leieValidationGuidePath) {
      window.dgfp.openPath(state.info.docs.leieValidationGuidePath);
    }
  });
  elements.leieValidationBatchId?.addEventListener("input", () => {
    syncLeieValidationSql();
    scheduleUiSettingsSave();
  });
  elements.copyLeieValidationSql?.addEventListener("click", copyLeieValidationSql);
  elements.releaseAnnouncementAccept.addEventListener("click", acknowledgeReleaseAnnouncement);
  elements.releaseAnnouncementPanel.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  document.addEventListener("click", async (event) => {
    const target = event.target?.closest?.("a.external-link");
    if (!target) {
      return;
    }
    event.preventDefault();
    const href = String(target.getAttribute("href") || "").trim();
    if (!href) {
      return;
    }

    if (typeof window.dgfp.openExternal === "function") {
      await window.dgfp.openExternal(href);
      return;
    }

    window.open(href, "_blank", "noopener");
  });

  window.dgfp.onBackendEvent((event) => {
    if (event.type !== "progress") {
      return;
    }
    state.currentPhase = event.phase || state.currentPhase || "processing";
    setJobProgress(event.phase === "upload" && event.state === "uploading" ? 0 : event.current, event.phase === "upload" && event.state === "uploading" ? 0 : event.total);

    if (event.state === "preflight-complete") {
      setStatus("Preflight Complete", event.message || "The source, output, and business settings passed validation.");
      return;
    }

    if (event.state === "file-loaded") {
      setStatus("Validating LEIE", `${event.filename} loaded. Step 1 of 3 is complete; checking duplicate handling next.`);
      return;
    }

    if (event.state === "duplicates-found") {
      setStatus("Duplicates Found", "Duplicate rows were detected. Choose automatic removal or resolve them manually before saving.");
      return;
    }

    if (event.state === "ready-to-save") {
      setStatus("Ready to Save", `${event.filename} was processed successfully and is ready in the selected output folder.`);
      return;
    }

    if (event.state === "upload-complete") {
      setStatus("Upload Complete", `${event.filename} reached every selected server.`);
      return;
    }

    if (event.state === "upload-batch-start") {
      setStatus(
        "Starting Uploads",
        event.message || `Uploading to ${event.total} selected environment${event.total === 1 ? "" : "s"}, one at a time.`
      );
      return;
    }

    if (event.state === "upload-batch-warning") {
      setStatus("Upload Warning", "All selected servers have responded. Your local file is safe; review the failed server messages and use Retry Failed Uploads when ready.");
      return;
    }

    const uploadRow = [...document.querySelectorAll(".upload-target")]
      .find((row) => row.dataset.target === event.uploadTarget);

    if (event.state === "upload-target-complete") {
      setUploadTargetStatus(uploadRow, `Upload complete — ${event.current} of ${event.total} servers finished.`, "success");
      const remaining = Math.max(event.total - event.current, 0);
      setStatus("Upload Verified", `${event.uploadTarget} is complete and verified. ${remaining ? `${remaining} selected server${remaining === 1 ? " is" : "s are"} still working.` : "All selected servers have finished."}`);
      return;
    }

    if (event.state === "upload-target-error") {
      setUploadTargetStatus(uploadRow, `Needs attention: ${event.detail || "The server did not complete the upload."}`, "error");
      const remaining = Math.max(event.total - event.current, 0);
      setStatus("Upload Warning", `${event.uploadTarget} did not complete: ${event.detail || "No additional details were returned."} Your local file is safe.${remaining ? ` ${remaining} remaining server${remaining === 1 ? " will be tried" : "s will be tried"} in order.` : " You can retry only the failed server."}`);
      return;
    }

    if (event.state === "uploading") {
      setUploadTargetStatus(uploadRow, `Uploading and verifying ${event.filename}...`, "working");
      setStatus("Uploading", `${event.uploadTarget} started. ${event.current} of ${event.total} selected servers have finished; uploads run one at a time. Keep the app open.`);
      return;
    }

    if (event.state === "packaging") {
      setJobProgress(0, 0);
      setStatus("Packaging", "All Referral Files were processed. Creating the final timestamped gzip archive...");
      return;
    }

    if (event.state === "archive-created") {
      setStatus("Archive Ready", `${event.filename} was created successfully. Finishing cleanup${state.busy ? " and any selected uploads" : ""}...`);
      return;
    }

    if (event.state === "processing") {
      setStatus("Processing LEIE", "Step 2 of 3: removing approved duplicates and writing the processed workbook...");
      return;
    }

    if (event.state === "processed") {
      setStatus("Processing", `Processed ${event.filename} — ${event.current} of ${event.total} files complete.`);
      return;
    }

    if (event.state === "error") {
      setStatus("Batch Stopped", `Could not process ${event.filename}: ${event.detail || "validation failed"}. No incomplete archive will be uploaded.`);
      return;
    }

    setStatus("Working", `Handling ${event.filename} — ${event.current} of ${event.total} complete.`);
  });
}

function cacheElements() {
  Object.assign(elements, {
    appVersionBadge: $("app-version-badge"),
    exportDiagnostics: $("export-diagnostics"),
    archivePreview: $("archive-preview"),
    archiveNameHelp: $("archive-name-help"),
    clearOutput: $("clear-output"),
    generatorCard: $("generator-card"),
    generatorFileCountDisplay: $("generator-file-count-display"),
    generatorReferralsPerFileDisplay: $("generator-referrals-per-file-display"),
    generatorTotalReferralsDisplay: $("generator-total-referrals-display"),
    fileCount: $("file-count"),
    futureCard: $("future-card"),
    heroSubtitle: $("hero-subtitle"),
    heroTitle: $("hero-title"),
    importUploadSource: $("import-upload-source"),
    inputDir: $("input-dir"),
    patientIdCustomValue: $("patient-id-custom-value"),
    patientIdPreview: $("patient-id-preview"),
    keepExistingFiles: $("keep-existing-files"),
    keepProcessedJson: $("keep-processed-json"),
    listDateSourceValue: $("list-date-source-value"),
    mainTabCopy: $("main-tab-copy"),
    openUserGuide: $("open-user-guide"),
    optionalFields: $("optional-fields"),
    outputJsonPreview: $("output-json-preview"),
    outputHelp: $("output-help"),
    leieOutputHelp: $("leie-output-help"),
    outputNameHelp: $("output-name-help"),
    outputNameLabel: $("output-name-label"),
    replacementCode: $("replacement-code"),
    outputDir: $("output-dir"),
    outputDirHelp: $("output-dir-help"),
    outputSubtitle: $("output-subtitle"),
    overrideDob: $("override-dob"),
    carePackageCombobox: $("care-package-combobox"),
    carePackageSearch: $("care-package-search"),
    carePackageToggle: $("care-package-toggle"),
    carePackageMenu: $("care-package-menu"),
    paymentCodeCombobox: $("payment-code-combobox"),
    paymentCodeToggle: $("payment-code-toggle"),
    paymentCodeMenu: $("payment-code-menu"),
    paymentCodeMatch: $("payment-code-match"),
    selectedPaymentCodes: $("selected-payment-codes"),
    useAllPaymentCodes: $("use-all-payment-codes"),
    selectedCarePackages: $("selected-care-packages"),
    carePackageMatch: $("care-package-match"),
    useAllCarePackages: $("use-all-care-packages"),
    situationalCarePackageCombobox: $("situational-care-package-combobox"),
    situationalCarePackageSearch: $("situational-care-package-search"),
    situationalCarePackageToggle: $("situational-care-package-toggle"),
    situationalCarePackageMenu: $("situational-care-package-menu"),
    selectedSituationalCarePackages: $("selected-situational-care-packages"),
    situationalCarePackageMatch: $("situational-care-package-match"),
    useAllSituationalCarePackages: $("use-all-situational-care-packages"),
    carePackageOverrideWarning: $("care-package-override-warning"),
    networkCombobox: $("network-combobox"),
    networkSearch: $("network-search"),
    networkToggle: $("network-toggle"),
    networkMenu: $("network-menu"),
    networkMatch: $("network-match"),
    selectedNetworks: $("selected-networks"),
    useAllNetworks: $("use-all-networks"),
    overrideReferralCategory: $("override-referral-category"),
    overrideReferralDate: $("override-referral-date"),
    overrideReferralDateTime: $("override-referral-date-time"),
    overrideReferralExpirationDate: $("override-referral-expiration-date"),
    overrideReferralLastUpdateDate: $("override-referral-last-update-date"),
    overrideReferralPeriod: $("override-referral-period"),
    overrideFacilityId: $("override-facility-id"),
    ssnHelp: $("ssn-help"),
    fileCountHelp: $("file-count-help"),
    referralsPerFileHelp: $("referrals-per-file-help"),
    dobHelp: $("dob-help"),
    referralDateHelp: $("referral-date-help"),
    referralDateTimeHelp: $("referral-date-time-help"),
    referralExpirationDateHelp: $("referral-expiration-date-help"),
    referralLastUpdateDateHelp: $("referral-last-update-date-help"),
    paymentAuthorityCodePreview: $("payment-authority-code-preview"),
    referralCode: $("referral-code"),
    customReferralPrefix: $("custom-referral-prefix"),
    customReferralPrefixRow: $("custom-referral-prefix-row"),
    referralPrefixHelp: $("referral-prefix-help"),
    referralPreview: $("referral-preview"),
    referralDetailsCard: $("referral-details-card"),
    referralsPerFile: $("referrals-per-file"),
    runCard: $("run-card"),
    runGenerate: $("run-generate"),
    runProcess: $("run-process"),
    cancelJob: $("cancel-job"),
    jobProgress: $("job-progress"),
    jobProgressWrap: $("job-progress-wrap"),
    jobProgressLabel: $("job-progress-label"),
    jobProgressValue: $("job-progress-value"),
    resultActions: $("result-actions"),
    openOutputFolder: $("open-output-folder"),
    openBatchManifest: $("open-batch-manifest"),
    copyArchivePath: $("copy-archive-path"),
    retryFailedUploads: $("retry-failed-uploads"),
    sourceCard: $("source-card"),
    sourceFileCount: $("source-file-count"),
    sourceSubtitle: $("source-subtitle"),
    sourceTitle: $("source-title"),
    facilityIdPreview: $("facility-id-preview"),
    facilityIdCombobox: $("facility-id-combobox"),
    facilityIdMatch: $("facility-id-match"),
    facilityIdMenu: $("facility-id-menu"),
    selectedFacilities: $("selected-facilities"),
    facilityIdToggle: $("facility-id-toggle"),
    statusBadge: $("status-badge"),
    statusMessage: $("status-message"),
    subtabRow: $("subtab-row"),
    templateSummaryPill: $("template-summary-pill"),
    leieActionAuto: $("leie-action-auto"),
    leieActionHelp: $("leie-action-help"),
    leieActionManual: $("leie-action-manual"),
    leieCancelProcess: $("leie-cancel-process"),
    leieDuplicateActions: $("leie-duplicate-actions"),
    leieDuplicateCard: $("leie-duplicate-card"),
    leieDuplicateResult: $("leie-duplicate-result"),
    leieDuplicateSummary: $("leie-duplicate-summary"),
    leieDuplicateTableBody: $("leie-duplicate-table-body"),
    leieDuplicateTableWrap: $("leie-duplicate-table-wrap"),
    leieRescan: $("leie-rescan"),
    toggleOptionalFields: $("toggle-optional-fields"),
    uploadEnabled: $("upload-enabled"),
    uploadEnabledLabel: $("upload-enabled-label"),
    uploadCard: $("upload-card"),
    uploadSubtitle: $("upload-subtitle"),
    uploadReadyPill: $("upload-ready-pill"),
    uploadTargets: $("upload-targets"),
    workflowCard: $("workflow-card"),
    workflowSubtitle: $("workflow-subtitle"),
    workflowTitle: $("workflow-title"),
    outputCard: $("output-card"),
    archiveNamingCard: document.querySelector(".archive-naming-card"),
    archiveCustomFields: $("archive-custom-fields"),
    archiveCustomSelectAll: $("archive-custom-select-all"),
    archiveCustomText: $("archive-custom-text"),
    outputRetentionCard: $("output-retention-card"),
    releaseAnnouncementAccept: $("release-announcement-accept"),
    releaseAnnouncementList: $("release-announcement-list"),
    releaseAnnouncementOverlay: $("release-announcement-overlay"),
    releaseAnnouncementPanel: $("release-announcement-panel"),
    releaseAnnouncementTitle: $("release-announcement-title"),
    releaseAnnouncementVersion: $("release-announcement-version"),
    openLeieValidationGuide: $("open-leie-validation-guide"),
    leieGuideBanner: $("leie-guide-banner"),
    leieUploadValidationCard: $("leie-upload-validation-card"),
    leieValidationBatchId: $("leie-validation-batch-id"),
    leieValidationSql: $("leie-validation-sql"),
    copyLeieValidationSql: $("copy-leie-validation-sql"),
    leieValidationCopyStatus: $("leie-validation-copy-status"),
    preRunOverlay: $("pre-run-overlay"),
    preRunPanel: $("pre-run-panel"),
    preRunSummary: $("pre-run-summary"),
    preRunCancel: $("pre-run-cancel"),
    preRunConfirm: $("pre-run-confirm"),
    prodConfirmWrap: $("prod-confirm-wrap"),
    prodConfirmInput: $("prod-confirm-input"),
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  captureStaticHelperDefaults();
  setTheme("light");
  startLiveListDateClock();
  syncPatientIdFieldState();
  syncArchiveNamingState();
  setupEventHandlers();
  syncWorkflowText();
  try {
    await refreshInfo();
    await applyUiSettings(state.info?.uiSettings || {});
  } finally {
    syncReleaseAnnouncement();
    syncPatientIdFieldState();
  }
});
