(function initializeCompactSelects() {
  const enhancedSelects = new WeakSet();
  const selectRecords = new Set();
  let selectSequence = 0;

  function selectedOption(select) {
    return select.options[select.selectedIndex] || select.options[0] || null;
  }

  function close(record) {
    record.wrapper.classList.remove("is-open");
    record.trigger.setAttribute("aria-expanded", "false");
    record.menu.classList.add("hidden");
  }

  function closeAll(except = null) {
    for (const record of selectRecords) {
      if (record !== except) close(record);
    }
  }

  function render(record) {
    const { select, wrapper, trigger, valueLabel, menu } = record;
    const current = selectedOption(select);
    valueLabel.textContent = current?.textContent?.trim() || "Select an option";
    trigger.disabled = select.disabled;
    wrapper.classList.toggle("is-disabled", select.disabled);
    wrapper.classList.toggle("is-invalid", select.classList.contains("is-invalid"));
    trigger.setAttribute("aria-invalid", String(select.classList.contains("is-invalid")));
    menu.innerHTML = "";

    for (const [index, option] of [...select.options].entries()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "combo-option compact-select-option";
      item.id = `${menu.id}-option-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option === current));
      item.disabled = option.disabled;
      item.dataset.value = option.value;
      item.textContent = option.textContent.trim();
      item.addEventListener("click", () => {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        refreshAll();
        close(record);
        trigger.focus();
      });
      menu.appendChild(item);
    }
  }

  function menuOptions(record) {
    return [...record.menu.querySelectorAll(".compact-select-option:not(:disabled)")];
  }

  function focusSelectedOption(record, fallbackIndex = 0) {
    const options = menuOptions(record);
    if (options.length === 0) return;
    const selectedIndex = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
    options[selectedIndex >= 0 ? selectedIndex : fallbackIndex]?.focus();
  }

  function focusRelativeOption(record, direction) {
    const options = menuOptions(record);
    if (options.length === 0) return;
    const currentIndex = options.indexOf(document.activeElement);
    const startIndex = currentIndex >= 0 ? currentIndex : options.findIndex((option) => option.getAttribute("aria-selected") === "true");
    const nextIndex = (Math.max(startIndex, 0) + direction + options.length) % options.length;
    options[nextIndex].focus();
  }

  function toggle(record) {
    if (record.select.disabled) return;
    const willOpen = !record.wrapper.classList.contains("is-open");
    closeAll(record);
    record.wrapper.classList.toggle("is-open", willOpen);
    record.trigger.setAttribute("aria-expanded", String(willOpen));
    record.menu.classList.toggle("hidden", !willOpen);
    if (willOpen) {
      render(record);
      const selected = record.menu.querySelector('[aria-selected="true"]');
      selected?.scrollIntoView({ block: "nearest" });
    }
  }

  function enhance(select) {
    if (select.multiple) return;
    if (enhancedSelects.has(select) || select.closest(".compact-select")) return;
    enhancedSelects.add(select);

    const wrapper = document.createElement("div");
    wrapper.className = "combo-shell compact-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "compact-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const fieldLabel = select.closest(".field-block")?.querySelector(":scope > span")?.textContent?.trim();
    trigger.setAttribute("aria-label", fieldLabel ? `Choose ${fieldLabel}` : "Choose an option");

    const valueLabel = document.createElement("span");
    valueLabel.className = "compact-select-value";
    const toggleArea = document.createElement("span");
    toggleArea.className = "compact-select-toggle";
    toggleArea.setAttribute("aria-hidden", "true");
    toggleArea.innerHTML = '<span class="combo-chevron"></span>';
    trigger.append(valueLabel, toggleArea);

    const menu = document.createElement("div");
    selectSequence += 1;
    menu.id = `compact-select-menu-${selectSequence}`;
    menu.className = "combo-menu compact-select-menu hidden";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", fieldLabel || "Options");
    trigger.setAttribute("aria-controls", menu.id);
    wrapper.append(trigger, menu);
    select.before(wrapper);
    wrapper.appendChild(select);
    select.classList.add("compact-select-native");

    const record = { select, wrapper, trigger, valueLabel, menu };
    selectRecords.add(record);
    render(record);

    trigger.addEventListener("click", () => toggle(record));
    trigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        if (!record.wrapper.classList.contains("is-open")) toggle(record);
        focusSelectedOption(record, event.key === "ArrowUp" ? menuOptions(record).length - 1 : 0);
      } else if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        toggle(record);
        if (record.wrapper.classList.contains("is-open")) focusSelectedOption(record);
      } else if (event.key === "Escape") {
        close(record);
      }
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(record);
        trigger.focus();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRelativeOption(record, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusRelativeOption(record, -1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const options = menuOptions(record);
        options[event.key === "Home" ? 0 : options.length - 1]?.focus();
      }
    });

    new MutationObserver(() => render(record)).observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  }

  function refreshAll() {
    for (const record of selectRecords) render(record);
  }

  function enhanceAll(root = document) {
    if (root.matches?.("select")) enhance(root);
    for (const select of root.querySelectorAll?.("select") || []) enhance(select);
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".compact-select")) closeAll();
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("select")) refreshAll();
  });

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) enhanceAll(node);
      }
    }
  });

  enhanceAll();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.dgfpCompactSelect = { enhanceAll, refreshAll };
})();
