#!/usr/bin/env python3
"""Validate the portable Raxi asset library."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "content" / "asset-library" / "ASSET_CATALOG.json"
CONTENT_DIR = ROOT / "content"

ASSET_ID_RE = re.compile(r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$")
WINDOWS_ABS_RE = re.compile(r"^[A-Za-z]:\\")
LOCAL_PATH_RE = re.compile(r"C:\\Users\\", re.IGNORECASE)
ALLOWED_QA = {
    "APPROVED",
    "APPROVED_WITH_CAUTION",
    "APPROVED_WITH_COPY_DIRECTION",
    "REGENERATE",
    "REWRITE",
    "REJECT",
    "VISUAL_REVIEW_REQUIRED",
    "PENDING",
}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def load_catalog(errors: list[str]) -> list[dict]:
    try:
        data = json.loads(CATALOG.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(errors, f"Missing catalog: {CATALOG.relative_to(ROOT)}")
        return []
    except json.JSONDecodeError as exc:
        fail(errors, f"Invalid JSON: {exc}")
        return []

    if not isinstance(data, list):
        fail(errors, "Catalog root must be a list of asset objects.")
        return []
    return data


def validate_catalog(assets: list[dict], errors: list[str]) -> None:
    seen: set[str] = set()
    for index, asset in enumerate(assets, start=1):
        if not isinstance(asset, dict):
            fail(errors, f"Entry {index} must be an object.")
            continue

        asset_id = asset.get("asset_id")
        if not isinstance(asset_id, str) or not ASSET_ID_RE.match(asset_id):
            fail(errors, f"Entry {index} has invalid asset_id: {asset_id!r}")
            continue
        if asset_id in seen:
            fail(errors, f"Duplicate asset_id: {asset_id}")
        seen.add(asset_id)

        repo_path = asset.get("repo_path")
        if not isinstance(repo_path, str) or not repo_path:
            fail(errors, f"{asset_id}: repo_path must be a non-empty string.")
        else:
            if os.path.isabs(repo_path) or WINDOWS_ABS_RE.search(repo_path):
                fail(errors, f"{asset_id}: repo_path must be relative, got {repo_path!r}.")
            if LOCAL_PATH_RE.search(repo_path):
                fail(errors, f"{asset_id}: repo_path contains a local machine path.")
            if not (ROOT / repo_path).exists():
                fail(errors, f"{asset_id}: repo_path does not exist: {repo_path}")

        qa_status = asset.get("qa_status")
        if qa_status not in ALLOWED_QA:
            fail(errors, f"{asset_id}: unknown qa_status: {qa_status!r}")

        supermemory_id = asset.get("supermemory_document_id")
        if supermemory_id is not None and not isinstance(supermemory_id, str):
            fail(errors, f"{asset_id}: supermemory_document_id must be string or null.")

        serialized = json.dumps(asset, ensure_ascii=False)
        if LOCAL_PATH_RE.search(serialized):
            fail(errors, f"{asset_id}: catalog entry contains a C:\\Users\\ path.")


def scan_content(errors: list[str]) -> None:
    if not CONTENT_DIR.exists():
        return
    for path in CONTENT_DIR.rglob("*"):
        if not path.is_file():
            continue
        if path == CONTENT_DIR / "asset-library" / "README.md":
            continue
        if path.suffix.lower() not in {".md", ".json", ".txt", ".csv"}:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = path.read_text(encoding="utf-8", errors="ignore")
        if LOCAL_PATH_RE.search(text):
            fail(errors, f"Local Windows path found in content file: {path.relative_to(ROOT)}")


def main() -> int:
    errors: list[str] = []
    assets = load_catalog(errors)
    validate_catalog(assets, errors)
    scan_content(errors)

    if errors:
        print("Asset library validation FAILED:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(f"Asset library validation passed: {len(assets)} assets checked.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
