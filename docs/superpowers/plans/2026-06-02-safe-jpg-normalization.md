# Safe JPG Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert supported non-JPG photos under `D:\照片` to maximum-quality JPG files and delete each original only after the replacement JPG passes validation.

**Architecture:** A focused Python command-line tool separates discovery, conversion, validation, and deletion. It writes a temporary JPG beside the source, validates that file by reopening it, atomically renames it to the final `.jpg`, and only then deletes the original when `--delete-originals` is explicitly passed. JSONL logging records every decision.

**Tech Stack:** Python 3.11, Pillow, pillow-heif, pytest, PowerShell

---

## File Structure

- Create: `work/photo_pipeline/convert_to_jpg.py` — conversion CLI and safety rules.
- Create: `work/photo_pipeline/tests/test_convert_to_jpg.py` — unit tests for discovery, validation, conflict handling, and deletion.
- Create: `work/photo_pipeline/requirements.txt` — local Python dependencies.
- Create: `work/photo_pipeline/run_conversion.ps1` — repeatable PowerShell launcher.
- Create at runtime: `outputs/photo-conversion-log.jsonl` — user-facing audit log.

### Task 1: Write discovery and target-path tests

**Files:**
- Create: `work/photo_pipeline/tests/test_convert_to_jpg.py`
- Create: `work/photo_pipeline/convert_to_jpg.py`

- [ ] **Step 1: Write failing tests for discovery**

```python
from pathlib import Path
from PIL import Image
from convert_to_jpg import discover_candidates

def save_png(path: Path) -> None:
    Image.new("RGB", (32, 24), (20, 40, 60)).save(path, format="PNG")

def test_discovery_excludes_existing_jpg_reference_and_output(tmp_path: Path) -> None:
    save_png(tmp_path / "photo.png")
    Image.new("RGB", (32, 24)).save(tmp_path / "existing.jpg")
    (tmp_path / "参考脸").mkdir()
    save_png(tmp_path / "参考脸" / "face.png")
    (tmp_path / "换脸结果").mkdir()
    save_png(tmp_path / "换脸结果" / "result.png")
    assert [p.name for p in discover_candidates(tmp_path)] == ["photo.png"]
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
python -m pytest work\photo_pipeline\tests\test_convert_to_jpg.py -v
```

Expected: FAIL because `convert_to_jpg` does not exist.

- [ ] **Step 3: Add discovery implementation**

```python
from __future__ import annotations
from pathlib import Path

SUPPORTED = {".heic", ".heif", ".png", ".jpeg", ".jpe", ".jfif", ".bmp", ".tif", ".tiff", ".webp", ".avif"}
EXCLUDED_DIRS = {"参考脸", "换脸结果"}

def discover_candidates(root: Path) -> list[Path]:
    return sorted(
        path for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in SUPPORTED
        and not any(part in EXCLUDED_DIRS for part in path.relative_to(root).parts[:-1])
    )
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```powershell
python -m pytest work\photo_pipeline\tests\test_convert_to_jpg.py -v
```

Expected: PASS.

### Task 2: Implement validated maximum-quality conversion

**Files:**
- Modify: `work/photo_pipeline/convert_to_jpg.py`
- Modify: `work/photo_pipeline/tests/test_convert_to_jpg.py`

- [ ] **Step 1: Add failing conversion tests**

```python
from convert_to_jpg import convert_one

def test_convert_one_preserves_dimensions_and_deletes_only_after_validation(tmp_path: Path) -> None:
    source = tmp_path / "photo.png"
    save_png(source)
    event = convert_one(source, delete_original=True)
    target = tmp_path / "photo.jpg"
    assert event["status"] == "converted"
    assert target.exists()
    assert not source.exists()
    with Image.open(target) as image:
        assert image.size == (32, 24)
        assert image.format == "JPEG"

def test_convert_one_does_not_overwrite_existing_jpg(tmp_path: Path) -> None:
    source = tmp_path / "photo.png"
    save_png(source)
    Image.new("RGB", (8, 8)).save(tmp_path / "photo.jpg")
    event = convert_one(source, delete_original=True)
    assert event["status"] == "conflict"
    assert source.exists()

def test_convert_one_keeps_invalid_original(tmp_path: Path) -> None:
    source = tmp_path / "broken.png"
    source.write_bytes(b"not an image")
    event = convert_one(source, delete_original=True)
    assert event["status"] == "failed"
    assert source.exists()
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
python -m pytest work\photo_pipeline\tests\test_convert_to_jpg.py -v
```

Expected: FAIL because `convert_one` is undefined.

- [ ] **Step 3: Add the conversion implementation**

```python
import os
from PIL import Image, ImageOps

def convert_one(source: Path, delete_original: bool) -> dict[str, str]:
    target = source.with_suffix(".jpg")
    temp = source.with_name(source.stem + ".__converting__.jpg")
    event = {"source": str(source), "target": str(target)}
    if target.exists():
        return {**event, "status": "conflict", "reason": "target_exists"}
    try:
        with Image.open(source) as opened:
            original_size = opened.size
            exif = opened.info.get("exif")
            image = ImageOps.exif_transpose(opened).convert("RGB")
            save_options = {"format": "JPEG", "quality": 100, "subsampling": 0, "optimize": False}
            if exif:
                save_options["exif"] = exif
            image.save(temp, **save_options)
        with Image.open(temp) as checked:
            checked.load()
            if checked.format != "JPEG" or checked.size != original_size or checked.width < 1 or checked.height < 1:
                raise ValueError("replacement JPG validation failed")
        os.replace(temp, target)
        if delete_original:
            source.unlink()
        return {**event, "status": "converted", "original_deleted": str(delete_original).lower()}
    except Exception as exc:
        temp.unlink(missing_ok=True)
        return {**event, "status": "failed", "reason": f"{type(exc).__name__}: {exc}"}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```powershell
python -m pytest work\photo_pipeline\tests\test_convert_to_jpg.py -v
```

Expected: PASS.

### Task 3: Add HEIC registration, JSONL logging, and CLI

**Files:**
- Modify: `work/photo_pipeline/convert_to_jpg.py`
- Create: `work/photo_pipeline/requirements.txt`
- Create: `work/photo_pipeline/run_conversion.ps1`

- [ ] **Step 1: Add dependencies**

```text
Pillow==12.2.0
pillow-heif==1.3.0
pytest>=8,<9
```

- [ ] **Step 2: Add HEIC registration and CLI**

Append:

```python
import argparse
import json
from pillow_heif import register_heif_opener

def main() -> int:
    register_heif_opener()
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--delete-originals", action="store_true")
    args = parser.parse_args()
    args.log.parent.mkdir(parents=True, exist_ok=True)
    events = [convert_one(path, args.delete_originals) for path in discover_candidates(args.root)]
    with args.log.open("w", encoding="utf-8") as stream:
        for event in events:
            stream.write(json.dumps(event, ensure_ascii=False) + "\n")
    counts = {status: sum(event["status"] == status for event in events) for status in ("converted", "conflict", "failed")}
    print(json.dumps({"root": str(args.root), "total": len(events), **counts}, ensure_ascii=False))
    return 1 if counts["failed"] else 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Add launcher**

```powershell
$ErrorActionPreference = 'Stop'
$workspace = 'C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg'
$deps = Join-Path $workspace 'work\pydeps'
$env:PYTHONPATH = $deps
python (Join-Path $workspace 'work\photo_pipeline\convert_to_jpg.py') `
  --root 'D:\照片' `
  --log (Join-Path $workspace 'outputs\photo-conversion-log.jsonl') `
  --delete-originals
```

- [ ] **Step 4: Run complete test suite**

Run:

```powershell
$env:PYTHONPATH='C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\work\pydeps'
python -m pytest work\photo_pipeline\tests -v
```

Expected: PASS.

### Task 4: Execute safely against `D:\照片`

**Files:**
- Run: `work/photo_pipeline/run_conversion.ps1`
- Inspect: `outputs/photo-conversion-log.jsonl`

- [ ] **Step 1: Run a discovery-only count before mutation**

Run:

```powershell
$env:PYTHONPATH='C:\Users\zengxiaofeng\Documents\Codex\2026-06-02\d-jip-jpg\work\pydeps'
python -c "from pathlib import Path; from pillow_heif import register_heif_opener; register_heif_opener(); from work.photo_pipeline.convert_to_jpg import discover_candidates; print(len(discover_candidates(Path(r'D:\照片'))))"
```

Expected: `50`.

- [ ] **Step 2: Run conversion with deletion approval**

Run with sandbox escalation because this writes to `D:\照片` and deletes originals:

```powershell
powershell -ExecutionPolicy Bypass -File work\photo_pipeline\run_conversion.ps1
```

Expected: JSON summary with `total: 50`, `failed: 0`, and no unreviewed conflicts.

- [ ] **Step 3: Verify postconditions**

Run:

```powershell
$files = Get-ChildItem -LiteralPath 'D:\照片' -File -Force
$files | Group-Object Extension | Sort-Object Count -Descending | Format-Table Count,Name -AutoSize
```

Expected: target photos use `.jpg`; the reference folder remains untouched; no converted source extension remains in the top-level target set.

- [ ] **Step 4: Preserve audit output**

Confirm that `outputs/photo-conversion-log.jsonl` contains 50 JSON lines and that each line has `status`, `source`, and `target`.

## Review Checkpoint

Stop after this plan. Review the JPG inventory and audit log before starting ComfyUI installation.
