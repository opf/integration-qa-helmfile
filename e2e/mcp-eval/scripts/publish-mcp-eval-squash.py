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


def canonical_reference(local_id: str, title: str) -> str:
    """Stable Squash automated test reference for an mcp-eval case.

    Squash matches import results on this string (not on test case id).
    Keep it tied to squash-mapping.yaml id+title so prompt/description
    rewording in the Python tests does not orphan iteration statuses.
    """
    return f"mcp-eval#{local_id}#{title}"


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
    for key in ("decorator_tests", "tasks", "results", "test_results", "evaluations"):
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
                f"llm_judge_model={run_meta.get('llm_judge_model', '')}",
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
) -> tuple[dict[str, Any], list[tuple[int, str]], list[str]]:
    tests: list[dict[str, Any]] = []
    sync_items: list[tuple[int, str]] = []
    warnings: list[str] = []

    for task in tasks:
        name = str(
            task.get("description")
            or task.get("name")
            or task.get("title")
            or task.get("test_name")
            or ""
        )
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
        # Prefer explicit mapping override; else stable id+title (not the
        # mcp-eval description / file path — those change and leave ITPIs READY).
        override = meta.get("automated_reference")
        reference = (
            str(override).strip()
            if isinstance(override, str) and override.strip()
            else canonical_reference(local_id, title)
        )
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
        sync_items.append((int(squash_id), reference))

    attachment = suite_attachment(run_meta)
    payload: dict[str, Any] = {"tests": tests}
    if attachment:
        payload["automated_test_suite"] = {"attachments": [attachment]}
    return payload, sync_items, warnings


def ensure_automated_reference(
    base_url: str, token: str, case_id: int, reference: str
) -> None:
    """PATCH Squash test case so import can match by reference."""
    status, body = http_json(
        "GET",
        build_url(base_url, f"test-cases/{case_id}"),
        token,
    )
    if status >= 400:
        raise RuntimeError(
            f"Failed to read test case {case_id}: HTTP {status} {body}"
        )
    current = ""
    try:
        data = json.loads(body) if body else {}
        current = str(
            data.get("automated_test_reference")
            or data.get("automatedTestReference")
            or ""
        ).strip()
    except json.JSONDecodeError:
        pass
    if current == reference:
        print(f"[Squash TM] Test case {case_id} automated reference already set.", flush=True)
        return

    status, body = http_json(
        "PATCH",
        build_url(base_url, f"test-cases/{case_id}"),
        token,
        {"automated_test_reference": reference},
    )
    if status >= 400:
        raise RuntimeError(
            f"Failed to set automated_test_reference on test case {case_id}: "
            f"HTTP {status} {body}"
        )
    print(
        f"[Squash TM] Set automated reference on test case {case_id}: {reference!r}",
        flush=True,
    )


def _collect_test_plan_items(value: Any, out: list[tuple[int, int]]) -> None:
    """Collect (itpi_id, test_case_id) from a Squash test-plan JSON tree."""
    if isinstance(value, list):
        for child in value:
            _collect_test_plan_items(child, out)
        return
    if not isinstance(value, dict):
        return

    tc = (
        value.get("referenced_test_case")
        or value.get("test_case")
        or value.get("testCase")
        or value.get("referencedTestCase")
    )
    tc_id = None
    if isinstance(tc, dict) and isinstance(tc.get("id"), int):
        tc_id = tc["id"]
    elif isinstance(value.get("testCaseId"), int):
        tc_id = value["testCaseId"]

    itpi_id = value.get("id") if isinstance(value.get("id"), int) else None
    # Squash ITPI rows are typed; avoid treating nested test-case objects as ITPIs.
    type_name = str(value.get("_type") or "").lower()
    looks_like_itpi = (
        "test-plan" in type_name
        or "itpi" in type_name
        or ("referenced_test_case" in value)
        or ("test_case" in value and type_name != "test-case")
    )
    if looks_like_itpi and itpi_id is not None and tc_id is not None:
        out.append((itpi_id, tc_id))

    for child in value.values():
        if isinstance(child, (dict, list)):
            _collect_test_plan_items(child, out)


def list_test_plan_items(body: str) -> list[tuple[int, int]]:
    """Parse GET /iterations/{id}/test-plan into (itpi_id, test_case_id) pairs."""
    try:
        data = json.loads(body) if body else {}
    except json.JSONDecodeError:
        return []
    embedded = data.get("_embedded") if isinstance(data, dict) else None
    items: Any = None
    if isinstance(embedded, dict):
        items = (
            embedded.get("test-plan-items")
            or embedded.get("test-plan")
            or embedded.get("testPlanItems")
        )
    if items is None and isinstance(data, dict):
        items = data.get("data") or data
    out: list[tuple[int, int]] = []
    _collect_test_plan_items(items if items is not None else data, out)
    # De-dupe identical pairs while preserving order.
    seen: set[tuple[int, int]] = set()
    unique: list[tuple[int, int]] = []
    for pair in out:
        if pair in seen:
            continue
        seen.add(pair)
        unique.append(pair)
    return unique


def fetch_test_plan(
    base_url: str, token: str, iteration_id: str
) -> list[tuple[int, int]]:
    status, body = http_json(
        "GET",
        build_url(base_url, f"iterations/{iteration_id}/test-plan?size=1000"),
        token,
    )
    if status >= 400:
        raise RuntimeError(f"Failed to read iteration test plan: HTTP {status} {body}")
    return list_test_plan_items(body)


def dedupe_test_plan(
    base_url: str, token: str, iteration_id: str, *, case_ids: set[int] | None = None
) -> int:
    """Delete extra ITPIs that share the same test case id. Returns removals count."""
    items = fetch_test_plan(base_url, token, iteration_id)
    by_case: dict[int, list[int]] = {}
    for itpi_id, tc_id in items:
        if case_ids is not None and tc_id not in case_ids:
            continue
        by_case.setdefault(tc_id, []).append(itpi_id)

    removed = 0
    for tc_id, itpi_ids in sorted(by_case.items()):
        if len(itpi_ids) <= 1:
            continue
        keep, *extras = itpi_ids
        for extra in extras:
            status, body = http_json(
                "DELETE",
                build_url(base_url, f"iterations/{iteration_id}/test-plan/{extra}"),
                token,
            )
            if status >= 400:
                # Older Squash builds use test-plan-items/{id}.
                status2, body2 = http_json(
                    "DELETE",
                    build_url(base_url, f"test-plan-items/{extra}"),
                    token,
                )
                if status2 >= 400:
                    raise RuntimeError(
                        f"Failed to delete duplicate ITPI {extra} "
                        f"(test case {tc_id}): HTTP {status} {body} / {status2} {body2}"
                    )
            removed += 1
            print(
                f"[Squash TM] Removed duplicate ITPI {extra} "
                f"(kept {keep}) for test case {tc_id}.",
                flush=True,
            )
    return removed


def sync_test_plan(
    base_url: str,
    token: str,
    iteration_id: str,
    sync_items: list[tuple[int, str]],
) -> None:
    unique: dict[int, str] = {}
    for case_id, reference in sync_items:
        unique[case_id] = reference
    if not unique:
        print("[Squash TM] No Squash test case IDs to sync.", flush=True)
        return

    # Prior SYNC_TEST_PLAN runs may have added the same cases repeatedly.
    removed = dedupe_test_plan(
        base_url, token, iteration_id, case_ids=set(unique)
    )
    if removed:
        print(
            f"[Squash TM] Removed {removed} duplicate test-plan item(s) "
            f"from iteration {iteration_id}.",
            flush=True,
        )

    existing = {tc_id for _, tc_id in fetch_test_plan(base_url, token, iteration_id)}

    for case_id, reference in sorted(unique.items()):
        ensure_automated_reference(base_url, token, case_id, reference)
        if case_id in existing:
            print(
                f"[Squash TM] Test case {case_id} already in iteration test plan.",
                flush=True,
            )
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
            print(
                f"[Squash TM] Added/ensured test case {case_id} "
                f"in iteration {iteration_id}.",
                flush=True,
            )
            existing.add(case_id)
            continue
        raise RuntimeError(
            f"Failed to add test case {case_id} to iteration {iteration_id}: "
            f"HTTP {status} {body}"
        )


def _import_errors(status: int, body: str) -> list[str]:
    """Collect per-test import errors from a 207 / unmatched-reference response."""
    if status != 207 and not (
        body
        and (
            "No test found with this reference" in body
            or "found multiple times" in body
        )
    ):
        return []
    errors: list[str] = []
    try:
        data = json.loads(body) if body else {}
        for item in data.get("tests") or []:
            if isinstance(item, dict) and item.get("error"):
                errors.append(f"{item.get('reference')!r}: {item.get('error')}")
    except json.JSONDecodeError:
        errors.append(body[:500])
    if not errors:
        errors.append(body[:500] if body else f"HTTP {status}")
    return errors


def publish(
    base_url: str,
    token: str,
    iteration_id: str,
    payload: dict[str, Any],
    *,
    sync_case_ids: set[int] | None = None,
) -> None:
    compact = json.dumps(payload, separators=(",", ":"))
    url = build_url(base_url, f"import/results/{iteration_id}")
    print(
        f"[Squash TM] Publishing {len(compact.encode())} byte payload to {url}",
        flush=True,
    )
    status, body = http_json("POST", url, token, payload)
    if status >= 400:
        raise RuntimeError(f"Import failed: HTTP {status} {body}")

    errors = _import_errors(status, body)
    if errors and any("found multiple times" in e for e in errors):
        print(
            "[Squash TM] Import saw duplicate ITPIs; deduping and retrying once.",
            flush=True,
        )
        dedupe_test_plan(base_url, token, iteration_id, case_ids=sync_case_ids)
        status, body = http_json("POST", url, token, payload)
        if status >= 400:
            raise RuntimeError(f"Import retry failed: HTTP {status} {body}")
        errors = _import_errors(status, body)

    if errors:
        raise RuntimeError(
            "Import did not update Squash iteration statuses. "
            "References must be unique in the iteration "
            "(mcp-eval#<id>#<title> from squash-mapping.yaml). "
            f"Details: {'; '.join(errors)}"
        )
    print(
        f"[Squash TM] Results imported into iteration {iteration_id} (HTTP {status}).",
        flush=True,
    )


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
    payload, sync_items, warnings = build_payload(tasks, mapping, run_meta)

    for warning in warnings:
        print(f"[Squash TM] Warning: {warning}", flush=True)

    out_path = results_path.parent / "squash-results.json"
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"[Squash TM] Wrote {out_path} ({len(payload.get('tests', []))} mapped test(s))",
        flush=True,
    )

    if not payload.get("tests"):
        print("[Squash TM] No mapped tests to publish.", flush=True)
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
            print(
                f"[Squash TM] Missing {', '.join(missing)}; skipping publish.",
                flush=True,
            )
            return 0
        print(f"[Squash TM] Missing {', '.join(missing)}.", file=sys.stderr)
        return 1

    if dry_run:
        print(
            "[Squash TM] Dry run: payload written; not posting to Squash TM.",
            flush=True,
        )
        return 0

    sync_case_ids = {case_id for case_id, _ in sync_items}
    # Always align Squash automated references before import so ITPIs leave READY.
    # Full test-plan membership sync remains gated by SQUASH_TM_SYNC_TEST_PLAN.
    if env_flag("SQUASH_TM_SYNC_TEST_PLAN"):
        sync_test_plan(base_url, token, iteration_id, sync_items)
    else:
        # Still clear duplicates from prior sync runs so import can match uniquely.
        dedupe_test_plan(base_url, token, iteration_id, case_ids=sync_case_ids)
        for case_id, reference in sync_items:
            ensure_automated_reference(base_url, token, case_id, reference)

    publish(
        base_url,
        token,
        iteration_id,
        payload,
        sync_case_ids=sync_case_ids,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
