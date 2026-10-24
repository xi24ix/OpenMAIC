#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUBJECT_SLUGS = {
    "الأحياء": "biology",
    "الاحياء": "biology",
    "الفيزياء": "physics",
    "الرياضيات": "mathematics",
    "الكيمياء": "chemistry",
    "القرآن الكريم": "quran",
    "التربية الإسلامية": "islamic-education",
    "اللغة الإنجليزية": "english",
    "اللغة العربية": "arabic",
    "قواعد النحو و الصرف": "arabic-grammar",
    "تقنية المعلومات": "information-technology",
    "فنون البلاغة": "rhetoric",
    "اللغة الفرنسية": "french",
    "علوم الأرض الجيولوجيا": "geology",
    "دولة الكويت": "kuwait-studies",
    "التاريخ الإسلامي": "islamic-history",
    "علم النفس وعلم الاجتماع": "psychology-sociology",
    "مبادئ علم الجغرافيا و الاقتصاد": "geography-economics",
    "الدستور وحقوق الانسان": "constitution-human-rights",
    "تاريخ العالم الحديث و المعاصر": "modern-world-history",
    "الإحصاء": "statistics",
}


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def subject_slug(record: dict) -> str:
    label = record["scope"]["subjectLabel"]
    return SUBJECT_SLUGS.get(label, f"subject-{record['scope']['subjectId']}")


def infer_track(record: dict) -> str:
    text = f"{record['scope']['subjectLabel']} {record['item'].get('fileDescription', '')}"
    if "أدبي" in text:
        return "literary"
    if "علمي" in text:
        return "scientific"
    return "general"


def infer_kind(record: dict) -> str:
    text = str(record["item"].get("fileDescription", ""))
    if any(token in text for token in ("كتاب التطبيقات", "كراسة التطبيقات", "كراسة التمارين", "كتاب التمارين", "Work Book", "workbook")):
        return "workbook"
    return "student_book"


def build_title(record: dict) -> str:
    subject = record["scope"]["subjectLabel"]
    description = norm(str(record["item"].get("fileDescription", "")))
    title = description if not description else f"{subject} - {description}"
    return norm(f"{title} - {record['scope']['gradeLabel']} - الفصل {record['scope']['term']}")


def is_index_only(record: dict) -> bool:
    return "الفهرس الالكتروني" in str(record["item"].get("fileDescription", ""))


def load_records(inventory_path: Path) -> list[dict]:
    payload = json.loads(inventory_path.read_text(encoding="utf-8"))
    return [
        record
        for record in payload.get("records", [])
        if record.get("kind") == "book"
        and record.get("status") == "downloaded"
        and record.get("localPath")
    ]


def write_progress(path: Path, progress: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")


def already_done(out_dir: Path) -> bool:
    manifest = out_dir / "manifest.json"
    extraction = out_dir / "extraction.json"
    report = out_dir / "report.json"
    if not (manifest.exists() and extraction.exists() and report.exists()):
        return False
    try:
        data = json.loads(report.read_text(encoding="utf-8"))
        units = data.get("units") or []
        return bool(units) and any(unit.get("lessons") for unit in units)
    except (OSError, json.JSONDecodeError):
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, default=ROOT / "downloads/moe-highschool/inventory.json")
    parser.add_argument("--staging", type=Path, default=ROOT / "staging")
    parser.add_argument("--ocr-bin", type=Path, default=ROOT / "scripts/bin/vision-ocr")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--book-id", type=int, action="append", default=[])
    parser.add_argument("--skip-existing", action="store_true", default=True)
    args = parser.parse_args()

    records = [record for record in load_records(args.inventory) if not is_index_only(record)]
    if args.book_id:
        wanted = set(args.book_id)
        records = [record for record in records if int(record["id"]) in wanted]
    if args.limit:
        records = records[: args.limit]
    records.sort(key=lambda record: (record["scope"]["gradeLabel"], record["scope"]["term"], record["scope"]["subjectLabel"], int(record["id"])))

    args.staging.mkdir(parents=True, exist_ok=True)
    progress_path = args.staging / "extraction-progress.json"
    progress = json.loads(progress_path.read_text(encoding="utf-8")) if progress_path.exists() else {}
    summary = {"requested": len(records), "extracted": 0, "skipped": 0, "failed": 0}
    started_at = time.time()

    for index, record in enumerate(records, start=1):
        book_id = int(record["id"])
        out_dir = args.staging / f"book-{book_id}"
        if args.skip_existing and already_done(out_dir):
            progress[str(book_id)] = {"status": "skipped", "output": str(out_dir), "updatedAt": datetime.now(timezone.utc).isoformat()}
            summary["skipped"] += 1
            write_progress(progress_path, progress)
            print(f"[{index}/{len(records)}] skip {book_id} {record['scope']['subjectLabel']}", flush=True)
            continue

        out_dir.mkdir(parents=True, exist_ok=True)
        log_path = out_dir / "extract.log"
        command = [
            sys.executable,
            str(ROOT / "scripts/extract_book.py"),
            "--pdf", str(ROOT / record["localPath"]),
            "--out", str(out_dir),
            "--book-id", str(book_id),
            "--grade", re.sub(r"\D", "", record["scope"]["gradeLabel"]),
            "--term", str(record["scope"]["term"]),
            "--subject", subject_slug(record),
            "--subject-label", record["scope"]["subjectLabel"],
            "--title", build_title(record),
            "--kind", infer_kind(record),
            "--track", infer_track(record),
            "--download-url", record["downloadUrl"],
            "--ocr-bin", str(args.ocr_bin),
            "--workers", str(args.workers),
        ]
        started = time.time()
        print(f"[{index}/{len(records)}] extract {book_id} {record['scope']['gradeLabel']} T{record['scope']['term']} {record['scope']['subjectLabel']} ({record['item'].get('fileDescription', '')})", flush=True)
        with log_path.open("w", encoding="utf-8") as log_file:
            result = subprocess.run(command, cwd=ROOT, stdout=log_file, stderr=subprocess.STDOUT, check=False)
        elapsed = round(time.time() - started, 1)
        if result.returncode == 0 and already_done(out_dir):
            progress[str(book_id)] = {"status": "extracted", "output": str(out_dir), "seconds": elapsed, "updatedAt": datetime.now(timezone.utc).isoformat()}
            summary["extracted"] += 1
            print(f"  ok {book_id} in {elapsed}s", flush=True)
        else:
            progress[str(book_id)] = {"status": "failed", "output": str(out_dir), "seconds": elapsed, "error": f"exit {result.returncode}", "updatedAt": datetime.now(timezone.utc).isoformat()}
            summary["failed"] += 1
            print(f"  failed {book_id} exit {result.returncode}; see {log_path}", flush=True)
        write_progress(progress_path, progress)

    summary["seconds"] = round(time.time() - started_at, 1)
    summary["progress"] = str(progress_path)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
