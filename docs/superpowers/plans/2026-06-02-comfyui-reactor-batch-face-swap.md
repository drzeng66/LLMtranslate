# ComfyUI ReActor Batch Face Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install ComfyUI and ReActor under `D:\ComfyUI`, create a repeatable single-reference-face workflow, and validate that batch outputs preserve Tibetan headwear and hairstyles.

**Architecture:** Use the official ComfyUI Windows portable NVIDIA package with Python 3.12/CUDA 12.6 for custom-node compatibility. Install the official ReActor custom node, its masking assets, and a face restoration model. Build the API workflow only after reading the installed `/object_info` schema, because ReActor node inputs may change between releases.

**Tech Stack:** ComfyUI portable, Python 3.12 portable runtime, ReActor, ONNX models, SAM, Ultralytics face detector, PowerShell, Python requests

---

## File Structure

- Create: `work/comfyui/install_comfyui_reactor.ps1` — idempotent installer.
- Create: `work/comfyui/start_comfyui.ps1` — hidden local launcher.
- Create: `work/comfyui/inspect_reactor_schema.py` — fetch installed node schema.
- Create: `work/comfyui/build_reactor_workflow.py` — write workflow after schema inspection.
- Create: `work/comfyui/queue_faceswap_batch.py` — queue target JPG files and record outcomes.
- Create: `work/comfyui/tests/test_batch_inventory.py` — excludes references and outputs from target scan.
- Create at runtime: `outputs/reactor-object-info.json`
- Create at runtime: `outputs/reactor-tibetan-costume-workflow-api.json`
- Create at runtime: `D:\照片\换脸结果\logs\batch-results.jsonl`

### Task 1: Install ComfyUI portable and ReActor

**Files:**
- Create: `work/comfyui/install_comfyui_reactor.ps1`

- [ ] **Step 1: Add an idempotent installer**

The script must:

1. download the official NVIDIA Python 3.12/CUDA 12.6 portable archive linked from the official ComfyUI repository;
2. extract to `D:\ComfyUI`;
3. clone `https://github.com/Gourieff/ComfyUI-ReActor` into `D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI-ReActor`;
4. run the repository's `install.bat`;
5. create model directories:

```powershell
$modelRoot = 'D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\models'
@(
  "$modelRoot\insightface",
  "$modelRoot\ultralytics\bbox",
  "$modelRoot\sams",
  "$modelRoot\facerestore_models"
) | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }
```

6. download:
   - `face_yolov8m.pt` into `models\ultralytics\bbox`;
   - `sam_vit_l_0b3195.pth` into `models\sams`;
   - `codeformer-v0.1.0.pth` into `models\facerestore_models`;
7. leave `buffalo_l` and `inswapper_128.onnx` to the ReActor-supported installation or first-launch process;
8. print installed paths and SHA256 hashes.

- [ ] **Step 2: Execute installer with escalation**

Run with approval because this downloads software and writes to `D:\ComfyUI`:

```powershell
powershell -ExecutionPolicy Bypass -File work\comfyui\install_comfyui_reactor.ps1
```

- [ ] **Step 3: Verify installation structure**

Run:

```powershell
Test-Path 'D:\ComfyUI\ComfyUI_windows_portable\run_nvidia_gpu.bat'
Test-Path 'D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI-ReActor'
```

Expected: both values are `True`.

### Task 2: Start ComfyUI locally and inspect ReActor schema

**Files:**
- Create: `work/comfyui/start_comfyui.ps1`
- Create: `work/comfyui/inspect_reactor_schema.py`

- [ ] **Step 1: Add hidden launcher**

```powershell
$portable = 'D:\ComfyUI\ComfyUI_windows_portable'
$python = Join-Path $portable 'python_embeded\python.exe'
$main = Join-Path $portable 'ComfyUI\main.py'
Start-Process -FilePath $python -WindowStyle Hidden -WorkingDirectory (Join-Path $portable 'ComfyUI') `
  -ArgumentList @($main, '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch')
```

- [ ] **Step 2: Add schema inspection**

```python
import json
from pathlib import Path
from urllib.request import urlopen

URL = "http://127.0.0.1:8188/object_info"
OUTPUT = Path(r"C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\outputs\reactor-object-info.json")

with urlopen(URL, timeout=20) as response:
    object_info = json.load(response)

reactor = {name: value for name, value in object_info.items() if "reactor" in name.lower()}
if not reactor:
    raise SystemExit("ReActor nodes were not loaded")
OUTPUT.write_text(json.dumps(reactor, ensure_ascii=False, indent=2), encoding="utf-8")
print("\n".join(sorted(reactor)))
```

- [ ] **Step 3: Start and inspect**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File work\comfyui\start_comfyui.ps1
python work\comfyui\inspect_reactor_schema.py
```

Expected: node names include a ReActor face-swap node, masking helper, restoration node, and similarity node.

### Task 3: Build a current-schema API workflow

**Files:**
- Create: `work/comfyui/build_reactor_workflow.py`
- Create at runtime: `outputs/reactor-tibetan-costume-workflow-api.json`

- [ ] **Step 1: Read exact installed node inputs**

Inspect:

```powershell
Get-Content outputs\reactor-object-info.json
```

Use the exact class names and required input keys exposed by the installed version. Do not copy an obsolete workflow.

- [ ] **Step 2: Build the workflow**

Create a workflow containing these components:

```text
LoadImage(target JPG)
LoadImage(reference face me0.jpg)
ReActor face swap: source face index 0, input face index 0
ReActor masking helper: face_yolov8m.pt + sam_vit_l_0b3195.pth
ReActor light restoration: codeformer-v0.1.0.pth
ReActor similarity check
SaveImage(prefix reactor_tibetan)
```

Write the API graph to:

```text
outputs/reactor-tibetan-costume-workflow-api.json
```

The script must reject any graph that lacks a SaveImage node or routes output outside the dedicated result directory.

- [ ] **Step 3: Copy inputs into ComfyUI input staging**

Copy:

```text
D:\照片\参考脸\me0.jpg
→ D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\input\reference\me0.jpg
```

For sample targets, copy three JPG files selected from `D:\照片` into:

```text
D:\ComfyUI\ComfyUI_windows_portable\ComfyUI\input\targets
```

### Task 4: Add batch inventory and queue tests

**Files:**
- Create: `work/comfyui/queue_faceswap_batch.py`
- Create: `work/comfyui/tests/test_batch_inventory.py`

- [ ] **Step 1: Write failing inventory test**

```python
from pathlib import Path
from queue_faceswap_batch import discover_targets

def test_discover_targets_excludes_reference_and_results(tmp_path: Path) -> None:
    (tmp_path / "a.jpg").write_bytes(b"x")
    (tmp_path / "参考脸").mkdir()
    (tmp_path / "参考脸" / "me0.jpg").write_bytes(b"x")
    (tmp_path / "换脸结果").mkdir()
    (tmp_path / "换脸结果" / "out.jpg").write_bytes(b"x")
    assert [p.name for p in discover_targets(tmp_path)] == ["a.jpg"]
```

- [ ] **Step 2: Add minimal discovery implementation**

```python
from pathlib import Path

EXCLUDED = {"参考脸", "换脸结果"}

def discover_targets(root: Path) -> list[Path]:
    return sorted(
        path for path in root.rglob("*.jpg")
        if not any(part in EXCLUDED for part in path.relative_to(root).parts[:-1])
    )
```

- [ ] **Step 3: Run tests**

Run:

```powershell
python -m pytest work\comfyui\tests -v
```

Expected: PASS.

### Task 5: Validate three representative samples before batch execution

**Files:**
- Use: `outputs/reactor-tibetan-costume-workflow-api.json`
- Create: `D:\照片\换脸结果\logs\sample-results.jsonl`

- [ ] **Step 1: Queue three samples**

Select:

1. one photo near the reference half-profile angle;
2. one mostly frontal photo;
3. one photo with prominent Tibetan headwear.

- [ ] **Step 2: Inspect output visually**

Acceptance criteria:

- facial identity changed toward `me0.jpg`;
- Tibetan headwear, hairstyle, braids, clothing, body pose, and background remain visually unchanged;
- face boundary does not visibly leak into headwear;
- output JPG opens successfully.

- [ ] **Step 3: Adjust only face-local settings if needed**

Allowed changes:

- swap weight;
- restoration visibility;
- CodeFormer fidelity weight;
- face-mask expansion or feathering.

Do not enable full-image generative redraw during the first batch.

### Task 6: Execute batch and generate review log

**Files:**
- Modify: `work/comfyui/queue_faceswap_batch.py`
- Create: `D:\照片\换脸结果\logs\batch-results.jsonl`

- [ ] **Step 1: Queue one photo at a time**

For every discovered target:

1. stage the file in ComfyUI input;
2. update only the target LoadImage input;
3. submit the graph to `POST /prompt`;
4. poll `/history/{prompt_id}`;
5. copy successful output to `D:\照片\换脸结果`;
6. append a JSONL record with source, output, status, elapsed time, and similarity when available;
7. preserve the original JPG.

- [ ] **Step 2: Run batch**

Run:

```powershell
python work\comfyui\queue_faceswap_batch.py --root 'D:\照片' --output 'D:\照片\换脸结果'
```

- [ ] **Step 3: Verify results**

Confirm:

- original JPG count did not decrease;
- each successful target has a separate output;
- failed files are listed in `batch-results.jsonl`;
- low-similarity or visually questionable files are copied into a review list.

## Review Checkpoint

Stop after sample validation if Tibetan headwear or hairstyle is visibly altered. Do not run the full batch until the face-local mask settings pass visual review.
