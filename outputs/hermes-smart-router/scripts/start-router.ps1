param(
  [string]$HostName = "127.0.0.1",
  [int]$Port = 8788
)
$ErrorActionPreference = "Stop"
$RouterRoot = Split-Path -Parent $PSScriptRoot
$HermesPython = "C:\Users\zengxiaofeng\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
$env:HERMES_AGENT_DIR = "C:\Users\zengxiaofeng\AppData\Local\hermes\hermes-agent"
$env:HERMES_ROUTER_HOST = $HostName
$env:HERMES_ROUTER_PORT = [string]$Port
$env:HERMES_ROUTER_LOCAL_PROVIDER = "llamaccp"
# 当前 llama.cpp /v1/models 显示模型 ID 是 gemma.gguf；覆盖 Hermes 里旧的 glm.gguf 名称。
$env:HERMES_ROUTER_LOCAL_MODEL = "gemma.gguf"
$env:HERMES_ROUTER_STRONG_PROVIDER = "Api.apikey.fun"
$env:HERMES_ROUTER_STRONG_MODEL = "gpt-5.5"
& $HermesPython (Join-Path $RouterRoot "router.py")
