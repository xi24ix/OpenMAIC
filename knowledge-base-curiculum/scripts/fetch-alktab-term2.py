#!/usr/bin/env python3
"""Fetch Kuwait term-2 student books for grades 10-12 from alktab24.com.

The MOE student library publishes no term-2 student books; alktab24 hosts the
current editions on Google Drive and links them from per-grade category pages
(/المنهج-الكويتي-2/الفصل-الثاني-المنهج-الكويتي/الصف-…-الكويت-ف2/). This script
harvests those book pages, classifies each title into the KB course taxonomy,
downloads the PDF from Drive (handling the large-file confirmation hop), and
writes an inventory.json compatible with extract-corpus.py and toc-llm.py.
"""
from __future__ import annotations

import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120"}

GRADE_PAGES = {
    10: "https://www.alktab24.com/المنهج-الكويتي-2/الفصل-الثاني-المنهج-الكويتي/الصف-العاشر-الكويت-ف2/",
    11: "https://www.alktab24.com/المنهج-الكويتي-2/الفصل-الثاني-المنهج-الكويتي/الصف-الحادي-عشر-الكويت-ف-2-2/",
    12: "https://www.alktab24.com/المنهج-الكويتي-2/الفصل-الثاني-المنهج-الكويتي/الصف-الثاني-عشر-الكويت-ف2/",
}

SUBJECT_RULES = [
    ("الاحياء", "biology"), ("الاحياء", "biology"),
    ("الرياضيات", "mathematics"), ("الفيزياء", "physics"), ("الكيمياء", "chemistry"),
    ("اللغة العربية", "arabic"), ("الانجليزي", "english"), ("الفرنسية", "french"),
    ("الاحصاء", "statistics"), ("التربية الاسلامية", "islamic-education"),
    ("تقنية المعلومات", "information-technology"), ("فنون البلاغة", "rhetoric"),
    ("قواعد النحو", "arabic-grammar"), ("التاريخ", "history"), ("الفلسفة", "philosophy"),
]
WORKBOOK_TOKENS = ("التطبيقات", "التمارين", "التدريبات", "كراسة")


def fetch(url: str, timeout: int = 60) -> tuple[bytes, str]:
    encoded = urllib.parse.quote(url, safe=":/?&=%[]@!$'()*+,;~")
    request = urllib.request.Request(encoded, headers=UA)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), response.headers.get("content-type", "")


def drive_download(file_id: str, target: Path, max_bytes: int) -> str:
    url = f"https://drive.usercontent.google.com/u/0/uc?id={file_id}&export=download"
    data, content_type = fetch(url, timeout=600)
    if "text/html" in content_type:
        # Large files answer with a confirmation form; replay with its fields.
        fields = dict(re.findall(r'name="([^"]+)" value="([^"]*)"', data.decode("utf-8", "replace")))
        if not fields:
            raise RuntimeError("drive returned an html page without a confirm form")
        query = urllib.parse.urlencode(fields)
        data, content_type = fetch(f"https://drive.usercontent.google.com/download?{query}", timeout=900)
    if not data[:5].startswith(b"%PDF"):
        raise RuntimeError(f"not a PDF (starts {data[:20]!r}, content-type {content_type})")
    if len(data) > max_bytes:
        raise RuntimeError(f"exceeds {max_bytes} bytes")
    target.write_bytes(data)
    return content_type


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "downloads/alktab-term2")
    parser.add_argument("--max-bytes", type=int, default=524288000)
    parser.add_argument("--grade", type=int, action="append", default=[], help="only these grades")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    records = []
    for grade, page_url in GRADE_PAGES.items():
        if args.grade and grade not in args.grade:
            continue
        html, _ = fetch(page_url)
        page_links = sorted(set(re.findall(r'href="(https://www\.alktab24\.com/books/[^"]+)"', html.decode("utf-8", "replace"))))
        for page_link in page_links:
            slug = urllib.parse.unquote(page_link).split("/books/")[-1].strip("/")
            page_html, _ = fetch(page_link)
            match = re.search(r'https://drive\.usercontent\.google\.com/u/0/uc\?id=([\w-]+)&export=download', page_html.decode("utf-8", "replace"))
            title_match = re.search(r"<h1[^>]*>([^<]+)</h1>", page_html.decode("utf-8", "replace"))
            title = (title_match.group(1).strip() if title_match else slug)
            if not match:
                print(f"SKIP (no drive link) G{grade} {title[:60]}")
                continue
            drive_id = match.group(1)
            match_text = slug.replace("-", " ")
            subject = next((s for token, s in SUBJECT_RULES if token in match_text), None)
            if subject is None:
                print(f"SKIP (unknown subject) G{grade} {title[:60]}")
                continue
            kind = "workbook" if any(t in slug for t in WORKBOOK_TOKENS) else "student_book"
            track = "literary" if "ادبي" in slug else "general"
            local = args.out / f"grade-{grade}-term-2-{subject}{'' if track == 'general' else '-' + track}-{kind}-{drive_id[:8]}.pdf"
            record = {
                "kind": "book", "id": f"a{drive_id[:10]}", "sourceUrl": page_link,
                "downloadUrl": f"https://drive.usercontent.google.com/u/0/uc?id={drive_id}&export=download",
                "scope": {"gradeId": {10: 27, 11: 28, 12: 29}[grade], "gradeLabel": f"grade-{grade}",
                          "subjectId": 0, "subjectLabel": title, "term": 2},
                "item": {"bookFileID": drive_id, "booksFor": 1, "moeYear": 2025, "educationTypeID": 8,
                         "educationStageID": 17, "term": 2, "educationSubjectID": 0,
                         "fileDescription": title},
                "localPath": str(local.relative_to(ROOT)),
                "status": "missing", "_slug": slug, "_subject": subject, "_kind": kind, "_track": track,
            }
            if local.exists() and local.stat().st_size > 1024:
                record["status"] = "downloaded"
                record["bytes"] = local.stat().st_size
                print(f"have {local.name} ({record['bytes']} bytes)")
            else:
                try:
                    content_type = drive_download(drive_id, local, args.max_bytes)
                    record["status"] = "downloaded"
                    record["bytes"] = local.stat().st_size
                    print(f"downloaded {local.name} ({record['bytes']} bytes)")
                    time.sleep(1.0)
                except Exception as error:  # noqa: BLE001 - keep the batch running
                    record["status"] = "missing"
                    print(f"FAILED G{grade} {title[:50]}: {error}")
            records.append(record)

    inventory = {
        "generatedAt": "2026-10-30",
        "source": "https://www.alktab24.com (Kuwait term-2 category, Google Drive mirrors of MOE books)",
        "scope": "Kuwait public-school secondary student books and workbooks, grades 10-12, term 2",
        "booksDiscovered": len(records),
        "examsDiscovered": 0,
        "records": records,
    }
    (args.out / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
    done = sum(1 for r in records if r["status"] == "downloaded")
    print(f"inventory written: {done}/{len(records)} downloaded -> {args.out / 'inventory.json'}")


if __name__ == "__main__":
    main()
