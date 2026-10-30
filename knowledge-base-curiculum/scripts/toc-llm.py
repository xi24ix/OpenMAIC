#!/usr/bin/env python3
"""Recover real unit/lesson structure for books whose TOC regex parsing failed.

For each staging book whose report.json shows the page-chunk fallback, this
script finds candidate TOC pages from the cached OCR, renders them, and asks a
vision LLM to transcribe the printed table of contents into
(units -> lessons -> printed page) triples. The validated result is written to
staging/book-<id>/toc-llm.json and can be fed back into extract_book.py via
--toc-json for a full re-extraction with correct lesson mapping.

The vision call speaks the OpenAI chat-completions protocol, so any
OpenAI-compatible gateway works (OpenRouter, OpenAI, local gateways).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent

TOC_RE = re.compile(r"(?:المحتو|الفهرس|Contents)", re.I)
LESSON_CODE_ANY_RE = re.compile(r"(?<!\d)\(?\d{1,2}\s*[-–]\s*\d{1,2}\)?(?!\d)")
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

PROMPT = """You are transcribing the printed table of contents (الفهرس / المحتويات) of a Kuwait Ministry of Education school textbook. The images are scanned pages, in reading order.

Return ONLY JSON (no markdown fences, no commentary) shaped exactly like:
{"units":[{"title":"<unit title>","lessons":[{"title":"<lesson title>","printedPage":<int>}]}]}

Rules:
- "printedPage" is the page number PRINTED in the book next to that row (the one in the TOC listing), not the image index.
- Copy titles exactly as printed: Arabic wording, and the English wording if the book shows one. Keep lesson codes if shown.
- A unit row usually starts with الوحدة / وحدة / Unit. Lesson rows usually have a two-part number like 1-2 or الدرس.
- If the page is not a table of contents, contribute no units.
- If the TOC has no unit grouping at all, put every lesson under a single unit titled "وحدة".
- Do NOT invent entries. If you cannot read a row confidently, skip it.
- Merge the pages into one combined TOC in book order.
"""


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", CONTROL_CHARS_RE.sub("", unicodedata.normalize("NFKC", value))).strip()


def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for part in re.split(r"[\r\n]+", path.read_text(encoding="utf-8", errors="replace")):
        part = part.strip()
        if not part or part.startswith("#") or "=" not in part:
            continue
        key, value = part.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def is_placeholder(report: dict) -> bool:
    units = report.get("units") or []
    if not units:
        return True
    return all(unit.get("title") == "محتوى الكتاب" for unit in units)


def candidate_toc_pages(ocr_dir: Path, page_count: int, max_pages: int = 14) -> list[int]:
    """Rank every cached OCR page by TOC-likeness; the vision model filters noise.

    Kuwait textbooks often put a second (or third) contents spread mid-book for
    later units — the math book's second TOC is at PDF page 144 — so the scan
    covers the whole book rather than just the front matter.
    """
    scored: list[tuple[int, int, bool]] = []
    for cache in sorted(ocr_dir.glob("*.json"), key=lambda p: int(p.stem) if p.stem.isdigit() else 10**9):
        try:
            page = int(cache.stem)
        except ValueError:
            continue
        if not 1 <= page <= page_count:
            continue
        payload = json.loads(cache.read_text(encoding="utf-8"))
        text = " ".join(str(line.get("text", "")) for line in payload.get("lines", []))
        code_count = len(LESSON_CODE_ANY_RE.findall(text))
        header = bool(TOC_RE.search(text)) or "الصفحة" in text
        scored.append((page, code_count, header))
    front = {page for page, _, _ in scored if page <= 15}
    ranked = sorted(
        scored,
        key=lambda item: ((item[2] and item[1] >= 2), item[1], -item[0]),
        reverse=True,
    )[:max_pages]
    anchors: set[int] = set()
    for page, _, _ in ranked:
        anchors.update((page - 1, page, page + 1))
    selected = anchors | front
    # Keep the request payload bounded: strong TOC anchors first, then the
    # remaining front matter, then everything else by rank.
    if len(selected) > 18:
        front_kept = {page for page in front if page <= 8}
        ordered = sorted(anchors, key=lambda page: -(next((c for p, c, _ in ranked if abs(p - page) <= 1), 0)))
        selected = set(ordered[:18]) | front_kept
    # Only strongly TOC-looking pages become tocPages: extract_book.py uses
    # them as hard boundaries (mapped pages skip them, lesson ends cap before
    # them), so content pages that merely contain "2-19"-style numbers must
    # not leak in. The wider candidate set is provenance only.
    toc_pages = sorted(page for page, code_count, header in scored if (code_count >= 2 and header) or code_count >= 6)
    return sorted(page for page in selected if 1 <= page <= page_count), toc_pages


def render_pages(pdf_path: Path, pages: list[int], dpi: int) -> dict[int, bytes]:
    doc = pymupdf.open(pdf_path)
    try:
        return {page: doc[page - 1].get_pixmap(dpi=dpi, alpha=False).tobytes("jpeg", jpg_quality=82) for page in pages}
    finally:
        doc.close()


def call_vision(base_url: str, api_key: str, model: str, images: list[bytes], timeout: int, hint: str = "") -> str:
    import urllib.error
    import urllib.request

    content: list[dict] = [{"type": "text", "text": PROMPT + hint}]
    for image in images:
        encoded = base64.b64encode(image).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}})
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "max_tokens": 16000,
        "messages": [{"role": "user", "content": content}],
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=body,
        headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["choices"][0]["message"]["content"]


def parse_toc_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    if start == -1:
        raise ValueError("model returned no JSON object")
    payload, _ = json.JSONDecoder().raw_decode(text[start:])
    return payload


def validate(payload: dict, page_count: int) -> tuple[list[dict], list[str]]:
    problems: list[str] = []
    units_out: list[dict] = []
    seen_rows: set[tuple[str, int | None]] = set()
    for unit in payload.get("units") or []:
        title = clean(str(unit.get("title") or "")).strip()
        lessons_out: list[dict] = []
        for lesson in unit.get("lessons") or []:
            lesson_title = clean(str(lesson.get("title") or "")).strip()
            printed = lesson.get("printedPage")
            if isinstance(printed, str):
                digits = re.sub(r"\D", "", printed)
                printed = int(digits) if digits else None
            if not lesson_title:
                continue
            if printed is not None and not (1 <= int(printed) <= page_count):
                problems.append(f"dropped '{lesson_title[:30]}': printed page {printed} outside 1-{page_count}")
                continue
            key = (lesson_title, printed)
            if key in seen_rows:
                continue
            seen_rows.add(key)
            lessons_out.append({"title": lesson_title, "printedPage": int(printed) if printed is not None else None})
        if lessons_out:
            units_out.append({"title": title or "وحدة", "lessons": lessons_out})
    total = sum(len(unit["lessons"]) for unit in units_out)
    if total < 2:
        raise ValueError(f"model produced only {total} usable lessons")
    return units_out, problems


def reextract(book_dir: Path, pdf_path: Path, meta: dict, ocr_bin: Path, workers: int) -> None:
    course = meta["scope"]
    command = [
        sys.executable, str(ROOT / "scripts/extract_book.py"),
        "--pdf", str(pdf_path),
        "--out", str(book_dir),
        "--book-id", str(meta["id"]),
        "--grade", re.sub(r"\D", "", course["gradeLabel"]),
        "--term", str(course["term"]),
        "--subject", meta["subjectSlug"],
        "--subject-label", course["subjectLabel"],
        "--title", meta["title"],
        "--kind", meta["kind"],
        "--track", meta["track"],
        "--download-url", meta["downloadUrl"],
        "--ocr-bin", str(ocr_bin),
        "--workers", str(workers),
        "--toc-json", str(book_dir / "toc-llm.json"),
    ]
    result = subprocess.run(command, cwd=ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"extract_book.py exited {result.returncode} for {book_dir.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", type=Path, default=ROOT / "staging")
    parser.add_argument("--inventory", type=Path, default=ROOT / "downloads/moe-highschool/inventory.json")
    parser.add_argument("--book-id", action="append", default=[], help="only these book ids")
    parser.add_argument("--pages", default="", help="comma-separated explicit TOC page numbers (overrides candidates)")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true", help="redo books that already have toc-llm.json")
    parser.add_argument("--reextract", action="store_true", help="run extract_book.py with --toc-json after each success")
    parser.add_argument("--dpi", type=int, default=130)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--model", default="google/gemini-2.5-flash")
    parser.add_argument("--fallback-model", default="z-ai/glm-4.5v")
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--api-key-env", default="OPENROUTER_API_KEY")
    parser.add_argument("--ocr-bin", type=Path, default=ROOT / "scripts/bin/vision-ocr")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    env = load_env_file(ROOT.parent / ".env")
    env.update(load_env_file(ROOT / ".env"))
    api_key = os.environ.get(args.api_key_env) or env.get(args.api_key_env) or ""
    if not api_key:
        raise SystemExit(f"API key env {args.api_key_env} is empty; set it or pass --api-key-env")
    base_url = args.base_url or env.get(f"{args.api_key_env.removesuffix('_API_KEY')}_BASE_URL") or "https://openrouter.ai/api/v1"

    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    meta_by_id: dict[str, dict] = {}
    subject_slugs = {
        "الأحياء": "biology", "الاحياء": "biology", "الفيزياء": "physics", "الرياضيات": "mathematics",
        "الكيمياء": "chemistry", "القرآن الكريم": "quran", "التربية الإسلامية": "islamic-education",
        "اللغة الإنجليزية": "english", "اللغة العربية": "arabic", "قواعد النحو و الصرف": "arabic-grammar",
        "تقنية المعلومات": "information-technology", "فنون البلاغة": "rhetoric", "اللغة الفرنسية": "french",
        "علوم الأرض الجيولوجيا": "geology", "دولة الكويت": "kuwait-studies", "التاريخ الإسلامي": "islamic-history",
        "علم النفس وعلم الاجتماع": "psychology-sociology", "مبادئ علم الجغرافيا و الاقتصاد": "geography-economics",
        "الدستور وحقوق الانسان": "constitution-human-rights", "تاريخ العالم الحديث و المعاصر": "modern-world-history",
        "الإحصاء": "statistics",
    }
    for record in inventory.get("records", []):
        if record.get("kind") != "book" or not record.get("localPath"):
            continue
        label = record["scope"]["subjectLabel"]
        description = str(record.get("item", {}).get("fileDescription", ""))
        kind = "teacher_guide" if any(t in description for t in ("كتاب المعلم", "دليل المعلم")) else "student_book"
        if any(t in description for t in ("كتاب التطبيقات", "كراسة التطبيقات", "كراسة التمارين", "كتاب التمارين", "Work Book", "workbook")):
            kind = "workbook"
        text = f"{record['scope'].get('gradeLabel', '')} {label} {description}"
        if record.get("_track"):
            track = str(record["_track"])
        else:
            track = "literary" if "أدبي" in text else "scientific" if "علمي" in text else "general"
        meta_by_id[str(record["id"])] = {
            "id": record["id"], "scope": record["scope"],
            "subjectSlug": subject_slugs.get(label, f"subject-{record['scope'].get('subjectId')}"),
            "title": clean(f"{label} - {description} - {record['scope']['gradeLabel']} - الفصل {record['scope']['term']}"),
            "kind": kind, "track": track,
            "downloadUrl": record.get("downloadUrl", ""),
            "localPath": ROOT / record["localPath"],
        }

    targets: list[tuple[Path, dict]] = []
    for directory in sorted(args.staging.glob("book-*")):
        book_id = directory.name.removeprefix("book-")
        meta = meta_by_id.get(book_id)
        if meta is None:
            continue
        if args.book_id and book_id not in args.book_id:
            continue
        report_path = directory / "report.json"
        if not report_path.exists():
            continue
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if not (args.force or args.book_id or is_placeholder(report)):
            continue
        if not args.force and (directory / "toc-llm.json").exists():
            continue
        targets.append((directory, meta))
    if args.limit:
        targets = targets[:args.limit]

    print(json.dumps({"targets": len(targets), "model": args.model, "base_url": base_url}), flush=True)
    summary = {"processed": 0, "failed": 0, "reextracted": 0}
    for index, (directory, meta) in enumerate(targets, start=1):
        book_id = meta["id"]
        try:
            extraction = json.loads((directory / "extraction.json").read_text(encoding="utf-8"))
            page_count = int(extraction.get("pageCount") or 0)
            pdf_path = Path(meta["localPath"])
            if not pdf_path.exists():
                # macOS stores NFD filenames while the inventory records NFC,
                # and the file suffix varies (book-/teacher-/guide-<id>.pdf).
                matches = sorted((args.inventory.parent).glob(f"*-{book_id}.pdf"))
                if not matches:
                    matches = sorted((ROOT / "downloads").rglob(f"*-{book_id}.pdf"))
                if not matches:
                    raise FileNotFoundError(f"source PDF missing for book {book_id}")
                pdf_path = matches[0]
            pages, toc_pages = candidate_toc_pages(directory / "ocr", page_count)
            if args.pages:
                pages = [int(p) for p in args.pages.split(",") if 1 <= int(p) <= page_count]
                toc_pages = list(pages)
            images_by_page = render_pages(pdf_path, pages, args.dpi)
            ordered = [images_by_page[page] for page in pages if page in images_by_page]
            print(f"[{index}/{len(targets)}] book-{book_id} ({meta['scope']['gradeLabel']} T{meta['scope']['term']} {meta['scope']['subjectLabel']}): {len(ordered)} TOC candidate pages {pages}", flush=True)
            hint = ""
            attempts: list[tuple[str, list[bytes]]] = [(args.model, ordered), (args.model, ordered)]
            if args.fallback_model and args.fallback_model != args.model:
                attempts.append((args.fallback_model, ordered))
            raw = None
            last_error: Exception | None = None
            for attempt, (model_name, attempt_images) in enumerate(attempts, start=1):
                try:
                    raw = call_vision(base_url, api_key, model_name, attempt_images, args.timeout, hint)
                    payload = parse_toc_json(raw)
                    units, problems = validate(payload, page_count)
                    args_model_used = model_name
                    break
                except Exception as error:  # noqa: BLE001 - escalate to the next attempt
                    last_error = error
                    raw = None
                    print(f"  attempt {attempt}/{len(attempts)} with {model_name} failed: {error}", flush=True)
                    hint = "\n\nIMPORTANT: transcribe EVERY row of the contents/الفهرس listing in the images — every unit, chapter, and lesson row with its printed page number. If an image is not a contents page, skip it."
                    time.sleep(3 * attempt)
            if raw is None:
                raise last_error if last_error else RuntimeError("vision call failed")
            lesson_count = sum(len(unit["lessons"]) for unit in units)
            output = {
                "source": "llm", "model": args_model_used,
                "tocPages": toc_pages,
                "candidatePages": pages,
                "units": units,
                "warnings": problems,
            }
            (directory / "toc-llm.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  ok: {len(units)} units, {lesson_count} lessons; warnings={len(problems)}", flush=True)
            summary["processed"] += 1
            if args.reextract:
                reextract(directory, pdf_path, meta, args.ocr_bin, args.workers)
                report = json.loads((directory / "report.json").read_text(encoding="utf-8"))
                final_units = len(report.get("units") or [])
                final_lessons = sum(len(u.get("lessons") or []) for u in report.get("units") or [])
                print(f"  re-extracted: {final_units} units, {final_lessons} lessons", flush=True)
                summary["reextracted"] += 1
        except Exception as error:  # noqa: BLE001 - keep the batch running
            summary["failed"] += 1
            print(f"  FAILED book-{book_id}: {error}", flush=True)
        time.sleep(1)
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
