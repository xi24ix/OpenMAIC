#!/usr/bin/env python3
"""Re-run extract_book.py for staging books whose lesson mapping leaves gaps.

The gap-chunk merge (extract_book.py append_gap_chunks) only takes effect on a
fresh extraction, so this driver finds books whose covered-page ratio is below
a threshold and re-extracts them with their recorded arguments — using the
saved toc-llm.json when one exists, otherwise the regex TOC path. OCR is
cached per book, so a re-run only re-renders previews and figures.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def covered_ratio(report: dict) -> float:
    units = report.get("units") or []
    pages = sum(l["endPage"] - l["startPage"] + 1 for u in units for l in u.get("lessons", []))
    count = report.get("pageCount") or 1
    return pages / count


def source_pdf(book_dir: Path, book_id: str) -> Path | None:
    for base in (ROOT / "downloads/moe-highschool", ROOT / "downloads/moe-term2-teachers", ROOT / "downloads/alktab-term2"):
        matches = sorted(base.glob(f"*-{book_id}.pdf"))
        if matches:
            return matches[0]
    original = json.loads((book_dir / "extraction.json").read_text()).get("originalKey")
    if original and Path(original).exists():
        return Path(original)
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", type=Path, default=ROOT / "staging")
    parser.add_argument("--threshold", type=float, default=0.97)
    parser.add_argument("--book-id", action="append", default=[])
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    targets: list[Path] = []
    for directory in sorted(args.staging.glob("book-*")):
        if args.book_id and directory.name.removeprefix("book-") not in args.book_id:
            continue
        report_path = directory / "report.json"
        if not report_path.exists():
            continue
        report = json.loads(report_path.read_text())
        if report.get("tocSource") == "fallback":
            continue  # chunks already cover every page
        if covered_ratio(report) >= args.threshold:
            continue
        targets.append(directory)
    if args.limit:
        targets = targets[:args.limit]

    print(f"re-extracting {len(targets)} gapped books (threshold {args.threshold})", flush=True)
    failed = 0
    for index, directory in enumerate(targets, start=1):
        book_id = directory.name.removeprefix("book-")
        manifest = json.loads((directory / "manifest.json").read_text())
        course, resource = manifest["course"], manifest["resource"]
        pdf = source_pdf(directory, book_id)
        if pdf is None:
            print(f"[{index}/{len(targets)}] book-{book_id}: source PDF not found, skipping", flush=True)
            continue
        command = [
            sys.executable, str(ROOT / "scripts/extract_book.py"),
            "--pdf", str(pdf), "--out", str(directory),
            "--book-id", book_id, "--grade", str(course["grade"]), "--term", str(course["semester"]),
            "--subject", course["subject"], "--subject-label", course["subject"],
            "--title", resource["title"], "--kind", resource["kind"], "--track", course["track"],
            "--download-url", resource.get("downloadUrl", ""),
            "--ocr-bin", str(ROOT / "scripts/bin/vision-ocr"), "--workers", str(args.workers),
        ]
        toc_llm = directory / "toc-llm.json"
        if toc_llm.exists():
            command += ["--toc-json", str(toc_llm)]
        started = time.time()
        result = subprocess.run(command, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        status = "ok" if result.returncode == 0 else f"FAILED exit {result.returncode}"
        new_report = json.loads((directory / "report.json").read_text())
        ratio = round(100 * covered_ratio(new_report))
        print(f"[{index}/{len(targets)}] book-{book_id}: {status} coverage={ratio}% in {round(time.time()-started)}s", flush=True)
        if result.returncode != 0:
            failed += 1
        time.sleep(1)
    print(f"done, failures: {failed}", flush=True)


if __name__ == "__main__":
    main()
