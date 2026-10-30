#!/usr/bin/env python3
"""Fetch the term-2 teacher guides (كتاب المعلم) the MOE library publishes for
grades 11-12 and describe them as an inventory compatible with extract-corpus.py
and toc-llm.py. The student-library API (BooksFor=1) has no real term-2 books —
only الفهرس الالكتروني stubs — so term-2 grounding comes from the teacher guides
in BooksFor=2, which reproduce the full student content with answers.
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# gradeId/subjectId per the MOE library lookups; ids verified 2026-10-30.
TEACHER_BOOKS = [
    {"id": 981,  "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 54, "subjectLabel": "الأحياء",                 "slug": "biology"},
    {"id": 985,  "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 91, "subjectLabel": "الإحصاء",                 "slug": "statistics", "track": "literary"},
    {"id": 986,  "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 53, "subjectLabel": "الرياضيات",               "slug": "mathematics"},
    {"id": 989,  "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 52, "subjectLabel": "الفيزياء",                "slug": "physics"},
    {"id": 990,  "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 51, "subjectLabel": "الكيمياء",                "slug": "chemistry"},
    {"id": 992,  "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 48, "subjectLabel": "اللغة العربية",           "slug": "arabic"},
    {"id": 3191, "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 56, "subjectLabel": "تقنية المعلومات",         "slug": "information-technology"},
    {"id": 983,  "gradeId": 28, "gradeLabel": "grade-11", "subjectId": 65, "subjectLabel": "علوم الأرض الجيولوجيا",   "slug": "geology"},
    {"id": 993,  "gradeId": 29, "gradeLabel": "grade-12", "subjectId": 54, "subjectLabel": "الأحياء",                 "slug": "biology"},
    {"id": 994,  "gradeId": 29, "gradeLabel": "grade-12", "subjectId": 91, "subjectLabel": "الإحصاء",                 "slug": "statistics", "track": "literary"},
    {"id": 995,  "gradeId": 29, "gradeLabel": "grade-12", "subjectId": 52, "subjectLabel": "الفيزياء",                "slug": "physics"},
    {"id": 997,  "gradeId": 29, "gradeLabel": "grade-12", "subjectId": 51, "subjectLabel": "الكيمياء",                "slug": "chemistry"},
    {"id": 998,  "gradeId": 29, "gradeLabel": "grade-12", "subjectId": 48, "subjectLabel": "اللغة العربية",           "slug": "arabic"},
]

SOURCE = "https://elibrary.moe.edu.kw/StudentsLibrary"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"user-agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "downloads/moe-term2-teachers")
    parser.add_argument("--max-bytes", type=int, default=524288000)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    records = []
    for book in TEACHER_BOOKS:
        local = args.out / f"{book['gradeLabel']}-term-2-{book['subjectLabel']}-teacher-{book['id']}.pdf"
        download_url = f"https://elibrary.moe.edu.kw/api/File/preview/book/{book['id']}"
        record = {
            "kind": "book", "id": book["id"], "sourceUrl": SOURCE, "downloadUrl": download_url,
            "scope": {"gradeId": book["gradeId"], "gradeLabel": book["gradeLabel"],
                      "subjectId": book["subjectId"], "subjectLabel": book["subjectLabel"], "term": 2},
            "item": {"bookFileID": book["id"], "booksFor": 2, "moeYear": 2023, "educationTypeID": 8,
                     "educationStageID": 17, "term": 2, "educationSubjectID": book["subjectId"],
                     "fileDescription": f"كتاب المعلم {book['subjectLabel']}"},
            "localPath": str(local.relative_to(ROOT)),
            "status": "missing",
            "_track": book.get("track", "general"), "_slug": book["slug"],
        }
        if local.exists() and local.stat().st_size > 1024:
            record["status"] = "downloaded"
            record["bytes"] = local.stat().st_size
            print(f"have {local.name} ({record['bytes']} bytes)")
        else:
            try:
                data = fetch(download_url)
                if len(data) > args.max_bytes:
                    raise RuntimeError(f"{local.name} exceeds {args.max_bytes} bytes")
                if not data[:5].startswith(b"%PDF"):
                    raise RuntimeError(f"{local.name}: not a PDF ({data[:60]!r})")
                local.write_bytes(data)
                record["status"] = "downloaded"
                record["bytes"] = len(data)
                print(f"downloaded {local.name} ({len(data)} bytes)")
                time.sleep(1.0)
            except Exception as error:  # noqa: BLE001 - keep the batch running
                record["status"] = "missing"
                print(f"FAILED {book['id']}: {error}")
        records.append(record)

    inventory = {
        "generatedAt": "2026-10-30",
        "source": SOURCE,
        "scope": "Kuwait public-school secondary teacher guides, grades 11-12, term 2",
        "booksDiscovered": len(records),
        "examsDiscovered": 0,
        "records": records,
    }
    (args.out / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
    done = sum(1 for r in records if r["status"] == "downloaded")
    print(f"inventory written: {done}/{len(records)} downloaded -> {args.out / 'inventory.json'}")


if __name__ == "__main__":
    main()
