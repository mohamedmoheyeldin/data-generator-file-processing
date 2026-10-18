const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function assertControlSystem(window) {
  const audit = await window.evaluate(() => {
    function isVisible(element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }

    const expectedHeight = Number.parseFloat(
      window.getComputedStyle(document.documentElement).getPropertyValue("--control-height")
    );
    const standardControls = [...document.querySelectorAll(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), .combo-shell'
    )].filter((element) =>
      isVisible(element) &&
      !element.classList.contains("clipboard-copy-field") &&
      !(element.matches("input") && element.closest(".combo-shell"))
    );
    const nonStandardControls = standardControls
      .map((element) => ({
        id: element.id || element.className || element.tagName,
        height: Number(element.getBoundingClientRect().height.toFixed(1)),
      }))
      .filter((item) => Math.abs(item.height - expectedHeight) > 0.5);

    const undersizedTargets = [...document.querySelectorAll("button, label.radio-chip, label.checkbox-chip")]
      .filter(isVisible)
      .map((element) => ({
        id: element.id || element.className || element.textContent.trim().slice(0, 40),
        height: Number(element.getBoundingClientRect().height.toFixed(1)),
      }))
      .filter((item) => item.height < 44);

    const unnamedControls = [...document.querySelectorAll("input, select, textarea, button")]
      .filter((element) => isVisible(element) && !element.disabled)
      .filter((element) => {
        const hasLabel = Boolean(element.labels?.length);
        const hasName = Boolean(
          element.getAttribute("aria-label") ||
          element.getAttribute("aria-labelledby") ||
          element.textContent.trim() ||
          element.title
        );
        return !hasLabel && !hasName;
      })
      .map((element) => element.id || element.className || element.tagName);

    const uploadPairs = [...document.querySelectorAll(".upload-target-grid")]
      .filter(isVisible)
      .map((grid) => {
        const userControl = grid.querySelector(".compact-select");
        const pathControl = grid.querySelector(".upload-path");
        return {
          userWidth: Number(userControl?.getBoundingClientRect().width.toFixed(1) || 0),
          pathWidth: Number(pathControl?.getBoundingClientRect().width.toFixed(1) || 0),
          userTop: Number(userControl?.getBoundingClientRect().top.toFixed(1) || 0),
          pathTop: Number(pathControl?.getBoundingClientRect().top.toFixed(1) || 0),
        };
      });

    return { expectedHeight, nonStandardControls, undersizedTargets, unnamedControls, uploadPairs };
  });

  assert.equal(audit.expectedHeight, 48);
  assert.deepEqual(audit.nonStandardControls, []);
  assert.deepEqual(audit.undersizedTargets, []);
  assert.deepEqual(audit.unnamedControls, []);
  for (const pair of audit.uploadPairs) {
    assert.equal(pair.userWidth < pair.pathWidth, true);
    assert.equal(pair.pathWidth / pair.userWidth >= 1.45 && pair.pathWidth / pair.userWidth <= 1.55, true);
    assert.equal(Math.abs(pair.userTop - pair.pathTop) <= 0.5, true);
  }
}

async function run() {
  const projectRoot = path.resolve(__dirname, "..");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-e2e-output-"));
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dgfp-e2e-user-"));
  fs.mkdirSync(path.join(userDataRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, "config", "ui_settings.json"), JSON.stringify({
    selectedCarePackageKeys: ["missing::value"],
    selectedSituationalCarePackageKeys: ["missing::value"],
  }));
  const electronApp = await electron.launch({
    executablePath: require("electron"),
    args: [projectRoot],
    env: { ...process.env, DGFP_USER_DATA_ROOT: userDataRoot },
  });

  try {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.locator("#status-message").waitFor({ state: "visible" });
    const releaseButton = window.locator("#release-announcement-accept");
    if (await releaseButton.isVisible()) {
      await window.setViewportSize({ width: 800, height: 600 });
      for (const zoom of [1.5, 2, 3]) {
        await electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom);
        await releaseButton.scrollIntoViewIfNeeded();
        assert.ok(await releaseButton.evaluate((element) => {
          const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight;
        }), `Release button reachable at ${zoom * 100}%`);
      }
      await releaseButton.click();
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
      await window.setViewportSize({ width: 1280, height: 900 });
    }
    assert.match(await window.title(), /Data Generator & File Processing/);
    assert.equal(await window.locator("#workflow-stepper").isVisible(), true);
    assert.equal(await window.locator("#run-process").isVisible(), true);
    assert.equal(await window.locator("#cancel-job").isHidden(), true);
    assert.equal(await window.locator("#status-badge").textContent(), "Ready");
    assert.equal(await window.locator("#job-progress-wrap").isHidden(), true);
    assert.equal(await window.locator("#pre-run-overlay").isHidden(), true);
    assert.equal(await window.locator(".context-help").count(), 5);
    assert.equal(await window.locator(".context-help[open]").count(), 0);
    assert.equal(await window.locator("#output-help").isVisible(), true);
    assert.equal(await window.locator("#leie-output-help").isHidden(), true);
    assert.equal(await window.locator("#workflow-help summary").textContent(), "New here? See how the five steps work");
    await window.locator("#workflow-help summary").click();
    assert.equal(await window.locator("#workflow-help").getAttribute("open"), "");
    assert.equal(await window.locator("#workflow-help .context-help-grid > div").count(), 5);
    assert.match(await window.locator("#workflow-help").textContent(), /Source files are never edited/);
    assert.equal(await window.locator("#input-dir").getAttribute("aria-describedby"), "source-folder-help");
    assert.match(await window.locator("#source-folder-help").textContent(), /never changes the originals/);
    assert.equal(await window.locator(".helper-text.live-preview").count(), 5);
    if (process.env.DGFP_E2E_HELP_SCREENSHOT) {
      await window.locator("#workflow-help").scrollIntoViewIfNeeded();
      await window.screenshot({ path: process.env.DGFP_E2E_HELP_SCREENSHOT, fullPage: false });
    }
    assert.equal(await window.locator("#generation-preset").count(), 0);
    assert.equal(await window.locator("#generation-preset-name").count(), 0);
    assert.equal(await window.locator("#recent-runs").count(), 0);
    assert.equal(await window.locator('input[name="referral-prefix-mode"]').count(), 2);
    assert.equal(await window.locator('input[name="patient-id-mode"]').count(), 3);
    assert.equal(await window.locator('input[name="archive-naming-mode"]').count(), 4);
    assert.equal(await window.locator('input[name="archive-naming-mode"][value="prefix"]').count(), 0);
    assert.equal(await window.locator("#referral-prefix-standard").isChecked(), true);
    assert.equal(await window.locator("#custom-referral-prefix-row").isHidden(), true);
    assert.equal(await window.locator("#selected-care-packages .selected-facility-chip").count(), 0);
    assert.equal(await window.locator("#selected-situational-care-packages .selected-facility-chip").count(), 0);
    assert.equal(await window.locator("meta[http-equiv='Content-Security-Policy']").count(), 1);
    const nativeSelectCount = await window.locator("select:not([multiple])").count();
    assert.equal(await window.locator(".compact-select").count(), nativeSelectCount);
    await window.locator("[data-sub-tab='generate']").click();
    await window.locator("#referral-prefix-standard").check();
    assert.match(await window.locator("#referral-prefix-help").textContent(), /RF will be added automatically/);
    await window.locator("#referral-code").fill("DD");
    await window.waitForFunction(() => document.querySelector("#referral-preview")?.textContent.includes("RFDD"));
    assert.match(await window.locator("#referral-preview").textContent(), /Preview: RFDD/);
    await window.locator("#referral-prefix-custom").check();
    assert.equal(await window.locator("#custom-referral-prefix-row").isVisible(), true);
    assert.equal(await window.locator("#custom-referral-prefix").getAttribute("maxlength"), null);
    await window.locator("#custom-referral-prefix").fill("CUSTOM_PREFIX_WITHOUT_A_LIMIT_");
    await window.locator("#referral-code").fill("12345678901234567890");
    await window.waitForFunction(() => document.querySelector("#referral-preview")?.textContent.includes("CUSTOM_PREFIX_WITHOUT_A_LIMIT_12345678901234567890"));
    assert.match(await window.locator("#referral-preview").textContent(), /CUSTOM_PREFIX_WITHOUT_A_LIMIT_12345678901234567890/);
    await window.locator("#custom-referral-prefix").fill("Dgfp-Test_");
    await window.locator("#referral-code").fill("abC-001_Test");
    await window.locator("#referral-preview").waitFor({ state: "visible" });
    await window.waitForFunction(() => document.querySelector("#referral-preview")?.textContent.includes("Dgfp-Test_abC-001_Test"));
    assert.match(await window.locator("#referral-preview").textContent(), /Dgfp-Test_abC-001_Test/);
    await window.locator("#custom-referral-prefix").fill("DGFP");
    await window.locator("#referral-code").fill("26S600001");
    await window.locator("#referral-prefix-standard").check();
    assert.equal(await window.locator("#keep-existing-files").isChecked(), true);
    assert.match(await window.locator("#output-retention-card").textContent(), /Recommended/);
    assert.match(await window.locator("#output-retention-card").textContent(), /Replace folder contents after success/);
    await window.locator("#toggle-optional-fields").click();
    assert.equal(await window.locator("#use-current-referral-dates").isChecked(), true);
    const today = await window.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; });
    assert.equal(await window.locator("#override-referral-date").inputValue(), today);
    await window.locator("#override-referral-date").fill("2024-02-25");
    assert.equal(await window.locator("#use-current-referral-dates").isChecked(), false);
    await window.locator("#use-current-referral-dates").check();
    assert.equal(await window.locator("#override-referral-date").inputValue(), today);
    await window.locator("#override-payment-authority-code").focus();
    assert.equal(await window.locator("#payment-code-menu .combo-option").count(), 43);
    await window.locator('#payment-code-menu [data-care-package-selector-key="21"]').click();
    await window.locator('#payment-code-menu [data-care-package-selector-key="28"]').click();
    assert.equal(await window.locator("#selected-payment-codes .selected-facility-chip").count(), 2);
    assert.equal(await window.locator("#use-all-payment-codes").isChecked(), false);
    await window.locator("#override-payment-authority-code").press("Escape");
    await window.locator("#use-all-payment-codes").check();
    assert.equal(await window.locator("#selected-payment-codes .selected-facility-chip").count(), 0);
    await window.locator("#override-payment-authority-code").fill("21");
    assert.equal(await window.locator("#payment-code-menu .combo-option").count(), 1);
    await window.locator('#payment-code-menu [data-care-package-selector-key="21"]').click();
    assert.equal(await window.locator("#use-all-payment-codes").isChecked(), false);
    await window.locator("#override-payment-authority-code").press("Escape");
    await window.waitForFunction(async () => {
      const info = await window.dgfp.getInfo();
      return info.uiSettings.selectedPaymentCodes?.join(",") === "21" && info.uiSettings.useAllPaymentCodes === false;
    });
    if (process.env.DGFP_E2E_PAYMENT_SCREENSHOT) {
      await window.locator("#payment-code-combobox").scrollIntoViewIfNeeded();
      await window.locator("#override-payment-authority-code").fill("2");
      await window.locator("#payment-code-combobox").evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
      await window.waitForTimeout(300);
      await window.screenshot({ path: process.env.DGFP_E2E_PAYMENT_SCREENSHOT });
      await window.locator("#override-payment-authority-code").press("Escape");
    }
    await window.locator("#referral-prefix-custom").check();
    await window.locator("#patient-id-mode-custom-full").check();
    await window.locator("#patient-id-custom-value").fill("aBc123");
    assert.equal(await window.locator("#patient-id-custom-value").inputValue(), "aBc123");
    await window.waitForFunction(() => document.querySelector("#patient-id-preview")?.textContent.includes("aBc123"));
    await window.locator("#patient-id-mode-referral-match").check();
    const optionCardSystem = await window.evaluate(() => {
      const metrics = (selector) => {
        const target = document.querySelector(selector);
        const card = target.matches(".choice-card") ? target : target.closest(".choice-card");
        const style = getComputedStyle(card);
        return {
          minHeight: style.minHeight,
          padding: style.padding,
          borderRadius: style.borderRadius,
          columns: getComputedStyle(card.closest(".choice-card-grid")).gridTemplateColumns.split(" ").length,
        };
      };
      return {
        referral: metrics(".referral-prefix-choices .choice-card"),
        patientId: metrics('input[name="patient-id-mode"]:checked'),
        archive: metrics(".archive-mode-choices .choice-card"),
      };
    });
    assert.deepEqual(optionCardSystem.referral, optionCardSystem.archive);
    assert.deepEqual(optionCardSystem.referral, optionCardSystem.patientId);
    assert.equal(optionCardSystem.referral.minHeight, "66px");
    assert.equal(optionCardSystem.referral.columns, 2);
    assert.equal(optionCardSystem.archive.columns, 2);
    assert.equal(optionCardSystem.patientId.columns, 2);
    if (process.env.DGFP_E2E_OPTION_CARD_SCREENSHOT) {
      await window.locator(".referral-prefix-choices").scrollIntoViewIfNeeded();
      await window.screenshot({ path: process.env.DGFP_E2E_OPTION_CARD_SCREENSHOT, fullPage: false });
    }
    await window.waitForFunction(() => document.querySelector("#patient-id-preview")?.textContent.includes("TEST000026S600001"));
    assert.equal(await window.locator("#patient-id-custom-value").isDisabled(), true);
    assert.match(await window.locator("#referral-preview").textContent(), /DGFP26S600001/);
    const matchTrigger = window.locator("#match-suffix-length").locator("..").locator(".compact-select-trigger");
    await matchTrigger.focus();
    await matchTrigger.press("ArrowDown");
    const matchMenu = window.locator("#match-suffix-length").locator("..").locator(".compact-select-menu");
    assert.equal(await matchMenu.isVisible(), true);
    assert.equal(await matchMenu.locator(".compact-select-option").count(), 3);
    assert.equal((await matchMenu.evaluate((element) => element.getBoundingClientRect().height)) <= 260, true);
    const fourCharacterOption = matchMenu.locator('.compact-select-option[data-value="4"]');
    await fourCharacterOption.focus();
    await fourCharacterOption.press("Enter");
    assert.equal(await window.locator("#match-suffix-length").inputValue(), "4");
    assert.equal(await window.locator("#facility-id-menu .combo-option").count(), 0);
    await window.locator("#override-facility-id").focus();
    await window.locator("#facility-id-menu .combo-option").first().waitFor({ state: "visible" });
    assert.equal(await window.locator("#facility-id-menu .combo-option").count(), 10);
    assert.match(await window.locator("#facility-id-menu .combo-result-summary").textContent(), /complete catalog/);
    await window.locator("#override-facility-id").fill("F102");
    await window.locator("#facility-id-toggle").click();
    assert.equal(await window.locator("#facility-id-menu .facility-option-field", { hasText: "facility_id: F102" }).count(), 1);
    assert.equal(await window.locator("#facility-id-menu .facility-option-field", { hasText: "facility_key: 1002" }).count(), 1);
    await window.locator("#facility-id-menu .combo-option", { hasText: "Riverbend Regional Medical Center" }).click();
    assert.equal(await window.locator("#override-facility-id").inputValue(), "");
    assert.equal(await window.locator("#selected-facilities .selected-facility-chip", { hasText: "F102" }).count(), 1);
    assert.equal((await window.locator("body").textContent()).includes("(Optional)"), false);
    const situationalColor = await window.locator(".situational-label").evaluate((element) => getComputedStyle(element).color);
    const normalLabelColor = await window.locator(".situational-label").locator("..").evaluate((element) => getComputedStyle(element).color);
    assert.notEqual(situationalColor, normalLabelColor);
    const carePackageBounds = await window.locator("#care-package-combobox").boundingBox();
    const situationalCarePackageBounds = await window.locator("#situational-care-package-combobox").boundingBox();
    assert.equal(Boolean(carePackageBounds && situationalCarePackageBounds), true);
    assert.equal(Math.abs(carePackageBounds.y - situationalCarePackageBounds.y) < 4, true);
    await window.locator("#override-facility-id").press("Escape");
    await window.locator("#care-package-combobox").scrollIntoViewIfNeeded();
    await window.locator("#care-package-search").fill("AUD_AUDIOLOGY_1.0.1");
    const requestedPrimaryCarePackage = window.locator("#care-package-menu .combo-option").first();
    await requestedPrimaryCarePackage.waitFor({ state: "visible" });
    assert.equal((await requestedPrimaryCarePackage.locator(".combo-option-title").textContent()).trim(), "AUD_AUDIOLOGY");
    assert.equal((await requestedPrimaryCarePackage.locator(".combo-option-copy").textContent()).trim(), "Care Package Number: 11");
    if (process.env.DGFP_E2E_PRIMARY_CARE_PACKAGE_SCREENSHOT) {
      await window.screenshot({ path: process.env.DGFP_E2E_PRIMARY_CARE_PACKAGE_SCREENSHOT, fullPage: false });
    }
    await window.locator("#care-package-search").press("Escape");
    await window.locator("#care-package-search").fill("MSC_INFERTILITY-IUI FEMALE");
    assert.equal(await window.locator("#care-package-menu .combo-option").count(), 0);
    assert.equal(await window.locator("#care-package-menu .combo-empty").textContent(), "No matching Care Package values.");
    await window.locator("#care-package-search").fill("PMR_ACUPUNCTURE INITIAL");
    const primaryCarePackage = window.locator("#care-package-menu .combo-option", { hasText: "PMR_ACUPUNCTURE INITIAL" }).first();
    await primaryCarePackage.waitFor({ state: "visible" });
    assert.equal((await primaryCarePackage.locator(".combo-option-title").textContent()).trim(), "PMR_ACUPUNCTURE INITIAL");
    assert.equal((await primaryCarePackage.locator(".combo-option-copy").textContent()).trim(), "Care Package Number: 1");
    await primaryCarePackage.click();
    assert.equal(await window.locator("#selected-care-packages .selected-facility-chip", { hasText: "PMR_ACUPUNCTURE INITIAL" }).count(), 1);
    assert.equal(await window.locator("#care-package-override-warning").isHidden(), true);
    await window.locator("#care-package-search").press("Escape");
    await window.locator("#selected-care-packages .selected-facility-chip", { hasText: "PMR_ACUPUNCTURE INITIAL" }).click();
    assert.equal(await window.locator("#selected-care-packages .selected-facility-chip").count(), 0);
    assert.equal(await window.locator("#care-package-override-warning").isHidden(), true);
    await window.locator("#care-package-search").fill("PMR_ACUPUNCTURE INITIAL");
    await window.locator("#care-package-menu .combo-option", { hasText: "PMR_ACUPUNCTURE INITIAL" }).first().click();
    await window.locator("#care-package-search").press("Escape");
    await window.locator("#situational-care-package-search").fill("AUD_AUDIOLOGY");
    assert.equal(await window.locator("#situational-care-package-menu .combo-option").count(), 0);
    await window.locator("#situational-care-package-search").fill("EUC_EMERGENCY CARE");
    const situationalCarePackage = window.locator("#situational-care-package-menu .combo-option", { hasText: "EUC_EMERGENCY CARE" }).first();
    await situationalCarePackage.waitFor({ state: "visible" });
    if (process.env.DGFP_E2E_SITUATIONAL_CARE_PACKAGE_SCREENSHOT) {
      await window.locator("#situational-care-package-combobox").scrollIntoViewIfNeeded();
      await window.screenshot({ path: process.env.DGFP_E2E_SITUATIONAL_CARE_PACKAGE_SCREENSHOT, fullPage: false });
    }
    assert.equal((await situationalCarePackage.locator(".combo-option-title").textContent()).trim(), "EUC_EMERGENCY CARE");
    assert.equal((await situationalCarePackage.locator(".combo-option-copy").textContent()).trim(), "Care Package Number: 158");
    await situationalCarePackage.click();
    assert.equal(await window.locator("#selected-situational-care-packages .selected-facility-chip", { hasText: "EUC_EMERGENCY CARE" }).count(), 1);
    assert.match(await window.locator("#care-package-override-warning").textContent(), /Most referrals use regular Care Package only/);
    await window.locator("#situational-care-package-search").press("Escape");
    await window.locator("#use-all-situational-care-packages").check();
    assert.equal(await window.locator("#situational-care-package-search").isDisabled(), false);
    assert.match(await window.locator("#situational-care-package-match").textContent(), /All 9 available Situational Care Package values/);
    await window.locator("#use-all-situational-care-packages").uncheck();
    await window.locator("#network-search").fill("NET1");
    await window.locator("#network-menu .combo-option", { hasText: "NET1" }).click();
    await window.locator('input[name="archive-naming-mode"][value="custom"]').check();
    assert.equal(await window.locator("#archive-custom-fields").isVisible(), true);
    assert.equal(await window.locator(".archive-custom-value").count(), 6);
    assert.equal(await window.locator(".archive-value-choice.choice-card.choice-card--compact").count(), 6);
    assert.match(
      await window.locator(".archive-values-help").textContent(),
      /\{referralNumber\}.*\{referralPrefix\}.*\{networkName\}.*\{date\}.*\{dateTime\}.*\{customText\}/
    );
    await window.locator("#archive-custom-text").fill("DGFP");
    await window.waitForFunction(() => document.querySelector("#archive-preview")?.textContent.includes("DGFP26S600001_DGFP_Final_Master.json"));
    await window.locator("#override-referral-date").fill("2019-03-17");
    await window.locator("#override-referral-date-time").fill("2019-01-02 11:47:32");
    await window.locator("#archive-custom-select-all").check();
    assert.equal(await window.locator(".archive-custom-value:checked").count(), 6);
    await window.waitForFunction(() => {
      const preview = document.querySelector("#archive-preview")?.textContent || "";
      return preview.includes("DGFP26S600001_DGFP_NET1_2019-03-17_2019-01-02_114732_DGFP_Final_Master.json") &&
        preview.includes(".gz");
    });
    assert.equal((await window.locator("#archive-preview").textContent()).includes("{"), false);
    if (process.env.DGFP_E2E_ARCHIVE_SCREENSHOT) {
      await window.locator(".archive-naming-card").scrollIntoViewIfNeeded();
      await window.screenshot({ path: process.env.DGFP_E2E_ARCHIVE_SCREENSHOT, fullPage: false });
    }
    await window.locator('[data-theme="dark"]').click();
    assert.equal(await window.locator("body").evaluate((element) => element.classList.contains("theme-dark")), true);
    await window.waitForTimeout(200);
    const darkCardColors = await window.evaluate(() => ({
      selected: getComputedStyle(document.querySelector('.archive-mode-choices .choice-card:has(input:checked)')).backgroundColor,
      unselected: getComputedStyle(document.querySelector('.archive-mode-choices .choice-card:not(:has(input:checked))')).backgroundColor,
    }));
    assert.notEqual(darkCardColors.selected, darkCardColors.unselected);
    const darkUnselectedChannels = darkCardColors.unselected.match(/[\d.]+/g).slice(0, 3).map(Number);
    assert.equal(
      darkUnselectedChannels.every((channel) => channel < 100),
      true,
      `Dark-theme unselected option cards should stay dark, received ${darkCardColors.unselected}`
    );
    if (process.env.DGFP_E2E_DARK_HELP_SCREENSHOT) {
      await window.locator("#output-help").evaluate((element) => { element.open = true; });
      await window.locator("#output-help").scrollIntoViewIfNeeded();
      await window.screenshot({ path: process.env.DGFP_E2E_DARK_HELP_SCREENSHOT, fullPage: false });
    }
    if (process.env.DGFP_E2E_DARK_OPTION_CARD_SCREENSHOT) {
      await window.locator(".archive-naming-card").scrollIntoViewIfNeeded();
      await window.screenshot({ path: process.env.DGFP_E2E_DARK_OPTION_CARD_SCREENSHOT, fullPage: false });
    }
    await window.locator('[data-theme="light"]').click();
    await window.locator("#archive-custom-select-all").uncheck();
    assert.equal(await window.locator(".archive-custom-value:checked").count(), 0);
    assert.equal(await window.locator("#archive-custom-text").isDisabled(), true);
    await window.locator("#archive-custom-value-referral-number").check();
    await window.locator("#archive-custom-value-date").check();
    await window.waitForFunction(() => document.querySelector("#archive-preview")?.textContent.includes("DGFP26S600001_2019-03-17_Final_Master.json"));
    await window.locator('input[name="archive-naming-mode"][value="referral-number"]').check();
    await window.waitForFunction(() => document.querySelector("#archive-preview")?.textContent.includes("DGFP26S600001_Final_Master.json"));
    await window.locator("#selected-networks .selected-facility-chip", { hasText: "NET1" }).click();
    await window.locator("#network-search").fill("NET2");
    await window.locator("#network-menu .combo-option", { hasText: "NET2" }).click();
    assert.match(await window.locator("#network-match").textContent(), /NET2 will be used for every referral/);
    await window.locator("#network-search").fill("NET4");
    await window.locator("#network-menu .combo-option", { hasText: "NET4" }).click();
    assert.match(await window.locator("#network-match").textContent(), /mixed from the 2 selected Networks/);
    await window.locator("#network-search").press("Escape");
    await window.locator("#selected-networks .selected-facility-chip", { hasText: "NET4" }).click();
    await window.locator('input[name="archive-naming-mode"][value="network"]').check();
    await window.waitForFunction(() => document.querySelector("#archive-preview")?.textContent.includes("NET2_DGFP26S600001_Final_Master.json"));
    const uploadDirectoryNote = window.locator(".upload-path-help").first();
    await uploadDirectoryNote.waitFor({ state: "visible" });
    assert.match(await uploadDirectoryNote.textContent(), /Referral uploads default to \/referral_uploads/);
    const referralTargets = await window.locator(".upload-target").evaluateAll((rows) => rows
      .filter((row) => window.getComputedStyle(row).display !== "none")
      .map((row) => row.dataset.target));
    assert.deepEqual(referralTargets, ["SQA", "DEV", "PPD"]);
    assert.equal(await window.locator('.upload-target[data-target="PROD"]').isHidden(), true);
    await assertControlSystem(window);
    await window.locator("[data-main-tab='leie']").click();
    assert.match(await uploadDirectoryNote.textContent(), /LEIE Data uploads default to \/in\/manual_process\//);
    assert.equal(await window.locator('.upload-target[data-target="PROD"]').isVisible(), true);
    const leieTargets = await window.locator(".upload-target").evaluateAll((rows) => rows
      .filter((row) => window.getComputedStyle(row).display !== "none")
      .map((row) => row.dataset.target));
    assert.deepEqual(leieTargets, ["SQA", "DEV", "PPD", "PROD"]);
    assert.equal(await window.locator("#output-help").isHidden(), true);
    assert.equal(await window.locator("#leie-output-help").isVisible(), true);
    assert.match(await window.locator("#leie-output-help").textContent(), /LEIE produces a processed \.xlsx file/);
    assert.match(await window.locator("#upload-help").textContent(), /Production is available only for LEIE/);
    await assertControlSystem(window);
    await window.locator("[data-main-tab='referral']").click();
    assert.equal(await window.locator("#output-help").isVisible(), true);
    assert.equal(await window.locator("#leie-output-help").isHidden(), true);
    await window.locator("#referral-prefix-standard").check();
    await window.locator("#referral-code").fill("26S6-00001_TEST");
    await window.waitForFunction(() => document.querySelector("#referral-preview")?.textContent.includes("RF26S6-00001_TEST"));
    await window.waitForFunction(() => document.querySelector("#patient-id-preview")?.textContent.includes("TEST26S600001TEST"));
    assert.match(await window.locator("#referral-prefix-help").textContent(), /hyphens \(-\).*underscores \(_\)/);
    await window.locator("#referral-code").fill("12345678901234567890");
    await window.locator("#patient-id-mode-referral-match").check();
    await window.waitForFunction(() => document.querySelector("#referral-preview")?.textContent.includes("RF12345678901234567890"));
    await window.waitForFunction(() => document.querySelector("#patient-id-preview")?.textContent.includes("TEST1234567890121"));
    assert.match(await window.locator("#referral-preview").textContent(), /Preview: RF12345678901234567890/);
    assert.match(await window.locator("#patient-id-preview").textContent(), /Preview: TEST1234567890121/);
    if (process.env.DGFP_E2E_SCREENSHOT) {
      await window.screenshot({ path: process.env.DGFP_E2E_SCREENSHOT, fullPage: true });
    }
    await window.setViewportSize({ width: 800, height: 700 });
    await window.locator("#output-help").evaluate((element) => { element.open = true; });
    const hasHorizontalOverflow = await window.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(hasHorizontalOverflow, false);
    assert.equal(
      await window.locator(".archive-mode-choices").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
      1
    );
    assert.equal(
      await window.locator("#output-help .context-help-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
      1
    );
    // Exercise the real review dialog at small sizes and high zoom without submitting it.
    await window.evaluate(() => { window.dgfpRunReview.confirm({ command: "generate", payload: { outputDir: "C:\\Example", fileCount: 3, referralsPerFile: 400 }, elements: {
        overlay: document.querySelector("#pre-run-overlay"), summary: document.querySelector("#pre-run-summary"),
        prodWrap: document.querySelector("#prod-confirm-wrap"), prodInput: document.querySelector("#prod-confirm-input"),
        confirmButton: document.querySelector("#pre-run-confirm") } }); });
    for (const zoom of [1.5, 2, 3]) {
      await electronApp.evaluate(({ BrowserWindow }, factor) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom);
      const confirm = window.locator("#pre-run-confirm");
      await confirm.scrollIntoViewIfNeeded();
      assert.ok(await confirm.evaluate((element) => {
        const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight;
      }), `Generate confirmation reachable at ${zoom * 100}%`);
    }
    await window.locator("#pre-run-cancel").click();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    const result = await window.evaluate(async (targetOutputDir) => window.dgfp.runJob("generate", {
      outputDir: targetOutputDir,
      replacementCode: "e2e_referral",
      archiveBasename: "e2e_archive",
      clearOutput: true,
      keepProcessedJson: true,
      fileCount: 2,
      referralsPerFile: 2,
      referralReplacementCode: "",
      patientIdSettings: { mode: "test-dynamic" },
      identityOptions: { randomizeSsn: true, randomizeDob: true, randomizeFacilityId: true, matchSuffixLength: 5 },
      optionalOverrides: {},
      upload: { enabled: false, targets: [] },
    }), outputDir);
    assert.match(result.message, /Completed safely\. Processed 2 files/);
    assert.match(await window.locator("#status-message").textContent(), /was created successfully/);
    assert.equal(await window.locator("#job-progress-wrap").isVisible(), true);
    assert.equal(await window.locator("#job-progress-value").textContent(), "100%");
    assert.equal(fs.readdirSync(outputDir).some((name) => /^e2e_archive_\d{8}_\d{6}\.gz$/.test(name)), true);
    const outputJsonPaths = fs.readdirSync(outputDir)
      .map((name) => path.join(outputDir, name))
      .filter((filePath) => filePath.toLowerCase().endsWith(".json") && !filePath.toLowerCase().endsWith(".manifest.json") && !filePath.endsWith("_Master.json"));
    assert.equal(outputJsonPaths.length, 2);
    assert.equal(fs.readdirSync(outputDir).some((name) => name.endsWith(".manifest.json")), false);
    await window.evaluate((run) => showResultActions(run), result.run);
    await window.locator("#open-batch-manifest").click();
    await window.waitForFunction(() => document.body.textContent.includes("Manifest generated in the output folder."));
    assert.equal(fs.readdirSync(outputDir).some((name) => name.endsWith(".manifest.json")), true);
    const generatedReferrals = outputJsonPaths.flatMap(
      (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")).referrals
    );
    const appInfo = await window.evaluate(() => window.dgfp.getInfo());
    const validFacilityIds = new Set(appInfo.facilities.map((facility) => facility.facility_id).filter(Boolean));
    const specialCarePackageKeys = new Set(["201", "202", "203"]);
    assert.equal(new Set(generatedReferrals.map((referral) => referral.patient.ssn)).size, 4);
    const facilityIds = generatedReferrals.map(
      (referral) => referral.facility?.facilityId || referral.facilityId
    );
    assert.equal(new Set(facilityIds).size, 4);
    for (const referral of generatedReferrals) {
      const facilityId = referral.facility?.facilityId || referral.facilityId;
      const carePackageKey = referral.referral?.carePackageKey || referral.carePackageKey;
      assert.match(referral.patient.ssn, /^999-\d{2}-\d{4}$/);
      assert.equal(validFacilityIds.has(facilityId), true);
      assert.equal(specialCarePackageKeys.has(String(carePackageKey)), false);
    }
    await window.reload();
    await window.waitForLoadState("domcontentloaded");
    await window.locator("#selected-payment-codes .selected-facility-chip").waitFor({ state: "attached" });
    assert.equal(await window.locator("#selected-payment-codes .selected-facility-chip").textContent(), "21 ×");
    assert.equal(await window.locator("#use-all-payment-codes").isChecked(), false);
  } finally {
    await electronApp.close();
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
}

run().then(
  () => console.log("Electron end-to-end smoke test passed."),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
