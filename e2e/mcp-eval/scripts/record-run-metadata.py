#!/usr/bin/env python3
"""Write mcp-eval run metadata and enrich results.json with the resolved LLM model."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


def pass_fail_counts(results: object) -> tuple[int | None, int | None]:
    """Best-effort pass/fail from mcp-eval JSON (schema varies by version)."""
    tasks: list = []
    if isinstance(results, dict):
        for key in ("tasks", "results", "test_results", "evaluations"):
            val = results.get(key)
            if isinstance(val, list):
                tasks = val
                break
        if not tasks and isinstance(results.get("summary"), dict):
            s = results["summary"]
            passed = s.get("passed", s.get("pass", s.get("success")))
            failed = s.get("failed", s.get("fail", s.get("failures")))
            if isinstance(passed, int) and isinstance(failed, int):
                return passed, failed
    elif isinstance(results, list):
        tasks = results

    if not tasks:
        return None, None

    passed = failed = 0
    for task in tasks:
        if not isinstance(task, dict):
            continue
        status = str(task.get("status") or task.get("result") or task.get("outcome") or "").lower()
        if status in ("passed", "pass", "success", "ok", "true"):
            passed += 1
        elif status in ("failed", "fail", "error", "false"):
            failed += 1
        elif task.get("passed") is True:
            passed += 1
        elif task.get("passed") is False:
            failed += 1
    return passed, failed


def artifact_slug(provider: str, model: str) -> str:
    raw = f"{provider}-{model}".lower()
    return re.sub(r"[^a-z0-9._-]+", "-", raw).strip("-")[:180] or "unknown"


def main() -> int:
    reports_dir = Path(os.environ.get("REPORTS_DIR", "reports"))
    reports_dir.mkdir(parents=True, exist_ok=True)

    meta = {
        "llm_provider": os.environ.get("LLM_PROVIDER", ""),
        "llm_model": os.environ.get("LLM_MODEL", ""),
        "llm_base_url": os.environ.get("LLM_BASE_URL", ""),
        "openproject_url": os.environ.get("OPENPROJECT_URL", ""),
    }

    meta_path = reports_dir / "run-metadata.json"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {meta_path}")

    results_path = reports_dir / "results.json"
    passed = failed = None
    if results_path.is_file():
        try:
            data = json.loads(results_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"Warning: could not parse {results_path}: {e}", file=sys.stderr)
            data = None
        if isinstance(data, dict):
            data["run"] = meta
            results_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
            print(f"Enriched {results_path} with run metadata")
            passed, failed = pass_fail_counts(data)
        elif isinstance(data, list):
            wrapped = {"run": meta, "tasks": data}
            results_path.write_text(json.dumps(wrapped, indent=2) + "\n", encoding="utf-8")
            print(f"Wrapped {results_path} list with run metadata")
            passed, failed = pass_fail_counts(data)

    slug = artifact_slug(meta["llm_provider"], meta["llm_model"])
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as f:
            f.write(f"artifact_slug={slug}\n")
            if passed is not None:
                f.write(f"passed={passed}\n")
            if failed is not None:
                f.write(f"failed={failed}\n")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### MCP-eval results\n\n")
            f.write(f"- Provider: `{meta['llm_provider']}`\n")
            f.write(f"- Model: `{meta['llm_model']}`\n")
            f.write(f"- Base URL: `{meta['llm_base_url']}`\n")
            if meta["openproject_url"]:
                f.write(f"- OpenProject: {meta['openproject_url']}\n")
            if passed is not None and failed is not None:
                f.write(f"- Passed: {passed}, Failed: {failed}\n")
            f.write("\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
