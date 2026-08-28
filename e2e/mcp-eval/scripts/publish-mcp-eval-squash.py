#!/usr/bin/env python3
"""Publish mcp-eval results to Squash TM (pass/fail only; no test_steps)."""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


LOCAL_ID_RE = re.compile(r"\[([A-Z]{2}-\d+)\]")
DEFAULT_SQUASH_URL = "https://squashtm.openproject.org/squash"


def env_flag(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def load_mapping(path: Path) -> dict[str, dict[str, Any]]:
    """Load constrained squash-mapping.yaml without PyYAML."""
    text = path.read_text(encoding="utf-8")
    cases: dict[str, dict[str, Any]] = {}
    current: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current
        if current and current.get("id"):
            cases[str(current["id"])] = current
        current = None

    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.strip() == "cases:":
            continue
        if line.startswith("  - "):
            flush()
            current = {}
            rest = line[4:].strip()
            if rest:
                key, _, val = rest.partition(":")
                current[key.strip()] = parse_scalar(val.strip())
            continue
        if current is not None and line.startswith("    "):
            key, _, val = line.strip().partition(":")
            current[key.strip()] = parse_scalar(val.strip())
    flush()
    return cases


def parse_scalar(value: str) -> Any:
    if value in {"null", "~", ""}:
        return None
    if value in {"true", "True"}:
        return True
    if value in {"false", "False"}:
        return False
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [part.strip() for part in inner.split(",")]
    if (value.startswith("'") and value.endswith("'")) or (
        value.startswith('"') and value.endswith('"')
    ):
        return value[1:-1]
    if value.isdigit():
        return int(value)
    return value


def extract_tasks(results: Any) -> list[dict[str, Any]]:
    if isinstance(results, list):
        return [t for t in results if isinstance(t, dict)]
    if not isinstance(results, dict):
        return []
    for key in ("tasks", "results", "test_results", "evaluations"):
        val = results.get(key)
        if isinstance(val, list):
            return [t for t in val if isinstance(t, dict)]
    return []


def local_id_from_name(name: str) -> str | None:
    match = LOCAL_ID_RE.search(name or "")
    return match.group(1) if match else None


def map_status(task: dict[str, Any]) -> str:
    status = str(task.get("status") or task.get("result") or task.get("outcome") or "").lower()
    if status in {"passed", "pass", "success", "ok", "true"}:
        return "SUCCESS"
    if status in {"skipped", "skip", "xfail"}:
        return "SKIPPED"
    if status in {"cancelled", "canceled"}:
        return "CANCELLED"
    if status in {"blocked"}:
        return "BLOCKED"
    if status in {"failed", "fail", "error", "false"}:
        return "FAILURE"
    if task.get("passed") is True:
        return "SUCCESS"
    if task.get("passed") is False:
        return "FAILURE"
    if task.get("error") or task.get("errors"):
        return "FAILURE"
    return "FAILURE"


def failure_details(task: dict[str, Any]) -> list[str] | None:
    details: list[str] = []
    for key in ("failure_details", "errors", "error", "message", "reason"):
        val = task.get(key)
        if isinstance(val, str) and val.strip():
            details.append(val.strip())
        elif isinstance(val, list):
            details.extend(str(v) for v in val if v)
    return details or None


def duration_ms(task: dict[str, Any]) -> int | None:
    for key in ("duration_ms", "duration", "elapsed_ms", "time"):
        val = task.get(key)
        if isinstance(val, (int, float)) and val > 0:
            # Heuristic: values < 1000 likely seconds
            if key == "duration" and val < 1000:
                return int(val * 1000)
            return int(val)
    return None


def api_base(base_url: str) -> str:
    clean = base_url.rstrip("/")
    if clean.endswith("/api/rest/latest"):
        return clean
    return f"{clean}/api/rest/latest"


def build_url(base_url: str, path: str) -> str:
    return f"{api_base(base_url)}/{path.lstrip('/')}"


def http_json(
    method: str,
    url: str,
    token: str,
    body: dict[str, Any] | None = None,
    max_attempts: int = 3,
) -> tuple[int, str]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"

    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            payload = e.read().decode("utf-8", errors="replace")
            if e.code >= 500 and attempt < max_attempts:
                time.sleep(0.5 * (2 ** (attempt - 1)))
                continue
            return e.code, payload
        except Exception as e:  # noqa: BLE001
            last_error = e
            if attempt == max_attempts:
                break
            time.sleep(0.5 * (2 ** (attempt - 1)))
    raise RuntimeError(f"Request failed for {url}: {last_error}")


def suite_attachment(run_meta: dict[str, Any] | None) -> dict[str, str] | None:
    lines = [
        f"repository={os.environ.get('GITHUB_REPOSITORY', '')}",
        f"workflow={os.environ.get('GITHUB_WORKFLOW', '')}",
        f"run_id={os.environ.get('GITHUB_RUN_ID', '')}",
        f"run_attempt={os.environ.get('GITHUB_RUN_ATTEMPT', '')}",
        f"sha={os.environ.get('GITHUB_SHA', '')}",
        f"ref={os.environ.get('GITHUB_REF', '')}",
    ]
    if run_meta:
        lines.extend(
            [
                f"llm_provider={run_meta.get('llm_provider', '')}",
                f"llm_model={run_meta.get('llm_model', '')}",
                f"llm_base_url={run_meta.get('llm_base_url', '')}",
                f"openproject_url={run_meta.get('openproject_url', '')}",
            ]
        )
    content = ("\n".join(lines) + "\n").encode("utf-8")
    return {
        "name": "github-run.txt",
        "content": base64.b64encode(content).decode("ascii"),
    }


def build_payload(
    tasks: list[dict[str, Any]],
    mapping: dict[str, dict[str, Any]],
    run_meta: dict[str, Any] | None,
) -> tuple[dict[str, Any], list[int], list[str]]:
    tests: list[dict[str, Any]] = []
    sync_ids: list[int] = []
    warnings: list[str] = []

    for task in tasks:
        name = str(task.get("name") or task.get("title") or "")
        local_id = local_id_from_name(name)
        if not local_id:
            warnings.append(f"No local id in task name: {name!r}")
            continue
        meta = mapping.get(local_id)
        if not meta:
            warnings.append(f"Unknown local id {local_id} (not in squash-mapping.yaml)")
            continue
        squash_id = meta.get("squash_test_case_id")
        if squash_id is None:
            warnings.append(f"{local_id}: squash_test_case_id not set; skipping")
            continue

        title = str(meta.get("title") or local_id)
        reference = f"mcp-eval#{local_id}#{title}"
        entry: dict[str, Any] = {
            "reference": reference,
            "status": map_status(task),
        }
        dur = duration_ms(task)
        if dur is not None:
            entry["duration"] = dur
        fails = failure_details(task)
        if fails:
            entry["failure_details"] = fails
        tests.append(entry)
        sync_ids.append(int(squash_id))

    attachment = suite_attachment(run_meta)
    payload: dict[str, Any] = {"tests": tests}
    if attachment:
        payload["automated_test_suite"] = {"attachments": [attachment]}
    return payload, sync_ids, warnings


def sync_test_plan(base_url: str, token: str, iteration_id: str, case_ids: list[int]) -> None:
    unique = sorted(set(case_ids))
    if not unique:
        print("[Squash TM] No Squash test case IDs to sync.")
        return

    status, body = http_json(
        "GET",
        build_url(base_url, f"iterations/{iteration_id}/test-plan?size=1000"),
        token,
    )
    if status >= 400:
        raise RuntimeError(f"Failed to read iteration test plan: HTTP {status} {body}")

    existing: set[int] = set()
    try:
        data = json.loads(body) if body else {}
        items = data.get("_embedded", {}).get("test-plan", data.get("data", []))
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                tc = item.get("test_case") or item.get("referencedTestCase") or {}
                if isinstance(tc, dict) and isinstance(tc.get("id"), int):
                    existing.add(tc["id"])
                elif isinstance(item.get("testCaseId"), int):
                    existing.add(item["testCaseId"])
    except json.JSONDecodeError:
        pass

    for case_id in unique:
        if case_id in existing:
            print(f"[Squash TM] Test case {case_id} already in iteration test plan.")
            continue
        status, body = http_json(
            "POST",
            build_url(base_url, f"iterations/{iteration_id}/test-plan"),
            token,
            {
                "_type": "test-plan-item",
                "test_case": {"_type": "test-case", "id": case_id},
            },
        )
        if status < 400 or status == 409 or "already" in body.lower():
            print(f"[Squash TM] Added/ensured test case {case_id} in iteration {iteration_id}.")
            continue
        raise RuntimeError(
            f"Failed to add test case {case_id} to iteration {iteration_id}: HTTP {status} {body}"
        )


def publish(base_url: str, token: str, iteration_id: str, payload: dict[str, Any]) -> None:
    compact = json.dumps(payload, separators=(",", ":"))
    url = build_url(base_url, f"import/results/{iteration_id}")
    print(f"[Squash TM] Publishing {len(compact.encode())} byte payload to {url}")
    status, body = http_json("POST", url, token, payload)
    if status >= 400:
        raise RuntimeError(f"Import failed: HTTP {status} {body}")
    print(f"[Squash TM] Results imported into iteration {iteration_id}.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish mcp-eval results to Squash TM")
    parser.add_argument("--json", required=True, help="Path to mcp-eval results.json")
    parser.add_argument(
        "--mapping",
        default=str(Path(__file__).resolve().parents[1] / "squash-mapping.yaml"),
        help="Path to squash-mapping.yaml",
    )
    parser.add_argument(
        "--metadata",
        default="",
        help="Optional run-metadata.json path (default: sibling of results.json)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dry_run = args.dry_run or env_flag("SQUASH_TM_DRY_RUN")
    skip_missing_auth = env_flag("SQUASH_TM_SKIP_MISSING_AUTH")

    results_path = Path(args.json)
    if not results_path.is_file():
        print(f"[Squash TM] Missing results file: {results_path}", file=sys.stderr)
        return 1

    mapping_path = Path(args.mapping)
    if not mapping_path.is_file():
        print(f"[Squash TM] Missing mapping file: {mapping_path}", file=sys.stderr)
        return 1

    meta_path = Path(args.metadata) if args.metadata else results_path.parent / "run-metadata.json"
    run_meta = None
    if meta_path.is_file():
        run_meta = json.loads(meta_path.read_text(encoding="utf-8"))

    results = json.loads(results_path.read_text(encoding="utf-8"))
    mapping = load_mapping(mapping_path)
    tasks = extract_tasks(results)
    payload, sync_ids, warnings = build_payload(tasks, mapping, run_meta)

    for warning in warnings:
        print(f"[Squash TM] Warning: {warning}")

    out_path = results_path.parent / "squash-results.json"
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[Squash TM] Wrote {out_path} ({len(payload.get('tests', []))} mapped test(s))")

    if not payload.get("tests"):
        print("[Squash TM] No mapped tests to publish.")
        return 0

    base_url = (os.environ.get("SQUASH_TM_URL") or DEFAULT_SQUASH_URL).strip()
    token = (os.environ.get("SQUASH_TM_API_TOKEN") or "").strip()
    iteration_id = (os.environ.get("SQUASH_TM_ITERATION_ID") or "").strip()

    missing = [n for n, v in (
        ("SQUASH_TM_API_TOKEN", token),
        ("SQUASH_TM_ITERATION_ID", iteration_id),
    ) if not v]

    if missing:
        if skip_missing_auth or dry_run:
            print(f"[Squash TM] Missing {', '.join(missing)}; skipping publish.")
            return 0
        print(f"[Squash TM] Missing {', '.join(missing)}.", file=sys.stderr)
        return 1

    if dry_run:
        print("[Squash TM] Dry run: payload written; not posting to Squash TM.")
        return 0

    if env_flag("SQUASH_TM_SYNC_TEST_PLAN"):
        sync_test_plan(base_url, token, iteration_id, sync_ids)

    publish(base_url, token, iteration_id, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
