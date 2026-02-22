const state = {
  activeView: "kube",
  kube: {
    summary: null,
    filter: "",
    items: [],
  },
  hosts: {
    profiles: [],
    selected: "",
  },
  crypto: {
    type: "base64",
    direction: "encrypt",
  },
};

const mockStore = {
  kubeDefaultPath: "~/.kube/config",
  kube: {
    kubeconfig_path: "~/.kube/config",
    current_context: "dev-shanghai",
    contexts: [
      { name: "dev-shanghai", is_current: true },
      { name: "test-beijing", is_current: false },
      { name: "prod-singapore", is_current: false },
    ],
  },
  kubeItems: [],
  hostsProfiles: {
    dev: "127.0.0.1 localhost\n10.10.10.11 api.dev.local\n",
    test: "127.0.0.1 localhost\n10.10.20.11 api.test.local\n",
    prod: "127.0.0.1 localhost\n10.10.30.11 api.prod.local\n",
  },
  systemHosts: "127.0.0.1 localhost\n::1 localhost\n",
  backups: [],
};

const invokeNative =
  window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke ?? null;

const dom = {};
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let toastTimer = null;

window.addEventListener("DOMContentLoaded", async () => {
  collectDom();
  bindEvents();
  updateCryptoUi();
  dom.runtimeMode.textContent = invokeNative
    ? "Tauri Runtime"
    : "浏览器预览模式（模拟数据）";

  await refreshKube(false);
  await refreshKubeItems(false);
  await refreshHostsProfiles();
  await refreshHostsBackups();

  if (!invokeNative) {
    showToast("当前为浏览器预览模式，数据是模拟的。");
  }
});

function collectDom() {
  dom.views = {
    kube: document.querySelector("#view-kube"),
    hosts: document.querySelector("#view-hosts"),
    crypto: document.querySelector("#view-crypto"),
  };
  dom.menuItems = [...document.querySelectorAll(".menu-item")];
  dom.runtimeMode = document.querySelector("#runtime-mode");
  dom.toast = document.querySelector("#toast");

  dom.kubePath = document.querySelector("#kube-path");
  dom.kubeCurrent = document.querySelector("#kube-current");
  dom.kubeList = document.querySelector("#kube-context-list");
  dom.kubeItemList = document.querySelector("#kube-item-list");
  dom.kubeItemRefreshBtn = document.querySelector("#kube-item-refresh-btn");
  dom.kubeRefreshBtn = document.querySelector("#kube-refresh-btn");
  dom.kubeImportBtn = document.querySelector("#kube-import-btn");
  dom.kubePasteBtn = document.querySelector("#kube-paste-btn");
  dom.kubeDefaultBtn = document.querySelector("#kube-default-btn");
  dom.kubeFileInput = document.querySelector("#kube-file-input");
  dom.kubeSearch = document.querySelector("#kube-search");
  dom.kubeConfigName = document.querySelector("#kube-config-name");
  dom.kubePastePanel = document.querySelector("#kube-paste-panel");
  dom.kubePasteInput = document.querySelector("#kube-paste-input");
  dom.kubePasteConfirmBtn = document.querySelector("#kube-paste-confirm-btn");
  dom.kubePasteCancelBtn = document.querySelector("#kube-paste-cancel-btn");

  dom.hostsProfileName = document.querySelector("#hosts-profile-name");
  dom.hostsProfileList = document.querySelector("#hosts-profile-list");
  dom.hostsEditor = document.querySelector("#hosts-editor");
  dom.hostsDiff = document.querySelector("#hosts-diff");
  dom.hostsLatestBackup = document.querySelector("#hosts-latest-backup");
  dom.hostsSaveBtn = document.querySelector("#hosts-save-btn");
  dom.hostsApplyBtn = document.querySelector("#hosts-apply-btn");
  dom.hostsDeleteBtn = document.querySelector("#hosts-delete-btn");
  dom.hostsRestoreBtn = document.querySelector("#hosts-restore-btn");
  dom.hostsPreviewBtn = document.querySelector("#hosts-preview-btn");
  dom.hostsReadBtn = document.querySelector("#hosts-read-btn");

  dom.cryptoType = document.querySelector("#crypto-type");
  dom.cryptoDirection = document.querySelector("#crypto-direction");
  dom.cryptoKey = document.querySelector("#crypto-key");
  dom.cryptoIv = document.querySelector("#crypto-iv");
  dom.cryptoHint = document.querySelector("#crypto-hint");
  dom.cryptoInput = document.querySelector("#crypto-input");
  dom.cryptoOutput = document.querySelector("#crypto-output");
  dom.cryptoRunBtn = document.querySelector("#crypto-run-btn");
  dom.cryptoSwapBtn = document.querySelector("#crypto-swap-btn");
  dom.cryptoCopyBtn = document.querySelector("#crypto-copy-btn");
  dom.cryptoClearBtn = document.querySelector("#crypto-clear-btn");
}

function bindEvents() {
  dom.menuItems.forEach((item) => {
    item.addEventListener("click", () => {
      switchView(item.dataset.view);
    });
  });

  dom.kubeRefreshBtn.addEventListener("click", async () => {
    await refreshKube();
  });

  dom.kubeItemRefreshBtn.addEventListener("click", async () => {
    await refreshKubeItems(true);
  });

  dom.kubeImportBtn.addEventListener("click", () => {
    dom.kubeFileInput.value = "";
    dom.kubeFileInput.click();
  });

  dom.kubePasteBtn.addEventListener("click", () => {
    const nextVisible = dom.kubePastePanel.classList.contains("hidden");
    toggleKubePastePanel(nextVisible);
    if (nextVisible) {
      dom.kubePasteInput.focus();
    }
  });

  dom.kubeDefaultBtn.addEventListener("click", async () => {
    await resetKubeconfigPath();
  });

  dom.kubeFileInput.addEventListener("change", async () => {
    await importKubeconfigFile();
  });

  dom.kubePasteConfirmBtn.addEventListener("click", async () => {
    await importKubeconfigByPaste();
  });

  dom.kubePasteCancelBtn.addEventListener("click", () => {
    toggleKubePastePanel(false);
  });

  dom.kubeSearch.addEventListener("input", () => {
    state.kube.filter = dom.kubeSearch.value.trim();
    renderKubeList();
  });

  dom.kubeItemList.addEventListener("click", async (event) => {
    const useTarget = event.target.closest("[data-use-kube-item]");
    if (useTarget) {
      const id = decodeURIComponent(useTarget.dataset.useKubeItem);
      await selectKubeconfigItem(id);
      return;
    }

    const removeTarget = event.target.closest("[data-remove-kube-item]");
    if (removeTarget) {
      const id = decodeURIComponent(removeTarget.dataset.removeKubeItem);
      await removeKubeconfigItem(id);
    }
  });

  dom.hostsProfileList.addEventListener("click", async (event) => {
    const applyTarget = event.target.closest("[data-apply-profile]");
    if (applyTarget) {
      await applyHostsProfile(decodeURIComponent(applyTarget.dataset.applyProfile));
      return;
    }

    const selectTarget = event.target.closest("[data-select-profile]");
    if (selectTarget) {
      await selectHostsProfile(decodeURIComponent(selectTarget.dataset.selectProfile));
    }
  });

  dom.hostsSaveBtn.addEventListener("click", async () => {
    await saveHostsProfile();
  });

  dom.hostsApplyBtn.addEventListener("click", async () => {
    await applyHostsProfile();
  });

  dom.hostsDeleteBtn.addEventListener("click", async () => {
    await deleteHostsProfile();
  });

  dom.hostsRestoreBtn.addEventListener("click", async () => {
    await restoreLatestHostsBackup();
  });

  dom.hostsPreviewBtn.addEventListener("click", async () => {
    await previewHostsDiff();
  });

  dom.hostsReadBtn.addEventListener("click", async () => {
    await readSystemHosts();
  });

  dom.cryptoType.addEventListener("change", () => {
    state.crypto.type = dom.cryptoType.value;
    updateCryptoUi();
  });

  dom.cryptoDirection.addEventListener("change", () => {
    state.crypto.direction = dom.cryptoDirection.value;
    updateCryptoUi();
  });

  dom.cryptoRunBtn.addEventListener("click", async () => {
    await runCryptoTransform();
  });

  dom.cryptoSwapBtn.addEventListener("click", () => {
    const input = dom.cryptoInput.value;
    dom.cryptoInput.value = dom.cryptoOutput.value;
    dom.cryptoOutput.value = input;
  });

  dom.cryptoCopyBtn.addEventListener("click", async () => {
    const text = dom.cryptoOutput.value;
    if (!text) {
      showToast("没有可复制的输出。");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const tmp = document.createElement("textarea");
        tmp.value = text;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        tmp.remove();
      }
      showToast("已复制输出。");
    } catch (error) {
      showToast(`复制失败: ${String(error)}`);
    }
  });

  dom.cryptoClearBtn.addEventListener("click", () => {
    dom.cryptoInput.value = "";
    dom.cryptoOutput.value = "";
  });
}

function switchView(nextView) {
  if (!dom.views[nextView]) {
    return;
  }

  state.activeView = nextView;
  Object.entries(dom.views).forEach(([view, element]) => {
    element.classList.toggle("active", view === nextView);
  });
  dom.menuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === nextView);
  });
}

function toggleKubePastePanel(show) {
  dom.kubePastePanel.classList.toggle("hidden", !show);
  if (!show) {
    dom.kubePasteInput.value = "";
  }
}

function currentConfigNameInput() {
  const name = dom.kubeConfigName.value.trim();
  return name.length ? name : null;
}

function clearConfigNameInput() {
  dom.kubeConfigName.value = "";
}

function updateCryptoUi() {
  const type = dom.cryptoType.value;
  const usingAes = type === "aes-gcm";

  dom.cryptoKey.disabled = !usingAes;
  dom.cryptoIv.disabled = !usingAes;
  dom.cryptoKey.placeholder = usingAes
    ? "密钥（AES-GCM 必填）"
    : "该算法不需要密钥";
  dom.cryptoIv.placeholder = usingAes
    ? "IV（Base64，可选）"
    : "该算法不需要 IV";

  if (usingAes) {
    if (dom.cryptoDirection.value === "encrypt") {
      dom.cryptoHint.textContent =
        "AES-GCM 加密输出格式：ivBase64:cipherBase64。IV 留空时自动生成。";
    } else {
      dom.cryptoHint.textContent =
        "AES-GCM 解密输入支持 ivBase64:cipherBase64，或在右侧 IV 填写后只输入 cipherBase64。";
    }
  } else if (type === "base64") {
    dom.cryptoHint.textContent = "Base64 支持 UTF-8 文本的编码与解码。";
  } else if (type === "url") {
    dom.cryptoHint.textContent = "URL 模式使用 encodeURIComponent / decodeURIComponent。";
  } else if (type === "hex") {
    dom.cryptoHint.textContent = "Hex 模式使用 UTF-8 与十六进制互转。";
  } else {
    dom.cryptoHint.textContent = "";
  }
}

async function runCryptoTransform() {
  const input = dom.cryptoInput.value;
  const type = dom.cryptoType.value;
  const direction = dom.cryptoDirection.value;

  try {
    let output = "";
    if (type === "base64") {
      output = direction === "encrypt" ? utf8ToBase64(input) : base64ToUtf8(input);
    } else if (type === "url") {
      output = direction === "encrypt" ? encodeURIComponent(input) : decodeURIComponent(input);
    } else if (type === "hex") {
      output = direction === "encrypt" ? utf8ToHex(input) : hexToUtf8(input);
    } else if (type === "aes-gcm") {
      output = await runAesGcmTransform(input, direction, dom.cryptoKey.value, dom.cryptoIv.value);
    } else {
      throw new Error(`不支持的算法: ${type}`);
    }

    dom.cryptoOutput.value = output;
  } catch (error) {
    dom.cryptoOutput.value = "";
    showToast(`转换失败: ${String(error)}`);
  }
}

function utf8ToBase64(text) {
  return bytesToBase64(textEncoder.encode(text));
}

function base64ToUtf8(base64Text) {
  return textDecoder.decode(base64ToBytes(base64Text));
}

function utf8ToHex(text) {
  return bytesToHex(textEncoder.encode(text));
}

function hexToUtf8(hexText) {
  return textDecoder.decode(hexToBytes(hexText));
}

async function runAesGcmTransform(input, direction, rawKey, rawIv) {
  if (!window.crypto?.subtle) {
    throw new Error("当前环境不支持 Web Crypto。");
  }

  const keyText = rawKey.trim();
  if (!keyText) {
    throw new Error("AES-GCM 需要填写密钥。");
  }

  const cryptoKey = await deriveAesKey(keyText);
  if (direction === "encrypt") {
    const ivBytes = rawIv.trim()
      ? base64ToBytes(rawIv.trim())
      : window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: ivBytes },
      cryptoKey,
      textEncoder.encode(input)
    );
    return `${bytesToBase64(ivBytes)}:${bytesToBase64(new Uint8Array(encrypted))}`;
  }

  const { ivBytes, cipherBytes } = parseAesDecryptInput(input, rawIv);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    cryptoKey,
    cipherBytes
  );
  return textDecoder.decode(new Uint8Array(decrypted));
}

async function deriveAesKey(keyText) {
  const digest = await window.crypto.subtle.digest("SHA-256", textEncoder.encode(keyText));
  return window.crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function parseAesDecryptInput(input, rawIv) {
  const trimmedInput = input.trim();
  if (!trimmedInput) {
    throw new Error("AES-GCM 解密输入不能为空。");
  }

  if (trimmedInput.includes(":")) {
    const index = trimmedInput.indexOf(":");
    const ivPart = trimmedInput.slice(0, index).trim();
    const cipherPart = trimmedInput.slice(index + 1).trim();
    if (!ivPart || !cipherPart) {
      throw new Error("AES-GCM 输入格式错误，应为 ivBase64:cipherBase64。");
    }
    return {
      ivBytes: base64ToBytes(ivPart),
      cipherBytes: base64ToBytes(cipherPart),
    };
  }

  const ivText = rawIv.trim();
  if (!ivText) {
    throw new Error("AES-GCM 解密需要 IV。可使用 iv:cipher 格式输入。");
  }
  return {
    ivBytes: base64ToBytes(ivText),
    cipherBytes: base64ToBytes(trimmedInput),
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64Text) {
  const normalized = base64Text.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hexText) {
  const normalized = hexText.replace(/\s+/g, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("Hex 输入格式无效。");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

async function refreshKube(showMsg = true) {
  try {
    const summary = await invokeCommand("list_kube_contexts");
    state.kube.summary = summary;
    renderKubeList();
    if (showMsg) {
      showToast("Kubeconfig 已刷新。");
    }
  } catch (error) {
    state.kube.summary = null;
    renderKubeList();
    showToast(String(error));
  }
}

async function refreshKubeItems(showMsg = false) {
  try {
    const items = await invokeCommand("list_kubeconfig_items");
    state.kube.items = items;
    renderKubeItems();
    if (showMsg) {
      showToast("Kubeconfig 列表已刷新。");
    }
  } catch (error) {
    state.kube.items = [];
    renderKubeItems();
    showToast(String(error));
  }
}

function renderKubeList() {
  if (!state.kube.summary) {
    dom.kubePath.textContent = "路径：-";
    dom.kubeCurrent.textContent = "当前 context：-";
    dom.kubeList.innerHTML =
      '<div class="empty-state">无法读取 kubeconfig，请检查文件路径或内容。</div>';
    return;
  }

  const { kubeconfig_path, current_context, contexts } = state.kube.summary;
  dom.kubePath.textContent = `路径：${kubeconfig_path}`;
  dom.kubeCurrent.textContent = `当前 context：${current_context ?? "-"}`;

  const keyword = state.kube.filter.toLowerCase();
  const matched = contexts.filter((item) =>
    item.name.toLowerCase().includes(keyword)
  );

  if (!matched.length) {
    dom.kubeList.innerHTML =
      '<div class="empty-state">没有匹配的 context。</div>';
    return;
  }

  dom.kubeList.innerHTML = matched
    .map((item) => {
      const safeName = escapeHtml(item.name);
      const encodedName = encodeURIComponent(item.name);
      const action = item.is_current
        ? '<span class="badge badge-blue">CURRENT</span>'
        : `<button class="action-btn" data-switch-context="${encodedName}">切换</button>`;

      return `
        <div class="item">
          <div class="item-main">
            <p class="item-title">${safeName}</p>
            <p class="item-subtitle">context</p>
          </div>
          ${action}
        </div>
      `;
    })
    .join("");

  dom.kubeList
    .querySelectorAll("[data-switch-context]")
    .forEach((buttonElement) => {
      buttonElement.addEventListener("click", async () => {
        const target = decodeURIComponent(buttonElement.dataset.switchContext);
        await switchKubeContext(target);
      });
    });
}

function renderKubeItems() {
  if (!state.kube.items.length) {
    dom.kubeItemList.innerHTML =
      '<div class="empty-state">暂无 kubeconfig。导入文件或粘贴内容后会出现在这里。</div>';
    return;
  }

  dom.kubeItemList.innerHTML = state.kube.items
    .map((item) => {
      const encodedId = encodeURIComponent(item.id);
      const safeName = escapeHtml(item.name);
      const safePath = escapeHtml(item.path);
      const updatedText = formatUnixTime(item.updated_at);
      const statusBadge = item.is_current
        ? '<span class="badge badge-blue">CURRENT</span>'
        : item.exists
          ? '<span class="badge badge-orange">READY</span>'
          : '<span class="badge badge-orange">MISSING</span>';
      const useButton = item.exists
        ? `<button class="action-btn" data-use-kube-item="${encodedId}">使用</button>`
        : "";

      return `
        <div class="item">
          <div class="item-main">
            <p class="item-title">${safeName}</p>
            <p class="item-subtitle">${safePath}</p>
            <p class="item-subtitle">更新：${updatedText}</p>
          </div>
          <div class="inline-actions">
            ${statusBadge}
            ${useButton}
            <button class="action-btn danger" data-remove-kube-item="${encodedId}">移除</button>
          </div>
        </div>
      `;
    })
    .join("");
}

async function switchKubeContext(target) {
  try {
    const summary = await invokeCommand("switch_kube_context", { target });
    state.kube.summary = summary;
    renderKubeList();
    await refreshKubeItems(false);
    showToast(`已切换到 ${target}`);
  } catch (error) {
    showToast(String(error));
  }
}

async function selectKubeconfigItem(id) {
  try {
    const summary = await invokeCommand("select_kubeconfig_item", { id });
    state.kube.summary = summary;
    renderKubeList();
    await refreshKubeItems(false);
    showToast("已切换 kubeconfig。");
  } catch (error) {
    showToast(String(error));
  }
}

async function removeKubeconfigItem(id) {
  try {
    await invokeCommand("remove_kubeconfig_item", { id });
    await refreshKubeItems(false);
    showToast("已移除 kubeconfig。");
  } catch (error) {
    showToast(String(error));
  }
}

async function importKubeconfigFile() {
  const file = dom.kubeFileInput.files?.[0];
  if (!file) {
    showToast("已取消导入。");
    return;
  }

  try {
    const content = await file.text();
    const summary = await importKubeconfigContent(file.name, content);
    state.kube.summary = summary;
    renderKubeList();
    await refreshKubeItems(false);
    clearConfigNameInput();
    showToast(`已导入 kubeconfig：${summary.kubeconfig_path}`);
  } catch (error) {
    showToast(String(error));
  } finally {
    dom.kubeFileInput.value = "";
  }
}

async function importKubeconfigByPaste() {
  const content = dom.kubePasteInput.value;
  if (!content.trim()) {
    showToast("请先粘贴 kubeconfig 内容。");
    return;
  }

  try {
    const summary = await importKubeconfigContent("pasted-kubeconfig.yaml", content);
    state.kube.summary = summary;
    renderKubeList();
    toggleKubePastePanel(false);
    await refreshKubeItems(false);
    clearConfigNameInput();
    showToast("已导入粘贴内容。");
  } catch (error) {
    showToast(String(error));
  }
}

async function importKubeconfigContent(fileName, content) {
  const configName = currentConfigNameInput();
  return invokeCommand("import_kubeconfig_content", {
    file_name: fileName,
    fileName,
    content,
    config_name: configName,
    configName,
  });
}

async function resetKubeconfigPath() {
  try {
    const summary = await invokeCommand("clear_kubeconfig_override");
    state.kube.summary = summary;
    renderKubeList();
    toggleKubePastePanel(false);
    await refreshKubeItems(false);
    showToast("已恢复默认 kubeconfig 路径。");
  } catch (error) {
    showToast(String(error));
  }
}

async function refreshHostsProfiles() {
  try {
    const profiles = await invokeCommand("list_hosts_profiles");
    state.hosts.profiles = profiles;

    if (state.hosts.selected) {
      const stillExists = profiles.some(
        (profile) => profile.name === state.hosts.selected
      );
      if (!stillExists) {
        state.hosts.selected = "";
      }
    }

    if (!state.hosts.selected && profiles.length > 0) {
      await selectHostsProfile(profiles[0].name);
    } else {
      renderHostsProfiles();
    }
  } catch (error) {
    showToast(String(error));
  }
}

function renderHostsProfiles() {
  if (!state.hosts.profiles.length) {
    dom.hostsProfileList.innerHTML =
      '<div class="empty-state">还没有配置，先输入名称和内容再保存。</div>';
    return;
  }

  dom.hostsProfileList.innerHTML = state.hosts.profiles
    .map((profile) => {
      const safeName = escapeHtml(profile.name);
      const encodedName = encodeURIComponent(profile.name);
      const selected = profile.name === state.hosts.selected;
      const updatedText = formatUnixTime(profile.updated_at);
      return `
        <div class="item ${selected ? "selected" : ""}" data-select-profile="${encodedName}">
          <div class="item-main">
            <p class="item-title">${safeName}</p>
            <p class="item-subtitle">更新时间：${updatedText}</p>
          </div>
          <button class="action-btn" data-apply-profile="${encodedName}">应用</button>
        </div>
      `;
    })
    .join("");
}

async function selectHostsProfile(name) {
  try {
    const content = await invokeCommand("load_hosts_profile", { name });
    state.hosts.selected = name;
    dom.hostsProfileName.value = name;
    dom.hostsEditor.value = content;
    renderHostsProfiles();
  } catch (error) {
    showToast(String(error));
  }
}

async function saveHostsProfile() {
  const name = dom.hostsProfileName.value.trim() || state.hosts.selected;
  if (!name) {
    showToast("请先输入配置名。");
    return;
  }

  try {
    await invokeCommand("save_hosts_profile", {
      name,
      content: dom.hostsEditor.value,
    });
    state.hosts.selected = name;
    await refreshHostsProfiles();
    showToast(`已保存配置 ${name}`);
  } catch (error) {
    showToast(String(error));
  }
}

async function applyHostsProfile(profileName) {
  const name = profileName || state.hosts.selected || dom.hostsProfileName.value.trim();
  if (!name) {
    showToast("请先选择要应用的配置。");
    return;
  }

  if (!window.confirm(`确认应用 hosts 配置 "${name}" ?`)) {
    return;
  }

  try {
    const message = await invokeCommand("apply_hosts_profile", { name });
    await refreshHostsBackups();
    showToast(message);
  } catch (error) {
    showToast(String(error));
  }
}

async function deleteHostsProfile() {
  const name = state.hosts.selected || dom.hostsProfileName.value.trim();
  if (!name) {
    showToast("请先选择要删除的配置。");
    return;
  }

  if (!window.confirm(`确认删除 hosts 配置 "${name}" ?`)) {
    return;
  }

  try {
    await invokeCommand("delete_hosts_profile", { name });
    state.hosts.selected = "";
    dom.hostsProfileName.value = "";
    dom.hostsEditor.value = "";
    dom.hostsDiff.textContent = "";
    await refreshHostsProfiles();
    showToast(`已删除配置 ${name}`);
  } catch (error) {
    showToast(String(error));
  }
}

async function previewHostsDiff() {
  const name = state.hosts.selected || dom.hostsProfileName.value.trim();
  if (!name) {
    showToast("请先选择配置，再预览差异。");
    return;
  }

  try {
    const diff = await invokeCommand("preview_hosts_profile_diff", { name });
    const lines = [];

    diff.additions.forEach((line) => lines.push(`+ ${line}`));
    diff.removals.forEach((line) => lines.push(`- ${line}`));

    dom.hostsDiff.textContent = lines.length
      ? lines.join("\n")
      : "当前系统 hosts 与目标配置没有差异。";
  } catch (error) {
    showToast(String(error));
  }
}

async function readSystemHosts() {
  try {
    const content = await invokeCommand("read_hosts_file");
    dom.hostsDiff.textContent = content;
    showToast("已读取当前系统 hosts。");
  } catch (error) {
    showToast(String(error));
  }
}

async function refreshHostsBackups() {
  try {
    const backups = await invokeCommand("list_hosts_backups");
    dom.hostsLatestBackup.textContent = `最近备份：${backups[0] ?? "-"}`;
  } catch (error) {
    dom.hostsLatestBackup.textContent = "最近备份：-";
    showToast(String(error));
  }
}

async function restoreLatestHostsBackup() {
  if (!window.confirm("确认回滚到最近一次 hosts 备份?")) {
    return;
  }

  try {
    const message = await invokeCommand("restore_latest_hosts_backup");
    await refreshHostsBackups();
    showToast(message);
  } catch (error) {
    showToast(String(error));
  }
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("show");
  }, 2200);
}

function formatUnixTime(unixSeconds) {
  if (!unixSeconds) {
    return "未知";
  }

  const date = new Date(unixSeconds * 1000);
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function invokeCommand(command, args = {}) {
  if (invokeNative) {
    return invokeNative(command, args);
  }
  return mockInvoke(command, args);
}

function normalizeMockName(raw) {
  const text = String(raw || "").trim();
  if (text.length === 0) {
    return "kubeconfig";
  }
  return text.slice(0, 64);
}

function inferMockDefaultName() {
  return mockStore.kube.current_context || "kubeconfig";
}

function upsertMockKubeItem(path, name) {
  const now = Math.floor(Date.now() / 1000);
  const index = mockStore.kubeItems.findIndex(
    (item) => item.path.toLowerCase() === String(path).toLowerCase()
  );

  if (index >= 0) {
    mockStore.kubeItems[index].name = normalizeMockName(name);
    mockStore.kubeItems[index].updated_at = now;
    return mockStore.kubeItems[index];
  }

  const item = {
    id: `kcfg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: normalizeMockName(name),
    path,
    updated_at: now,
  };
  mockStore.kubeItems.unshift(item);
  mockStore.kubeItems = mockStore.kubeItems.slice(0, 200);
  return item;
}

async function mockInvoke(command, args) {
  switch (command) {
    case "list_kube_contexts":
      return structuredClone(mockStore.kube);
    case "switch_kube_context": {
      const target = args.target;
      const exists = mockStore.kube.contexts.some((item) => item.name === target);
      if (!exists) {
        throw new Error(`未找到 context: ${target}`);
      }
      mockStore.kube.current_context = target;
      mockStore.kube.contexts = mockStore.kube.contexts.map((item) => ({
        ...item,
        is_current: item.name === target,
      }));
      upsertMockKubeItem(mockStore.kube.kubeconfig_path, inferMockDefaultName());
      return structuredClone(mockStore.kube);
    }
    case "import_kubeconfig_content": {
      const fileName = args.file_name || args.fileName || "kubeconfig.yaml";
      const configName = args.config_name || args.configName || inferMockDefaultName();
      const path = `mock://${fileName}`;
      mockStore.kube.kubeconfig_path = path;
      upsertMockKubeItem(path, configName);
      return structuredClone(mockStore.kube);
    }
    case "clear_kubeconfig_override":
      mockStore.kube.kubeconfig_path = mockStore.kubeDefaultPath;
      return structuredClone(mockStore.kube);
    case "list_kubeconfig_items":
      return mockStore.kubeItems
        .map((item) => ({
          ...item,
          exists: true,
          is_current:
            item.path.toLowerCase() === mockStore.kube.kubeconfig_path.toLowerCase(),
        }))
        .sort((a, b) => b.updated_at - a.updated_at);
    case "select_kubeconfig_item": {
      const target = mockStore.kubeItems.find((item) => item.id === args.id);
      if (!target) {
        throw new Error(`未找到 kubeconfig 项: ${args.id}`);
      }
      mockStore.kube.kubeconfig_path = target.path;
      upsertMockKubeItem(target.path, target.name);
      return structuredClone(mockStore.kube);
    }
    case "remove_kubeconfig_item":
      mockStore.kubeItems = mockStore.kubeItems.filter((item) => item.id !== args.id);
      return null;
    case "list_hosts_profiles":
      return Object.keys(mockStore.hostsProfiles)
        .sort()
        .map((name) => ({ name, updated_at: Math.floor(Date.now() / 1000) }));
    case "load_hosts_profile": {
      const content = mockStore.hostsProfiles[args.name];
      if (content === undefined) {
        throw new Error(`配置不存在: ${args.name}`);
      }
      return content;
    }
    case "save_hosts_profile":
      mockStore.hostsProfiles[args.name] = withTrailingBreak(args.content);
      return null;
    case "delete_hosts_profile":
      if (!(args.name in mockStore.hostsProfiles)) {
        throw new Error(`配置不存在: ${args.name}`);
      }
      delete mockStore.hostsProfiles[args.name];
      return null;
    case "apply_hosts_profile": {
      const content = mockStore.hostsProfiles[args.name];
      if (content === undefined) {
        throw new Error(`配置不存在: ${args.name}`);
      }
      const backupName = `hosts-${Date.now()}.bak`;
      mockStore.backups.unshift({
        name: backupName,
        content: mockStore.systemHosts,
      });
      mockStore.systemHosts = withTrailingBreak(content);
      return `已应用配置 ${args.name}，备份文件: ${backupName}`;
    }
    case "read_hosts_file":
      return mockStore.systemHosts;
    case "list_hosts_backups":
      return mockStore.backups.map((backup) => backup.name);
    case "restore_latest_hosts_backup": {
      const latest = mockStore.backups[0];
      if (!latest) {
        throw new Error("没有可回滚的 hosts 备份");
      }
      mockStore.systemHosts = latest.content;
      return `已恢复备份 ${latest.name}`;
    }
    case "preview_hosts_profile_diff": {
      const desired = mockStore.hostsProfiles[args.name];
      if (desired === undefined) {
        throw new Error(`配置不存在: ${args.name}`);
      }

      const currentSet = normalizeLines(mockStore.systemHosts);
      const desiredSet = normalizeLines(desired);

      const additions = [...desiredSet].filter((line) => !currentSet.has(line));
      const removals = [...currentSet].filter((line) => !desiredSet.has(line));
      return { additions, removals };
    }
    default:
      throw new Error(`模拟层未实现命令: ${command}`);
  }
}

function withTrailingBreak(content) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function normalizeLines(content) {
  return new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
}
