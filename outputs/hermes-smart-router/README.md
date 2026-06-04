# Hermes Smart Router

本地 OpenAI-compatible 代理：普通文本任务走本地 llama.cpp，复杂/多模态/深度推理/本地失败自动升级到 5.5。

## 端点

- Router: `http://127.0.0.1:8788/v1`
- Model: `hermes-smart-router`
- 强制本地：`hermes-smart-router:local`
- 强制强模型：`hermes-smart-router:strong`

## 默认后端

- 本地：Hermes custom provider `llamaccp`，模型覆盖为 `gemma.gguf`
- 强模型：Hermes custom provider `Api.apikey.fun`，模型 `gpt-5.5`

## 启动

```powershell
C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\hermes-smart-router\scripts\start-router.ps1
```

## 切换 Hermes 主模型到 Router

```powershell
C:\Users\zengxiaofeng\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\hermes-smart-router\scripts\configure_hermes.py
```

脚本会先备份 `C:\Users\zengxiaofeng\AppData\Local\hermes\config.yaml`。

## 路由规则

走本地：翻译、总结、改写、信息提取、分类、普通 JSON、RSS/新闻整理。

走 5.5：多模态/图片、深度推理、复杂架构、复杂调试、跨文件重构、高风险医学/法律/财务判断、长上下文接近本地上限。

本地返回上下文超限、429、5xx 或超时，会自动 fallback 到 5.5。

## 兼容性说明

- Hermes 经常用 `stream=true` 调用模型；Router 内部为了自动 fallback 会先用非流式请求后端，再转换成 OpenAI SSE 流式响应返回给 Hermes。
- 路由判断优先看用户消息，不会因为 Hermes 系统提示或工具说明里出现“图像/图片”等词就误判为多模态任务。
- 如需临时排错，可设置环境变量 `HERMES_ROUTER_DEBUG_LOG=某个日志路径`。日志仅记录路由、状态码、消息数量、工具数量等脱敏元数据，不记录正文和密钥。
