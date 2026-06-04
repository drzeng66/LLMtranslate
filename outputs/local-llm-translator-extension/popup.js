import { DEFAULT_SETTINGS, normalizeSettings } from "./lib/translator-core.js";

const status = document.getElementById("status");
const endpointLabel = document.getElementById("endpoint-label");

function setStatus(text) { status.textContent = text; }

async function send(message) {
  return await chrome.runtime.sendMessage(message);
}

async function activeCommand(command, extra = {}) {
  setStatus("正在发送命令…");
  const response = await send({ type: "ACTIVE_TAB_COMMAND", command, extra });
  setStatus(response?.ok ? "命令已执行" : `执行失败：${response?.error || "未知错误"}`);
}

async function init() {
  const settings = normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
  endpointLabel.textContent = settings.endpointMode === "remote" ? "远程 FRP" : settings.endpointMode === "custom" ? "自定义" : "本机";
}

document.getElementById("translate-page").addEventListener("click", () => activeCommand("TOGGLE_TRANSLATION"));
document.getElementById("clear-page").addEventListener("click", () => activeCommand("CLEAR_TRANSLATIONS"));
document.getElementById("document-translate").addEventListener("click", async () => {
  await send({ type: "OPEN_DOCUMENT_TRANSLATOR" });
  setStatus("已打开文档翻译页");
});
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("test").addEventListener("click", async () => {
  setStatus("正在测试连接…");
  const response = await send({ type: "TEST_CONNECTION" });
  setStatus(response?.ok ? `连接成功\n${response.models.join("\n") || "未列出模型"}` : `连接失败：${response?.error || "未知错误"}`);
});

init().catch((error) => setStatus(error.message));
