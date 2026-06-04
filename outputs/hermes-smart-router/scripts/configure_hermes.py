#!/usr/bin/env python3
"""Safely switch Hermes main model to the local smart router.

Creates a timestamped backup next to config.yaml before editing.
"""

from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path

CONFIG = Path(r"C:\Users\zengxiaofeng\AppData\Local\hermes\config.yaml")
ROUTER_BLOCK = '''model:
  default: "hermes-smart-router"
  provider: "hermes-smart-router"
  base_url: "http://127.0.0.1:8788/v1"
  api_key: "dummy-key"
  api_mode: "chat_completions"
  context_length: 64000
'''
ROUTER_PROVIDER_ENTRY = [
    "- name: hermes-smart-router",
    "  base_url: http://127.0.0.1:8788/v1",
    "  api_key: dummy-key",
    "  model: hermes-smart-router",
    "  api_mode: chat_completions",
    "  models:",
    "    hermes-smart-router:",
    "      context_length: 64000",
]


def replace_model_block(text: str) -> str:
    pattern = re.compile(r"(?m)^model:\n(?:^  [^\n]*\n)*")
    if not pattern.search(text):
        return ROUTER_BLOCK + "\n" + text
    return pattern.sub(ROUTER_BLOCK, text, count=1)


def ensure_local_model_name(text: str) -> str:
    lines = text.splitlines()
    in_llama = False
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("- name:"):
            in_llama = stripped.lower() == "- name: llamaccp"
        if in_llama and stripped.startswith("model:"):
            indent = line[: len(line) - len(line.lstrip())]
            out.append(f'{indent}model: gemma.gguf')
            continue
        out.append(line)
    return "\n".join(out) + ("\n" if text.endswith("\n") else "")


def remove_existing_router_entry(lines: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(lines):
        if lines[i].strip().lower() == "- name: hermes-smart-router":
            i += 1
            while i < len(lines):
                stripped = lines[i].strip()
                if stripped.startswith("- name:") or (stripped and not lines[i].startswith(" ") and not lines[i].startswith("-")):
                    break
                i += 1
            continue
        out.append(lines[i])
        i += 1
    return out


def ensure_router_custom_provider(text: str) -> str:
    trailing_newline = text.endswith("\n")
    lines = remove_existing_router_entry(text.splitlines())
    for idx, line in enumerate(lines):
        if line.strip() == "custom_providers:":
            lines = lines[: idx + 1] + ROUTER_PROVIDER_ENTRY + lines[idx + 1 :]
            return "\n".join(lines) + ("\n" if trailing_newline else "")
    return "\n".join(lines).rstrip() + "\ncustom_providers:\n" + "\n".join(ROUTER_PROVIDER_ENTRY) + "\n"


def main() -> None:
    text = CONFIG.read_text(encoding="utf-8")
    backup = CONFIG.with_name(f"config.yaml.bak_smart_router_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    shutil.copy2(CONFIG, backup)
    new_text = ensure_router_custom_provider(ensure_local_model_name(replace_model_block(text)))
    CONFIG.write_text(new_text, encoding="utf-8")
    print(f"backup={backup}")
    print("model.default=hermes-smart-router")
    print("model.provider=hermes-smart-router")
    print("model.base_url=http://127.0.0.1:8788/v1")


if __name__ == "__main__":
    main()

