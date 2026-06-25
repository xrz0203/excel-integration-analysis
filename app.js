const state = {
  currentUser: null,
  templates: [],
  pendingFiles: [],
  files: [],
  sheetNames: [],
  sheetFields: {},
  fields: [],
  previewRows: [],
  previewHeaders: [],
  previewFormats: {},
  downloadUrl: "",
};

const MAX_DATA_ROWS = 500;
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector("#appShell");
const loginForm = document.querySelector("#loginForm");
const loginEmail = document.querySelector("#loginEmail");
const loginPassword = document.querySelector("#loginPassword");
const loginMessage = document.querySelector("#loginMessage");
const currentUserName = document.querySelector("#currentUserName");
const currentUserRole = document.querySelector("#currentUserRole");
const logoutButton = document.querySelector("#logoutButton");
const adminPanel = document.querySelector("#adminPanel");
const createUserForm = document.querySelector("#createUserForm");
const newUserEmail = document.querySelector("#newUserEmail");
const newUserName = document.querySelector("#newUserName");
const newUserPassword = document.querySelector("#newUserPassword");
const newUserRole = document.querySelector("#newUserRole");
const usersBody = document.querySelector("#usersBody");
const adminMessage = document.querySelector("#adminMessage");
const fileInput = document.querySelector("#fileInput");
const fileCount = document.querySelector("#fileCount");
const sheetCount = document.querySelector("#sheetCount");
const fieldCount = document.querySelector("#fieldCount");
const ruleCount = document.querySelector("#ruleCount");
const loadHint = document.querySelector("#loadHint");
const parsePanel = document.querySelector("#parsePanel");
const parseSummary = document.querySelector("#parseSummary");
const parseDetail = document.querySelector("#parseDetail");
const parseButton = document.querySelector("#parseButton");
const fieldsList = document.querySelector("#fieldsList");
const filesBody = document.querySelector("#filesBody");
const rules = document.querySelector("#rules");
const addRuleButton = document.querySelector("#addRuleButton");
const previewButton = document.querySelector("#previewButton");
const exportButton = document.querySelector("#exportButton");
const downloadLink = document.querySelector("#downloadLink");
const templateName = document.querySelector("#templateName");
const templateSelect = document.querySelector("#templateSelect");
const saveTemplateButton = document.querySelector("#saveTemplateButton");
const loadTemplateButton = document.querySelector("#loadTemplateButton");
const deleteTemplateButton = document.querySelector("#deleteTemplateButton");
const templateMessage = document.querySelector("#templateMessage");
const sampleButton = document.querySelector("#sampleButton");
const previewHint = document.querySelector("#previewHint");
const previewTable = document.querySelector("#previewTable");
const ruleTemplate = document.querySelector("#ruleTemplate");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await login();
});

logoutButton.addEventListener("click", async () => {
  await apiFetch("/api/logout", { method: "POST" });
  state.currentUser = null;
  state.templates = [];
  renderAuthState();
});

fileInput.addEventListener("change", async (event) => {
  const selected = Array.from(event.target.files || []).filter(isSupportedFile);
  prepareFiles(selected);
});

parseButton.addEventListener("click", async () => {
  await loadFiles(state.pendingFiles);
});

addRuleButton.addEventListener("click", () => {
  addRule();
  updateRuleCount();
});

previewButton.addEventListener("click", () => {
  buildPreview();
});

exportButton.addEventListener("click", () => {
  exportWorkbook();
});

saveTemplateButton.addEventListener("click", async () => {
  await saveTemplate();
});

loadTemplateButton.addEventListener("click", () => {
  loadSelectedTemplate();
});

deleteTemplateButton.addEventListener("click", async () => {
  await deleteSelectedTemplate();
});

sampleButton.addEventListener("click", () => {
  loadSampleData();
});

createUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await createUser();
});

async function initAuth() {
  try {
    const { user } = await apiFetch("/api/me");
    state.currentUser = user;
    renderAuthState();
    if (user) {
      await refreshTemplates();
      if (user.role === "admin") await refreshUsers();
    }
  } catch (error) {
    loginMessage.textContent = error.message;
    renderAuthState();
  }
}

async function login() {
  loginMessage.textContent = "正在登录...";
  loginForm.querySelector("button[type='submit']").disabled = true;
  try {
    const { user } = await apiFetch("/api/login", {
      method: "POST",
      body: {
        email: loginEmail.value,
        password: loginPassword.value,
      },
    });
    state.currentUser = user;
    loginPassword.value = "";
    renderAuthState();
    await refreshTemplates();
    if (user.role === "admin") await refreshUsers();
    loginMessage.textContent = "";
  } catch (error) {
    loginMessage.textContent = error.message;
  } finally {
    loginForm.querySelector("button[type='submit']").disabled = false;
  }
}

function renderAuthState() {
  const signedIn = Boolean(state.currentUser);
  authScreen.hidden = signedIn;
  appShell.hidden = !signedIn;
  if (!signedIn) {
    currentUserName.textContent = "未登录";
    currentUserRole.textContent = "";
    adminPanel.hidden = true;
    return;
  }

  currentUserName.textContent = `${state.currentUser.name} (${state.currentUser.email})`;
  currentUserRole.textContent = state.currentUser.role === "admin" ? "管理员" : "普通用户";
  adminPanel.hidden = state.currentUser.role !== "admin";
}

async function refreshTemplates() {
  const { templates } = await apiFetch("/api/templates");
  state.templates = templates || [];
  renderTemplateSelect();
}

function renderTemplateSelect() {
  templateSelect.innerHTML = state.templates.length
    ? state.templates
        .map((template) => {
          const owner = state.currentUser?.role === "admin" && template.ownerEmail ? ` · ${template.ownerEmail}` : "";
          return `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name + owner)}</option>`;
        })
        .join("")
    : `<option value="">暂无模板</option>`;
}

async function saveTemplate() {
  templateMessage.textContent = "";
  const rulesConfig = getRuleConfigs();
  if (!rulesConfig.length) {
    templateMessage.textContent = "至少需要一条完整的指标规则。";
    return;
  }
  const name = templateName.value.trim();
  if (!name) {
    templateMessage.textContent = "请先填写模板名称。";
    return;
  }
  try {
    const selected = state.templates.find((template) => template.id === templateSelect.value);
    await apiFetch("/api/templates", {
      method: "POST",
      body: {
        id: selected?.name === name ? selected.id : undefined,
        name,
        rules: rulesConfig,
      },
    });
    templateMessage.textContent = "模板已保存。";
    await refreshTemplates();
  } catch (error) {
    templateMessage.textContent = error.message;
  }
}

function loadSelectedTemplate() {
  templateMessage.textContent = "";
  const template = state.templates.find((item) => item.id === templateSelect.value);
  if (!template) {
    templateMessage.textContent = "请选择一个模板。";
    return;
  }
  templateName.value = template.name;
  rules.innerHTML = "";
  for (const rule of template.rules || []) {
    addRule(rule);
  }
  ensureDefaultRule();
  refreshRuleSelects();
  updateRuleCount();
  buildPreview();
  templateMessage.textContent = "模板已载入。";
}

async function deleteSelectedTemplate() {
  templateMessage.textContent = "";
  const id = templateSelect.value;
  if (!id) {
    templateMessage.textContent = "请选择一个模板。";
    return;
  }
  try {
    await apiFetch(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    templateMessage.textContent = "模板已删除。";
    await refreshTemplates();
  } catch (error) {
    templateMessage.textContent = error.message;
  }
}

async function refreshUsers() {
  const { users } = await apiFetch("/api/users");
  usersBody.innerHTML = users.length
    ? users
        .map(
          (user) => `<tr>
            <td>${escapeHtml(user.email)}</td>
            <td>${escapeHtml(user.name)}</td>
            <td>${user.role === "admin" ? "管理员" : "普通用户"}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="3">暂无用户</td></tr>`;
}

async function createUser() {
  adminMessage.textContent = "";
  try {
    await apiFetch("/api/users", {
      method: "POST",
      body: {
        email: newUserEmail.value,
        name: newUserName.value,
        password: newUserPassword.value,
        role: newUserRole.value,
      },
    });
    createUserForm.reset();
    adminMessage.textContent = "用户已创建。";
    await refreshUsers();
  } catch (error) {
    adminMessage.textContent = error.message;
  }
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function isSupportedFile(file) {
  return /\.(xlsx|xls|csv)$/i.test(file.name);
}

function prepareFiles(files) {
  state.pendingFiles = files;
  resetLoadedData();
  resetDownloadLink();

  if (!files.length) {
    parsePanel.hidden = true;
    setMessage("没有找到 .xlsx、.xls 或 .csv 文件。");
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const largeFiles = files.filter((file) => file.size > LARGE_FILE_BYTES);
  parsePanel.hidden = false;
  parseButton.disabled = false;
  parseSummary.textContent = `已选择 ${files.length} 个文件，共 ${formatBytes(totalBytes)}`;
  parseDetail.textContent = largeFiles.length
    ? `${largeFiles.length} 个文件超过 ${formatBytes(LARGE_FILE_BYTES)}，解析时会跳过，避免浏览器崩溃。`
    : `点击“开始解析”后再读取 Excel。每个 Sheet 最多保留前 ${MAX_DATA_ROWS} 条数据用于汇总。`;
  fileCount.textContent = String(files.length);
  sheetCount.textContent = "0";
  fieldCount.textContent = "0";
  loadHint.textContent = "文件夹已选择，等待开始解析。";
}

async function loadFiles(files) {
  if (!files.length) {
    setMessage("没有找到 .xlsx、.xls 或 .csv 文件。");
    return;
  }

  if (!window.XLSX) {
    setMessage("Excel 解析库没有加载成功，请刷新页面后重试。");
    return;
  }

  parseButton.disabled = true;
  parseSummary.textContent = "正在解析文件夹";
  parseDetail.textContent = `0 / ${files.length} 个文件完成。解析期间请先不要切换页面或重复选择文件夹。`;
  resetLoadedData();
  const parsed = [];
  for (const [index, file] of files.entries()) {
    try {
      parsed.push(await parseFile(file));
    } catch (error) {
      const name = file.webkitRelativePath || file.name;
      parsed.push({
        name,
        displayName: stripFileExtension(name),
        sheets: [],
        error: error.message || "读取失败",
      });
    }
    parseDetail.textContent = `${index + 1} / ${files.length} 个文件完成。`;
    await yieldToBrowser();
  }

  setLoadedFiles(parsed);
  parseSummary.textContent = "解析完成";
  parseDetail.textContent = `已解析 ${files.length} 个文件。每个 Sheet 最多保留前 ${MAX_DATA_ROWS} 条数据用于汇总。`;
  parseButton.disabled = false;
}

async function parseFile(file) {
  const name = file.webkitRelativePath || file.name;
  if (file.size > LARGE_FILE_BYTES) {
    return {
      name,
      displayName: stripFileExtension(name),
      sheets: [],
      error: `文件超过 ${formatBytes(LARGE_FILE_BYTES)}，已跳过以避免浏览器崩溃`,
    };
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) {
    return { name, displayName: stripFileExtension(name), sheets: [], error: "没有工作表" };
  }

  const sheets = sheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return parseSheet(sheetName, sheet);
  });

  return { name, displayName: stripFileExtension(name), sheets, error: "" };
}

function parseSheet(sheetName, sheet) {
  const headerScan = sheetToMatrix(sheet, 0, 24);
  const headerIndex = findHeaderIndex(headerScan.matrix);
  if (headerIndex === -1) {
    return { name: sheetName, headers: [], rows: [], error: "空表" };
  }

  const absoluteHeaderRow = headerScan.startRow + headerIndex;
  const dataScan = sheetToMatrix(sheet, absoluteHeaderRow, absoluteHeaderRow + MAX_DATA_ROWS);
  const headers = createHeaders(dataScan.matrix[0] || []);
  const rows = dataScan.matrix.slice(1, 1 + MAX_DATA_ROWS).map((row) => rowToObject(headers, row));
  const visibleHeaders = headers.filter(Boolean);
  return { name: sheetName, headers: visibleHeaders, rows, error: "" };
}

function sheetToMatrix(sheet, startRow, endRow) {
  const ref = sheet["!ref"];
  if (!ref) return { matrix: [], startRow: 0 };
  const range = XLSX.utils.decode_range(ref);
  range.s.r = Math.max(range.s.r, startRow);
  range.e.r = Math.min(range.e.r, endRow);
  if (range.s.r > range.e.r) return { matrix: [], startRow: range.s.r };
  return {
    matrix: XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      range,
    }),
    startRow: range.s.r,
  };
}

function findHeaderIndex(matrix) {
  let bestIndex = -1;
  let bestScore = 0;
  matrix.slice(0, 25).forEach((row, index) => {
    const cells = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
    if (!cells.length) return;
    const uniqueCells = new Set(cells).size;
    const numericCells = cells.filter((cell) => Number.isFinite(Number(cell.replace(/,/g, "")))).length;
    const score = cells.length * 2 + uniqueCells - numericCells * 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function createHeaders(row) {
  const counts = new Map();
  return row.map((value) => {
    const header = normalizeHeader(value);
    if (!header) return "";
    const nextCount = (counts.get(header) || 0) + 1;
    counts.set(header, nextCount);
    return nextCount === 1 ? header : `${header} (${nextCount})`;
  });
}

function normalizeHeader(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rowToObject(headers, row) {
  return headers.reduce((object, header, index) => {
    if (header) object[header] = row[index] ?? "";
    return object;
  }, {});
}

function setLoadedFiles(files) {
  state.files = files;
  collectSchema(files);
  renderLoadedState();
  ensureDefaultRule();
  refreshRuleSelects();
  buildPreview();
}

function resetLoadedData() {
  state.files = [];
  state.sheetNames = [];
  state.sheetFields = {};
  state.fields = [];
  clearPreview("正在解析文件夹。");
  renderLoadedState();
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function collectSchema(files) {
  const sheetMap = new Map();
  const allFields = new Set();

  for (const file of files) {
    for (const sheet of file.sheets || []) {
      if (!sheetMap.has(sheet.name)) sheetMap.set(sheet.name, new Set());
      const fieldSet = sheetMap.get(sheet.name);
      for (const header of sheet.headers) {
        fieldSet.add(header);
        allFields.add(header);
      }
    }
  }

  state.sheetNames = Array.from(sheetMap.keys()).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  state.sheetFields = state.sheetNames.reduce((object, sheetName) => {
    object[sheetName] = Array.from(sheetMap.get(sheetName)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    return object;
  }, {});
  state.fields = Array.from(allFields).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function renderLoadedState() {
  fileCount.textContent = String(state.files.length);
  sheetCount.textContent = String(state.sheetNames.length);
  fieldCount.textContent = String(state.fields.length);
  loadHint.textContent = state.files.length
    ? "字段按 Tab 分组展示；汇总规则可以从不同 Tab 选择不同字段。"
    : "先选择一个包含 Excel 或 CSV 的文件夹。";

  fieldsList.className = state.sheetNames.length ? "sheet-groups" : "chips empty";
  fieldsList.innerHTML = state.sheetNames.length
    ? state.sheetNames
        .map((sheetName) => {
          const chips = state.sheetFields[sheetName]
            .map((field) => `<span class="chip">${escapeHtml(field)}</span>`)
            .join("");
          return `<section class="sheet-group"><h3>${escapeHtml(sheetName)}</h3><div class="chips">${chips}</div></section>`;
        })
        .join("")
    : "暂无字段";

  filesBody.innerHTML = state.files.length
    ? state.files
        .map((file) => {
          if (file.error) {
            return `<tr><td>${escapeHtml(getDisplayFileName(file))}</td><td colspan="3"><span class="warning">${escapeHtml(file.error)}</span></td></tr>`;
          }
          return (file.sheets || [])
            .map((sheet, index) => {
              const status = sheet.error
                ? `<span class="warning">${escapeHtml(sheet.error)}</span>`
                : `${sheet.headers.length}`;
              return `<tr>
                <td>${index === 0 ? escapeHtml(getDisplayFileName(file)) : ""}</td>
                <td>${escapeHtml(sheet.name)}</td>
                <td>${status}</td>
                <td>${sheet.rows.length}</td>
              </tr>`;
            })
            .join("");
        })
        .join("")
    : `<tr><td colspan="4">等待读取</td></tr>`;
}

function ensureDefaultRule() {
  if (!rules.children.length) {
    addRule();
  }
}

function addRule(rule = {}) {
  const node = ruleTemplate.content.firstElementChild.cloneNode(true);
  node.draggable = true;
  node.setAttribute("draggable", "true");
  node.querySelector(".drag-handle").setAttribute("draggable", "true");
  node.querySelector(".rule-name").value = rule.name || "前7日点击率";
  node.querySelector(".rule-type").value = rule.type || "ratio";
  node.querySelector(".rule-start-row").value = rule.startRow || 1;
  node.querySelector(".rule-end-row").value = rule.endRow || rule.limit || 7;
  node.querySelector(".rule-format").value = rule.format || "percent";
  node.querySelector(".remove-rule").addEventListener("click", () => {
    node.remove();
    updateRuleCount();
    buildPreview();
  });
  attachDragHandlers(node);

  for (const input of node.querySelectorAll("input, select")) {
    const handleControlChange = () => {
      if (input.classList.contains("rule-type")) updateRuleTypeView(node);
      if (input.classList.contains("rule-numerator-sheet")) updateFieldSelect(node, "numerator");
      if (input.classList.contains("rule-denominator-sheet")) updateFieldSelect(node, "denominator");
      if (input.classList.contains("rule-total-sheet")) updateFieldSelect(node, "total");
      updateRuleCount();
      exportButton.disabled = true;
      resetDownloadLink();
    };
    input.addEventListener("input", handleControlChange);
    input.addEventListener("change", handleControlChange);
  }

  rules.appendChild(node);
  refreshSingleRuleSelects(node, rule);
  updateRuleTypeView(node);
}

function refreshRuleSelects() {
  for (const ruleNode of rules.children) {
    refreshSingleRuleSelects(ruleNode);
  }
}

function refreshSingleRuleSelects(ruleNode, preferred = {}) {
  const defaultNumerator = findDefaultField("点击");
  const defaultDenominator = findDefaultField("曝光");
  const defaultTotal = findDefaultField("花费");

  fillSheetSelect(
    ruleNode.querySelector(".rule-numerator-sheet"),
    preferred.numeratorSheet || defaultNumerator.sheetName
  );
  fillSheetSelect(
    ruleNode.querySelector(".rule-denominator-sheet"),
    preferred.denominatorSheet || defaultDenominator.sheetName || defaultNumerator.sheetName
  );
  fillSheetSelect(
    ruleNode.querySelector(".rule-total-sheet"),
    preferred.totalSheet || defaultTotal.sheetName || defaultNumerator.sheetName
  );

  updateFieldSelect(ruleNode, "numerator", preferred.numerator || defaultNumerator.field);
  updateFieldSelect(ruleNode, "denominator", preferred.denominator || defaultDenominator.field);
  updateFieldSelect(ruleNode, "total", preferred.totalField || defaultTotal.field);
}

function updateRuleTypeView(ruleNode) {
  const type = ruleNode.querySelector(".rule-type").value;
  ruleNode.dataset.ruleType = type;
  const formula = ruleNode.querySelector(".rule-formula");
  formula.textContent =
    type === "total"
      ? "公式：第 X 至第 Y 条数据的「指标 Tab / 字段」求和"
      : "公式：第 X 至第 Y 条数据的「分子 Tab / 字段」求和 ÷「分母 Tab / 字段」求和";
}

function findDefaultField(targetField) {
  for (const sheetName of state.sheetNames) {
    const fields = state.sheetFields[sheetName] || [];
    const exact = fields.find((field) => field === targetField);
    if (exact) return { sheetName, field: exact };
  }
  return {
    sheetName: state.sheetNames[0] || "",
    field: state.sheetFields[state.sheetNames[0]]?.[0] || "",
  };
}

function fillSheetSelect(select, preferredValue) {
  const current = preferredValue || select.value;
  const options = state.sheetNames.map((sheetName) => optionHtml(sheetName, sheetName));
  if (current && !state.sheetNames.includes(current)) {
    options.unshift(optionHtml(current, `${current}（待匹配）`));
  }
  select.innerHTML = options.length ? options.join("") : `<option value="">等待 Tab</option>`;
  if (current && state.sheetNames.includes(current)) select.value = current;
  if (current && !state.sheetNames.includes(current)) select.value = current;
}

function updateFieldSelect(ruleNode, side, preferredValue) {
  const sheetSelect = ruleNode.querySelector(`.rule-${side}-sheet`);
  const fieldSelect = ruleNode.querySelector(side === "total" ? ".rule-total-field" : `.rule-${side}`);
  const fields = state.sheetFields[sheetSelect.value] || [];
  const current = preferredValue || fieldSelect.value;
  const options = fields.map((field) => optionHtml(field, field));
  if (current && !fields.includes(current)) {
    options.unshift(optionHtml(current, `${current}（待匹配）`));
  }
  fieldSelect.innerHTML = options.length ? options.join("") : `<option value="">等待字段</option>`;
  if (current && fields.includes(current)) fieldSelect.value = current;
  if (current && !fields.includes(current)) fieldSelect.value = current;
}

function optionHtml(value, label) {
  return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
}

function getRules() {
  const counts = new Map();
  return getRuleConfigs()
    .map((rule) => {
      const nextCount = (counts.get(rule.name) || 0) + 1;
      counts.set(rule.name, nextCount);
      return {
        ...rule,
        outputName: nextCount === 1 ? rule.name : `${rule.name} (${nextCount})`,
      };
    });
}

function getRuleConfigs() {
  return Array.from(rules.children)
    .map((node) => ({
      name: node.querySelector(".rule-name").value.trim(),
      type: node.querySelector(".rule-type").value,
      startRow: Number(node.querySelector(".rule-start-row").value),
      endRow: Number(node.querySelector(".rule-end-row").value),
      numeratorSheet: node.querySelector(".rule-numerator-sheet").value,
      numerator: node.querySelector(".rule-numerator").value,
      denominatorSheet: node.querySelector(".rule-denominator-sheet").value,
      denominator: node.querySelector(".rule-denominator").value,
      totalSheet: node.querySelector(".rule-total-sheet").value,
      totalField: node.querySelector(".rule-total-field").value,
      format: node.querySelector(".rule-format").value,
    }))
    .filter(
      (rule) =>
        rule.name &&
        rule.startRow > 0 &&
        rule.endRow >= rule.startRow &&
        ((rule.type === "ratio" &&
          rule.numeratorSheet &&
          rule.numerator &&
          rule.denominatorSheet &&
          rule.denominator) ||
          (rule.type === "total" && rule.totalSheet && rule.totalField))
    );
}

function updateRuleCount() {
  ruleCount.textContent = String(getRules().length);
}

function buildPreview() {
  const activeRules = getRules();
  updateRuleCount();

  if (!state.files.length) {
    clearPreview("请先选择文件夹或载入示例数据。");
    return;
  }

  if (!activeRules.length) {
    clearPreview("至少需要一条完整的汇总规则。请检查列名、取数条数、Tab 和字段是否都已选择。");
    return;
  }

  const headers = ["文件名", ...activeRules.map((rule) => rule.outputName)];
  const rows = state.files.map((file) => {
    const row = { 文件名: getDisplayFileName(file) };
    for (const rule of activeRules) {
      row[rule.outputName] = calculateRule(file, rule);
    }
    return row;
  });

  state.previewRows = rows;
  state.previewHeaders = headers;
  state.previewFormats = activeRules.reduce((formats, rule) => {
    formats[rule.outputName] = rule.type === "ratio" ? rule.format : "number";
    return formats;
  }, {});
  renderPreview(headers, rows, state.previewFormats);
  previewHint.textContent = `已生成 ${rows.length} 行预览，更新时间 ${getCurrentTimeLabel()}。字段缺失或分母为 0 的单元格会留空。`;
  exportButton.disabled = rows.length === 0;
  resetDownloadLink();
}

function clearPreview(message) {
  state.previewRows = [];
  state.previewHeaders = [];
  state.previewFormats = {};
  renderPreview([], []);
  previewHint.textContent = message;
  exportButton.disabled = true;
  resetDownloadLink();
}

function calculateRule(file, rule) {
  if (file.error) return "";
  if (rule.type === "total") {
    const rows = getRowsInRange(file, rule.totalSheet, rule);
    return Number(sumField(rows, rule.totalField).toFixed(6));
  }

  const numeratorRows = getRowsInRange(file, rule.numeratorSheet, rule);
  const denominatorRows = getRowsInRange(file, rule.denominatorSheet, rule);
  const numerator = sumField(numeratorRows, rule.numerator);
  const denominator = sumField(denominatorRows, rule.denominator);
  if (!denominator) return "";

  const value = numerator / denominator;
  return rule.format === "percent" ? value : Number(value.toFixed(6));
}

function getSheetRows(file, sheetName) {
  return (file.sheets || []).find((sheet) => sheet.name === sheetName)?.rows || [];
}

function getRowsInRange(file, sheetName, rule) {
  return getSheetRows(file, sheetName).slice(rule.startRow - 1, rule.endRow);
}

function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + parseNumber(row[field]), 0);
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "")
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderPreview(headers, rows, formats = {}) {
  const thead = previewTable.querySelector("thead");
  const tbody = previewTable.querySelector("tbody");

  if (!headers.length || !rows.length) {
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td>暂无预览</td></tr>`;
    return;
  }

  thead.innerHTML = `<tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows
    .slice(0, 20)
    .map((row) => {
      return `<tr>${headers
        .map((header) => `<td>${formatCell(row[header], formats[header])}</td>`)
        .join("")}</tr>`;
    })
    .join("");
}

function formatCell(value, format) {
  if (typeof value === "number" && format === "percent") return `${(value * 100).toFixed(2)}%`;
  if (typeof value === "number") return String(value);
  return escapeHtml(value ?? "");
}

function exportWorkbook() {
  if (!state.previewRows.length || !window.XLSX) return;

  const activeRules = getRules();
  const headers = state.previewHeaders.length
    ? state.previewHeaders
    : ["文件名", ...activeRules.map((rule) => rule.outputName)];
  const exportRows = state.previewRows.map((row) => {
    return headers.reduce((object, header) => {
      object[header] = row[header] ?? "";
      return object;
    }, {});
  });

  const sheet = XLSX.utils.json_to_sheet(exportRows, { header: headers });
  activeRules.forEach((rule) => {
    if (rule.format !== "percent") return;
    const columnIndex = headers.indexOf(rule.outputName);
    if (columnIndex === -1) return;
    const column = XLSX.utils.encode_col(columnIndex);
    for (let row = 2; row <= exportRows.length + 1; row += 1) {
      const cell = sheet[`${column}${row}`];
      if (cell && typeof cell.v === "number") cell.z = "0.00%";
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "汇总");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, "excel-integration-analysis-summary.xlsx");
}

function triggerDownload(blob, filename) {
  resetDownloadLink();
  state.downloadUrl = URL.createObjectURL(blob);
  downloadLink.href = state.downloadUrl;
  downloadLink.download = filename;
  downloadLink.hidden = false;
  downloadLink.click();
  previewHint.textContent = `已生成下载文件，时间 ${getCurrentTimeLabel()}。如果没有自动下载，请点击“下载已生成文件”。`;
}

function resetDownloadLink() {
  if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
  state.downloadUrl = "";
  downloadLink.hidden = true;
  downloadLink.removeAttribute("href");
}

function loadSampleData() {
  setLoadedFiles([
    {
      name: "华东_第01批.xlsx",
      sheets: [
        createSampleSheet("投放数据", ["日期", "曝光", "点击"], 10, (index) => ({
          日期: `2026-06-${String(index + 1).padStart(2, "0")}`,
          曝光: 1000 + index * 70,
          点击: 80 + index * 6,
        })),
        createSampleSheet("成本数据", ["日期", "花费", "成交"], 10, (index) => ({
          日期: `2026-06-${String(index + 1).padStart(2, "0")}`,
          花费: 320 + index * 18,
          成交: 9 + index,
        })),
      ],
      error: "",
    },
    {
      name: "华南_第02批.xlsx",
      sheets: [
        createSampleSheet("投放数据", ["日期", "曝光", "点击"], 10, (index) => ({
          日期: `2026-06-${String(index + 1).padStart(2, "0")}`,
          曝光: 1300 + index * 55,
          点击: 91 + index * 5,
        })),
        createSampleSheet("成本数据", ["日期", "花费", "成交"], 10, (index) => ({
          日期: `2026-06-${String(index + 1).padStart(2, "0")}`,
          花费: 410 + index * 22,
          成交: 10 + index,
        })),
      ],
      error: "",
    },
  ]);
}

function createSampleSheet(name, headers, rowCount, rowFactory) {
  return {
    name,
    headers,
    rows: Array.from({ length: rowCount }, (_, index) => rowFactory(index)),
    error: "",
  };
}

function attachDragHandlers(ruleNode) {
  ruleNode.addEventListener("dragstart", (event) => {
    if (!event.target.closest(".drag-handle")) {
      event.preventDefault();
      return;
    }
    ruleNode.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "");
  });

  ruleNode.addEventListener("dragend", () => {
    ruleNode.classList.remove("dragging");
    for (const card of rules.querySelectorAll(".drag-over")) {
      card.classList.remove("drag-over");
    }
    buildPreview();
  });
}

rules.addEventListener("dragover", (event) => {
  event.preventDefault();
  const dragging = rules.querySelector(".dragging");
  const target = event.target.closest(".rule-card");
  if (!dragging || !target || dragging === target) return;

  const targetBox = target.getBoundingClientRect();
  const insertAfter = event.clientY > targetBox.top + targetBox.height / 2;
  for (const card of rules.querySelectorAll(".drag-over")) {
    card.classList.remove("drag-over");
  }
  target.classList.add("drag-over");
  rules.insertBefore(dragging, insertAfter ? target.nextSibling : target);
});

rules.addEventListener("dragleave", (event) => {
  const target = event.target.closest(".rule-card");
  if (target) target.classList.remove("drag-over");
});

function getDisplayFileName(file) {
  return file.displayName || stripFileExtension(file.name || "");
}

function stripFileExtension(name) {
  return String(name).replace(/\.[^.\\/]+$/u, "");
}

function getCurrentTimeLabel() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function setMessage(message) {
  loadHint.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

ensureDefaultRule();
updateRuleCount();
initAuth();
