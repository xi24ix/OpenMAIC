#!/usr/bin/env python3
"""Extract a Kuwait MOE textbook into the knowledge-base staging format.

The pipeline is intentionally staged: PyMuPDF supplies page geometry and
native text, macOS Vision OCR supplies corrected Arabic text, and the output
is a manifest plus extraction JSON that the TypeScript importer can ingest
without doing any OCR itself.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

import pymupdf


ARABIC_RE = re.compile(r"[\u0600-\u06ff]")
DIACRITICS_RE = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
TATWEEL_RE = re.compile(r"\u0640")
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
PAGE_NUMBER_RE = re.compile(r"^[^\d]*\d{1,4}[^\d]*$")
LESSON_CODE_RE = re.compile(r"(?:الدرس\s*)?(?<!\d)\(?(\d{1,2})\s*[-–]\s*(\d{1,2})\)?(?!\d)\s*:?\s*(.*)$")
LESSON_CODE_ANY_RE = re.compile(r"(?<!\d)\(?\d{1,2}\s*[-–]\s*\d{1,2}\)?(?!\d)")
UNIT_RE = re.compile(r"(?:الوحدة|Unit)\s*(?:الأولى|الثانية|الثالثة|الرابعة|الخامسة|السادسة|السابعة|الثامنة|التاسعة|العاشرة|\d+)?", re.I)
TOC_RE = re.compile(r"(?:المحتو|الفهرس|Contents)", re.I)
HEADING_STOP_RE = re.compile(r"(?:الفصل|الوحدة|الباب|مراجعة|المراجع|من وطني|المحتوى)", re.I)
TITLE_JUNK_RE = re.compile(r"^[\s:،.\-–—|/]+$")
ARABIC_RE = re.compile(r"[\u0600-\u06FF]")
CAPTION_RE = re.compile(
    r"(?:^|\s)(?:شكل|الشكل|جدول|الجدول|خريطة|الخريطة|مخطط|المخطط|رسم|الرسم)\s*(?:رقم|\d+|[\(\[]|:)?\s*$"
    r"|(?:^|\s)(?:شكل|الشكل|جدول|الجدول|خريطة|الخريطة|مخطط|المخطط|رسم|الرسم)\s*(?:رقم|\d+|[\(\[])",
    re.I,
)
CAPTION_EN_RE = re.compile(r"(?:Figure|Fig\.|Table|Chart|Map|Diagram)\s*[\d(]", re.I)
MATH_RE = re.compile(r"[=<>≤≥±√∑∫π×÷^]|\\frac|\\sqrt")


def norm(value: str) -> str:
    return CONTROL_CHARS_RE.sub("", unicodedata.normalize("NFKC", value).replace("\u00a0", " ").replace("\u200f", "").replace("\u200e", ""))


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", norm(value)).strip()


def page_number_value(value: str) -> int | None:
    """Return a printed page number even when OCR adds punctuation."""
    match = re.fullmatch(r"[^\d]*(\d{1,4})[^\d]*", clean(value))
    return int(match.group(1)) if match else None


def match_key(value: str) -> str:
    value = norm(value)
    value = DIACRITICS_RE.sub("", value)
    value = TATWEEL_RE.sub("", value)
    value = re.sub(r"[إأآٱ]", "ا", value)
    value = value.replace("ى", "ي").replace("ة", "ه")
    value = re.sub(r"[^\w\u0600-\u06ff]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def arabic_ratio(value: str) -> float:
    letters = [c for c in value if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if ARABIC_RE.match(c)) / len(letters)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bbox_tuple(value: Iterable[float]) -> tuple[float, float, float, float]:
    return tuple(round(float(v), 6) for v in value)  # type: ignore[return-value]


def norm_bbox(x0: float, y0: float, x1: float, y1: float, width: float, height: float) -> tuple[float, float, float, float]:
    x = max(0.0, min(1.0, x0 / width))
    y = max(0.0, min(1.0, y0 / height))
    x2 = max(0.0, min(1.0, x1 / width))
    y2 = max(0.0, min(1.0, y1 / height))
    if x2 <= x or y2 <= y:
        return (x, y, 0.0, 0.0)
    return bbox_tuple((x, y, x2 - x, y2 - y))


def intersection(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x = max(ax, bx)
    y = max(ay, by)
    x2 = min(ax + aw, bx + bw)
    y2 = min(ay + ah, by + bh)
    return max(0.0, x2 - x) * max(0.0, y2 - y)


def union(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    x0 = min(a[0], b[0]); y0 = min(a[1], b[1])
    x1 = max(a[0] + a[2], b[0] + b[2]); y1 = max(a[1] + a[3], b[1] + b[3])
    return bbox_tuple((x0, y0, x1 - x0, y1 - y0))


def overlap_1d(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def reading_key(bbox: tuple[float, float, float, float]) -> tuple[int, float, float]:
    x, y, width, _ = bbox
    if width > 0.6:
        column = -1
    elif x >= 0.5:
        column = 0
    elif x + width <= 0.5:
        column = 2
    else:
        column = 1
    return (column, y, -x)


@dataclass
class OcrLine:
    text: str
    bbox: tuple[float, float, float, float]
    confidence: float

    @property
    def height(self) -> float:
        return self.bbox[3]

    @property
    def y0(self) -> float:
        return self.bbox[1]

    @property
    def y1(self) -> float:
        return self.bbox[1] + self.bbox[3]

    @property
    def x0(self) -> float:
        return self.bbox[0]

    @property
    def x1(self) -> float:
        return self.bbox[0] + self.bbox[2]


@dataclass
class Block:
    text: str
    bbox: tuple[float, float, float, float]
    native_text: str = ""
    status: str = "native"


@dataclass
class Figure:
    id: str
    page: int
    bbox: tuple[float, float, float, float]
    kind: str
    caption: str
    purpose: str
    width: int
    height: int
    object_key: str
    sha256: str
    lesson_id: str | None = None


@dataclass
class Lesson:
    id: str
    title: str
    order: int
    printed_page: int | None = None
    start_page: int = 1
    end_page: int = 1
    unit_order: int = 0
    objectives: list[str] = field(default_factory=list)


@dataclass
class Unit:
    id: str
    title: str
    order: int
    lessons: list[Lesson] = field(default_factory=list)


def ocr_image(binary: Path, image: Path) -> tuple[list[OcrLine], list[tuple[float, float, float, float]]]:
    result = subprocess.run([str(binary), str(image)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"OCR failed for {image.name}: {result.stderr.strip()}")
    try:
        # Vision normally emits one JSON document, but a few concurrent macOS
        # runs have produced a second JSON document or diagnostic bytes after
        # the first one. Decode the first complete document so one malformed
        # trailing write does not discard the page's valid OCR result.
        raw = (result.stdout or "").lstrip()
        payload, _ = json.JSONDecoder().raw_decode(raw or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"OCR returned invalid JSON for {image.name}: {exc}") from exc
    raw_lines = payload.get("lines", []) if isinstance(payload, dict) else payload
    raw_barcodes = payload.get("barcodes", []) if isinstance(payload, dict) else []
    lines: list[OcrLine] = []
    for item in raw_lines:
        text = clean(str(item.get("text", "")))
        if not text:
            continue
        bbox = item.get("bbox") or [0, 0, 0, 0]
        if len(bbox) != 4:
            continue
        x0, y0, x1, y1 = (float(v) for v in bbox)
        width = max(1e-6, x1 - x0)
        height = max(1e-6, y1 - y0)
        lines.append(OcrLine(text=text, bbox=bbox_tuple((x0, y0, width, height)), confidence=float(item.get("confidence", 0))))
    barcodes: list[tuple[float, float, float, float]] = []
    for item in raw_barcodes:
        if len(item) != 4:
            continue
        x0, y0, x1, y1 = (float(v) for v in item)
        barcodes.append(bbox_tuple((x0, y0, max(1e-6, x1 - x0), max(1e-6, y1 - y0))))
    return lines, barcodes


def render_pdf_pages(pdf_path: Path, cache_dir: Path, dpi: int, pages: list[int], workers: int, ocr_bin: Path) -> tuple[dict[int, list[OcrLine]], dict[int, list[tuple[float, float, float, float]]]]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    results: dict[int, list[OcrLine]] = {}
    barcode_results: dict[int, list[tuple[float, float, float, float]]] = {}
    temp_dir = cache_dir / "_images"
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        pending: list[tuple[int, Path]] = []
        for index in pages:
            page = doc[index - 1]
            cache_path = cache_dir / f"{index}.json"
            if cache_path.exists():
                try:
                    lines, barcodes = parse_ocr_cache(cache_path)
                    results[index] = lines
                    barcode_results[index] = barcodes
                    continue
                except Exception:
                    cache_path.unlink(missing_ok=True)
            image_path = temp_dir / f"{index}.png"
            if not image_path.exists():
                pix = page.get_pixmap(dpi=dpi, alpha=False)
                pix.save(image_path)
            pending.append((index, image_path))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(ocr_image, ocr_bin, image_path): index for index, image_path in pending}
            for future in concurrent.futures.as_completed(futures):
                index = futures[future]
                lines, barcodes = future.result()
                results[index] = lines
                barcode_results[index] = barcodes
                (cache_dir / f"{index}.json").write_text(json.dumps({
                    "lines": [{"text": line.text, "bbox": line.bbox, "confidence": line.confidence} for line in lines],
                    "barcodes": [list(barcode) for barcode in barcodes],
                }, ensure_ascii=False), encoding="utf-8")
                print(f"  OCR page {index}/{len(pages)} ({len(lines)} lines, {len(barcodes)} barcodes)", file=sys.stderr)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        doc.close()
    return results, barcode_results


def parse_ocr_cache(path: Path) -> tuple[list[OcrLine], list[tuple[float, float, float, float]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or "lines" not in payload:
        raise ValueError("legacy OCR cache")
    lines = [OcrLine(text=clean(str(item["text"])), bbox=bbox_tuple(item["bbox"]), confidence=float(item.get("confidence", 0))) for item in payload["lines"]]
    barcodes = [bbox_tuple((float(x0), float(y0), max(1e-6, float(x1) - float(x0)), max(1e-6, float(y1) - float(y0)))) for x0, y0, x1, y1 in payload.get("barcodes", [])]
    return lines, barcodes


def order_title(parts: list[tuple[float, str]]) -> str:
    arabic = sorted((part for part in parts if ARABIC_RE.search(part[1])), key=lambda part: part[0])
    other = sorted((part for part in parts if not ARABIC_RE.search(part[1])), key=lambda part: part[0])
    return clean(" ".join(part[1] for part in arabic + other))


def group_rows(lines: list[OcrLine], tolerance: float = 0.014) -> list[list[OcrLine]]:
    rows: list[list[OcrLine]] = []
    for line in sorted(lines, key=lambda item: (item.y0, -item.x0)):
        target = None
        for row in rows:
            center = sum((item.y0 + item.y1) / 2 for item in row) / len(row)
            if abs((line.y0 + line.y1) / 2 - center) <= tolerance:
                target = row
                break
        if target is None:
            rows.append([line])
        else:
            target.append(line)
    rows.sort(key=lambda row: min(item.y0 for item in row))
    return rows


def parse_toc_page(lines: list[OcrLine]) -> list[tuple[str, str, list[tuple[str, str, int | None]]]]:
    """Return [(unit_title, unit_raw, [(lesson_code, lesson_title, printed_page)])]."""
    rows = group_rows(lines, tolerance=0.018)
    units: list[tuple[str, str, list[tuple[str, str, int | None]]]] = []
    current: list[tuple[str, str, int | None]] = []
    current_title = ""
    pending_unit_title = ""

    def flush_unit() -> None:
        nonlocal current, current_title, pending_unit_title
        if current or current_title:
            units.append((clean(current_title or pending_unit_title or "وحدة"), clean(current_title or pending_unit_title or "وحدة"), current))
        current = []
        current_title = ""
        pending_unit_title = ""

    index = 0
    while index < len(rows):
        row = sorted(rows[index], key=lambda item: item.x0, reverse=True)
        texts = [item.text for item in row]
        joined = " ".join(texts)
        unit_hit = UNIT_RE.search(joined)
        has_lesson_code = any(LESSON_CODE_RE.search(item.text) for item in row)
        if unit_hit and not has_lesson_code:
            flush_unit()
            head = clean(unit_hit.group(0))
            pending_unit_title = head
            unit_title_parts: list[str] = []
            for candidate in row:
                if candidate.x0 <= 0.25 or page_number_value(candidate.text) is not None:
                    continue
                remainder = UNIT_RE.sub("", candidate.text, count=1)
                remainder = re.sub(r"^[\s:：,،.\-–—|/]+", "", remainder)
                if remainder and not TITLE_JUNK_RE.match(remainder):
                    unit_title_parts.append(remainder)
            previous_center = sum((candidate.y0 + candidate.y1) / 2 for candidate in row) / len(row)
            extra = index + 1
            while extra < len(rows) and extra <= index + 4:
                next_row = sorted(rows[extra], key=lambda candidate: candidate.x0, reverse=True)
                next_text = clean(" ".join(candidate.text for candidate in next_row))
                next_center = sum((candidate.y0 + candidate.y1) / 2 for candidate in next_row) / len(next_row)
                if not next_text or HEADING_STOP_RE.search(next_text) or LESSON_CODE_ANY_RE.search(next_text) or "الصفحة" in next_text:
                    break
                if abs(next_center - previous_center) > 0.055:
                    break
                arabic = [
                    candidate
                    for candidate in next_row
                    if candidate.x0 > 0.25
                    and page_number_value(candidate.text) is None
                    and not UNIT_RE.search(candidate.text)
                ]
                if not arabic:
                    break
                unit_title_parts.extend(
                    candidate.text for candidate in arabic if not TITLE_JUNK_RE.match(candidate.text)
                )
                previous_center = next_center
                extra += 1
            current_title = clean(" ".join(unit_title_parts)) or head
            index = extra
            continue

        code_line = None
        for item in row:
            match = LESSON_CODE_RE.search(item.text)
            if match:
                code_line = (item, match)
                break
        if code_line:
            item, match = code_line
            first, second, tail = match.groups()
            code = f"{first}-{second}"
            page_number = None
            title_parts: list[tuple[float, str]] = []
            if tail and not TITLE_JUNK_RE.match(tail):
                title_parts.append((item.y0, tail))
            for other in row:
                if other is item:
                    continue
                parsed_page = page_number_value(other.text)
                if parsed_page is not None:
                    page_number = parsed_page
                elif "الصفحة" not in other.text and not LESSON_CODE_ANY_RE.fullmatch(other.text):
                    title_parts.append((other.y0, other.text))
            # Continuation rows: title text below/above the code row before the
            # next code or unit row.
            extra = index + 1
            previous_center = sum((candidate.y0 + candidate.y1) / 2 for candidate in row) / len(row)
            while extra < len(rows) and extra <= index + 3:
                next_row = sorted(rows[extra], key=lambda candidate: candidate.x0, reverse=True)
                next_text = clean(" ".join(candidate.text for candidate in next_row))
                next_center = sum((candidate.y0 + candidate.y1) / 2 for candidate in next_row) / len(next_row)
                if not next_text or "الصفحة" in next_text or HEADING_STOP_RE.search(next_text) or LESSON_CODE_ANY_RE.search(next_text) or UNIT_RE.search(next_text):
                    break
                if abs(next_center - previous_center) > 0.055:
                    break
                if page_number_value(next_text) is not None:
                    break
                for candidate in next_row:
                    parsed_page = page_number_value(candidate.text)
                    if parsed_page is not None:
                        if page_number is None:
                            page_number = parsed_page
                    elif "الصفحة" not in candidate.text and not TITLE_JUNK_RE.match(candidate.text):
                        title_parts.append((candidate.y0, candidate.text))
                previous_center = next_center
                extra += 1
            title = re.sub(r"\s*[.…]+$", "", order_title([part for part in title_parts if part[1]])).strip()
            if title and page_number is not None:
                current.append((code, title, page_number))
            index = max(index + 1, extra)
            continue
        index += 1
    flush_unit()
    return [unit for unit in units if unit[2]]


def build_toc(ocr: dict[int, list[OcrLine]], page_count: int) -> tuple[list[Unit], list[int]]:
    toc_pages: list[int] = []
    parsed: list[tuple[int, list[tuple[str, str, list[tuple[str, str, int | None]]]]]] = []
    for page in sorted(ocr):
        text = " ".join(line.text for line in ocr[page])
        code_count = sum(len(LESSON_CODE_ANY_RE.findall(line.text)) for line in ocr[page])
        header = "الصفحة" in text or TOC_RE.search(text)
        if code_count >= 2 and header:
            toc_pages.append(page)
            parsed.append((page, parse_toc_page(ocr[page])))
    units: list[Unit] = []
    units_by_title: dict[str, Unit] = {}
    seen_lessons: set[tuple[str, str]] = set()
    for page, page_units in parsed:
        for unit_title, unit_raw, lessons in page_units:
            if not lessons:
                continue
            unit = units_by_title.get(unit_title)
            if unit is None:
                unit_order = len(units) + 1
                unit = Unit(id=f"u{unit_order}", title=unit_title, order=unit_order)
                units_by_title[unit_title] = unit
                units.append(unit)
            for code, title, printed in lessons:
                key = (unit_title, code)
                if key in seen_lessons:
                    continue
                seen_lessons.add(key)
                lesson_order = len(unit.lessons) + 1
                unit.lessons.append(Lesson(id=f"{unit.id}-l{lesson_order}", title=title, order=lesson_order, printed_page=printed, unit_order=unit.order))
    return [unit for unit in units if unit.lessons], toc_pages


def page_number_pairs(ocr: dict[int, list[OcrLine]]) -> list[tuple[int, int]]:
    pairs: list[tuple[int, int]] = []
    for page, lines in ocr.items():
        for line in lines:
            value = page_number_value(line.text)
            if value is None:
                continue
            if line.y0 >= 0.84 or line.y1 <= 0.12:
                if 1 <= value <= 999:
                    pairs.append((page, value))
                    break
    pairs.sort()
    return pairs


def offset_for_printed(printed: int, pairs: list[tuple[int, int]]) -> int | None:
    if not pairs:
        return None
    nearby = [page - value for page, value in pairs if abs(value - printed) <= 10]
    if nearby:
        counts = Counter(nearby)
        return max(counts, key=lambda offset: (counts[offset], -abs(offset)))
    before = [(page, value) for page, value in pairs if value <= printed]
    if before:
        page, value = max(before, key=lambda item: item[1])
        return page - value
    page, value = min(pairs, key=lambda item: item[1])
    return page - value


def find_title_page(unit: Unit, lesson: Lesson, ocr: dict[int, list[OcrLine]], start: int, end: int, preferred: int) -> int | None:
    key = match_key(lesson.title)
    if not key:
        return None
    matches: list[int] = []
    for page in range(max(1, start), min(len(ocr), end) + 1):
        lines = ocr.get(page, [])
        for line in lines:
            line_key = match_key(line.text)
            if key in line_key or (len(line_key) > 8 and line_key in key):
                matches.append(page)
                break
    if not matches:
        return None
    return min(matches, key=lambda page: (abs(page - preferred), page))


def find_phrase_page(phrase: str, ocr: dict[int, list[OcrLine]], start: int, end: int) -> int | None:
    key = match_key(phrase)
    if not key:
        return None
    for page in range(max(1, start), min(len(ocr), end) + 1):
        if any(key in match_key(line.text) for line in ocr.get(page, [])):
            return page
    return None


def assign_pages(units: list[Unit], ocr: dict[int, list[OcrLine]], page_count: int, toc_pages: list[int]) -> None:
    pairs = page_number_pairs(ocr)
    toc_set = set(toc_pages)
    lessons = [lesson for unit in units for lesson in unit.lessons]
    lessons.sort(key=lambda lesson: (lesson.printed_page or 10**9, lesson.order))
    ordered_units = sorted(units, key=lambda unit: unit.order)
    next_unit_by_order = {
        unit.order: ordered_units[index + 1] if index + 1 < len(ordered_units) else None
        for index, unit in enumerate(ordered_units)
    }
    previous = 1
    for lesson in lessons:
        mapped = None
        if lesson.printed_page is not None:
            offset = offset_for_printed(lesson.printed_page, pairs)
            if offset is not None:
                mapped = lesson.printed_page + offset
        if mapped is None:
            mapped = lesson.printed_page if lesson.printed_page is not None else previous
        while mapped in toc_set and mapped < page_count:
            mapped += 1
        mapped = max(1, mapped)
        start = find_title_page(next(unit for unit in units if lesson in unit.lessons), lesson, ocr, mapped - 3, mapped + 3, mapped)
        if start is None:
            start = mapped
        start = max(previous, start)
        lesson.start_page = min(page_count, start)
        previous = lesson.start_page
    for index, lesson in enumerate(lessons):
        if index + 1 < len(lessons):
            end = lessons[index + 1].start_page - 1
        else:
            end = page_count
        if index + 1 >= len(lessons) or lessons[index + 1].unit_order != lesson.unit_order:
            next_unit = next_unit_by_order.get(lesson.unit_order)
            if next_unit and next_unit.lessons:
                next_unit_start = min(item.start_page for item in next_unit.lessons)
                next_unit_title = find_phrase_page(
                    next_unit.title,
                    ocr,
                    lesson.start_page + 1,
                    next_unit_start,
                )
                if next_unit_title is not None:
                    # Textbooks often place a unit summary before a cover,
                    # project, or orientation spread for the next unit. Keep
                    # the summary with the current unit, but do not leak the
                    # next unit's transition pages into its last lesson.
                    summary_pages = [
                        page
                        for page in range(lesson.start_page, next_unit_title)
                        if any("ملخص" in match_key(line.text) for line in ocr.get(page, []))
                    ]
                    end = max(lesson.start_page, max(summary_pages) if summary_pages else next_unit_title - 1)
                else:
                    end = next_unit_start - 1
        later_toc = [page for page in toc_pages if lesson.start_page < page <= end]
        if later_toc:
            end = min(later_toc) - 1
        lesson.end_page = max(lesson.start_page, end)


def native_blocks(page: pymupdf.Page) -> list[Block]:
    width, height = page.rect.width, page.rect.height
    blocks: list[Block] = []
    data = page.get_text("dict")
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        text = clean(" ".join(span.get("text", "") for line in block.get("lines", []) for span in line.get("spans", [])))
        if not text:
            continue
        x0, y0, x1, y1 = block.get("bbox", (0, 0, 0, 0))
        bbox = norm_bbox(x0, y0, x1, y1, width, height)
        if bbox[2] <= 0 or bbox[3] <= 0:
            continue
        blocks.append(Block(text=text, bbox=bbox, native_text=text, status="native"))
    return blocks


def text_pixels(bbox: tuple[float, float, float, float], width: float, height: float) -> float:
    return bbox[2] * width * bbox[3] * height


def group_paragraphs(lines: list[OcrLine]) -> list[Block]:
    if not lines:
        return []
    # Split into columns using a vertical gutter in the x projection.
    columns: list[list[OcrLine]] = []
    sorted_lines = sorted(lines, key=lambda line: line.x0)
    gaps = []
    for left, right in zip(sorted_lines, sorted_lines[1:]):
        gaps.append((right.x0 - left.x1, left, right))
    gutter = max(gaps, key=lambda item: item[0]) if gaps else None
    if gutter and gutter[0] > 0.06:
        left_edge = gutter[1].x1
        right_edge = gutter[2].x0
        left = [line for line in lines if line.x1 <= left_edge + 0.02]
        right = [line for line in lines if line.x0 >= right_edge - 0.02]
        middle = [line for line in lines if line not in left and line not in right]
        if len(left) >= max(3, len(lines) * 0.2) and len(right) >= max(3, len(lines) * 0.2):
            columns = [right, left, middle] if middle else [right, left]
        else:
            columns = [lines]
    else:
        columns = [lines]

    blocks: list[Block] = []
    for column in columns:
        ordered = sorted(column, key=lambda line: (line.y0, -line.x0))
        current: list[OcrLine] = []
        for line in ordered:
            if not current:
                current = [line]
                continue
            prev = current[-1]
            gap = line.y0 - prev.y1
            height = max(0.008, (prev.height + line.height) / 2)
            horizontal = overlap_1d(prev.x0, prev.x1, line.x0, line.x1)
            if gap <= height * 1.6 and horizontal >= min(prev.bbox[2], line.bbox[2]) * 0.15:
                current.append(line)
            else:
                blocks.append(Block(text=clean(" ".join(item.text for item in current)), bbox=fold_bbox(current), status="ocr"))
                current = [line]
        if current:
            blocks.append(Block(text=clean(" ".join(item.text for item in current)), bbox=fold_bbox(current), status="ocr"))
    return blocks


def fold_bbox(lines: list[OcrLine]) -> tuple[float, float, float, float]:
    bbox = lines[0].bbox
    for line in lines[1:]:
        bbox = union(bbox, line.bbox)
    return bbox


def useful_segment(text: str) -> bool:
    value = clean(text)
    if len(value) < 2:
        return False
    if len(value) <= 3 and not ARABIC_RE.search(value) and not re.search(r"[A-Za-z]{2}", value):
        return False
    if re.fullmatch(r"[\d\s\-–.,()/]+", value) and len(value) < 8:
        return False
    return True


def extract_page(page: pymupdf.Page, lines: list[OcrLine], page_number: int) -> tuple[list[Block], str, str, list[str]]:
    width, height = page.rect.width, page.rect.height
    native = native_blocks(page)
    native_text = "\n".join(block.text for block in native)
    prefer_ocr = arabic_ratio(native_text) >= 0.12 or len(native_text.strip()) < 8
    warnings: list[str] = []
    if not prefer_ocr:
        segments = [block for block in native if useful_segment(block.text) and not (PAGE_NUMBER_RE.fullmatch(block.text) and (block.bbox[1] > 0.9 or block.bbox[1] + block.bbox[3] < 0.08))]
        page_text = "\n\n".join(block.text for block in segments)
        return segments, page_text, "native", warnings

    assigned: dict[int, list[OcrLine]] = defaultdict(list)
    leftovers: list[OcrLine] = []
    for line in lines:
        if PAGE_NUMBER_RE.fullmatch(line.text) and (line.y0 > 0.9 or line.y1 < 0.08):
            continue
        best_index = None
        best_overlap = 0.0
        for index, block in enumerate(native):
            area = intersection(line.bbox, block.bbox)
            if area > best_overlap:
                best_overlap = area
                best_index = index
        line_area = max(1e-9, line.bbox[2] * line.bbox[3])
        if best_index is not None and best_overlap / line_area >= 0.15:
            assigned[best_index].append(line)
        else:
            leftovers.append(line)

    segments: list[Block] = []
    dropped_arabic = 0
    for index, block in enumerate(native):
        ocr_lines = assigned.get(index, [])
        if ocr_lines:
            text = clean(" ".join(line.text for line in sorted(ocr_lines, key=lambda item: (item.y0, -item.x0))))
            segments.append(Block(text=text, bbox=block.bbox, native_text=block.native_text, status="ocr"))
        elif block.text and (MATH_RE.search(block.text) or arabic_ratio(block.text) < 0.5):
            segments.append(Block(text=block.text, bbox=block.bbox, native_text=block.native_text, status="native"))
        elif block.text and arabic_ratio(block.text) >= 0.5:
            dropped_arabic += 1
    if dropped_arabic:
        warnings.append(f"page {page_number}: dropped {dropped_arabic} OCR-missed native Arabic block(s)")
    segments.extend(group_paragraphs(leftovers))
    segments = [segment for segment in segments if useful_segment(segment.text)]
    segments.sort(key=lambda block: reading_key(block.bbox))
    if not segments and native_text.strip():
        segments = [Block(text=native_text, bbox=(0, 0, 1, 1), native_text=native_text, status="native")]
        warnings.append(f"page {page_number}: OCR produced no text; kept native text")
    page_text = "\n\n".join(segment.text for segment in segments)
    if not page_text.strip():
        warnings.append(f"page {page_number}: no text extracted")
    if MATH_RE.search(native_text) and sum(len(segment.text) for segment in segments) < len(native_text) * 0.5:
        warnings.append(f"page {page_number}: likely formula-heavy page; keep the page preview for math notation")
    return segments, page_text, "ocr" if any(segment.status == "ocr" for segment in segments) else "needs_ocr", warnings


def figure_kind(caption: str) -> str:
    if re.search(r"جدول|Table", caption, re.I):
        return "table"
    if re.search(r"خريطة|Map", caption, re.I):
        return "map"
    if re.search(r"مخطط|رسم|Figure|Chart|Graph", caption, re.I):
        return "graph" if re.search(r"رسم|Graph|Chart", caption, re.I) else "diagram"
    if re.search(r"شكل|Diagram", caption, re.I):
        return "diagram"
    return "illustration"


def figure_caption(lines: list[OcrLine], bbox: tuple[float, float, float, float], page: int) -> tuple[str, bool]:
    x0, y0, w, h = bbox
    y1 = y0 + h
    candidates: list[tuple[float, str]] = []
    for line in lines:
        if not (CAPTION_RE.search(line.text) or CAPTION_EN_RE.search(line.text)):
            continue
        overlap = overlap_1d(line.x0, line.x1, x0, x0 + w)
        if overlap < min(line.bbox[2], w) * 0.2:
            continue
        if 0 <= line.y0 - y1 <= 0.06:
            candidates.append((line.y0 - y1, line.text))
        elif 0 <= y0 - line.y1 <= 0.04:
            candidates.append((y0 - line.y1, line.text))
    if candidates:
        return clean(min(candidates, key=lambda item: item[0])[1])[:2000], True
    return f"صورة من صفحة {page}", False


def merge_rects(rects: list[tuple[float, float, float, float]]) -> list[tuple[float, float, float, float]]:
    merged = True
    while merged and len(rects) > 1:
        merged = False
        for left in range(len(rects)):
            for right in range(left + 1, len(rects)):
                a, b = rects[left], rects[right]
                ax0, ay0, ax1, ay1 = a
                bx0, by0, bx1, by1 = b
                inter_w = max(0.0, min(ax1, bx1) - max(ax0, bx0))
                inter_h = max(0.0, min(ay1, by1) - max(ay0, by0))
                inter = inter_w * inter_h
                area_a = max(1e-6, (ax1 - ax0) * (ay1 - ay0))
                area_b = max(1e-6, (bx1 - bx0) * (by1 - by0))
                contained = inter / min(area_a, area_b)
                gap_x = max(0.0, max(ax0, bx0) - min(ax1, bx1))
                gap_y = max(0.0, max(ay0, by0) - min(ay1, by1))
                adjacent = gap_x <= 2 and gap_y <= 2 and (inter_w > 0 or inter_h > 0)
                if contained > 0.45 or adjacent:
                    rects[left] = (min(ax0, bx0), min(ay0, by0), max(ax1, bx1), max(ay1, by1))
                    del rects[right]
                    merged = True
                    break
            if merged:
                break
    return rects


def extract_figures(page: pymupdf.Page, lines: list[OcrLine], page_number: int, asset_dir: Path, lesson_id: str | None, barcodes: list[tuple[float, float, float, float]]) -> list[Figure]:
    if not lesson_id:
        return []
    width, height = page.rect.width, page.rect.height
    candidates: list[tuple[float, float, float, float]] = []
    for info in page.get_image_info(xrefs=True):
        raw = info.get("bbox") or (0, 0, 0, 0)
        x0, y0, x1, y1 = (float(v) for v in raw)
        x0 = max(0.0, min(width, x0)); x1 = max(0.0, min(width, x1))
        y0 = max(0.0, min(height, y0)); y1 = max(0.0, min(height, y1))
        if x1 - x0 < 36 or y1 - y0 < 36:
            continue
        area = (x1 - x0) * (y1 - y0) / (width * height)
        if area < 0.012 or area > 0.45:
            continue
        aspect = (x1 - x0) / max(1e-6, y1 - y0)
        if aspect > 8 or aspect < 0.12:
            continue
        if (y1 < height * 0.07 or y0 > height * 0.93) and area < 0.08:
            continue
        if (x0 < 2 or x1 > width - 2) and (x1 - x0) < width * 0.15:
            continue
        candidates.append((x0, y0, x1, y1))

    figures: list[Figure] = []
    seen: set[str] = set()
    for x0, y0, x1, y1 in merge_rects(candidates):
        box_width = x1 - x0
        box_height = y1 - y0
        area = box_width * box_height / (width * height)
        if area < 0.03 or area > 0.45:
            continue
        aspect = box_width / max(1e-6, box_height)
        max_aspect = 6.5 if area >= 0.05 else 5.0
        if aspect > max_aspect or aspect < 0.18 or box_width < 60 or box_height < 60:
            continue
        if area > 0.08 and aspect < 0.4:
            continue
        bbox = norm_bbox(x0, y0, x1, y1, width, height)
        if any(intersection(bbox, barcode) / max(1e-9, barcode[2] * barcode[3]) > 0.4 for barcode in barcodes):
            continue
        caption, has_caption = figure_caption(lines, bbox, page_number)
        line_count = sum(1 for line in lines if x0 <= (line.x0 + line.x1) / 2 <= x1 and y0 <= (line.y0 + line.y1) / 2 <= y1 and len(line.text) > 2)
        text_coverage = sum(intersection(line.bbox, bbox) for line in lines if len(line.text) > 2) / max(1e-9, bbox[2] * bbox[3])
        if not has_caption and text_coverage > 0.17:
            continue
        if not has_caption and area < 0.12 and line_count >= 6:
            continue
        clip = pymupdf.Rect(x0, y0, x1, y1)
        pix = page.get_pixmap(clip=clip, dpi=150, alpha=False)
        data = pix.tobytes("png")
        digest = hashlib.sha256(data).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        object_key = f"assets/{digest}.png"
        target = asset_dir / f"{digest}.png"
        if not target.exists():
            target.write_bytes(data)
        kind = figure_kind(caption) if has_caption else "illustration"
        figures.append(Figure(
            id=f"p{page_number}-fig{len(figures) + 1}",
            page=page_number,
            bbox=bbox,
            kind=kind,
            caption=caption,
            purpose="Use the original textbook visual with its source citation.",
            width=pix.width,
            height=pix.height,
            object_key=object_key,
            sha256=digest,
        ))
    return figures


def save_page_preview(page: pymupdf.Page, page_number: int, asset_dir: Path) -> tuple[str, str, int, int]:
    pix = page.get_pixmap(dpi=100, alpha=False)
    data = pix.tobytes("png")
    digest = hashlib.sha256(data).hexdigest()
    object_key = f"assets/{digest}.png"
    target = asset_dir / f"{digest}.png"
    if not target.exists():
        target.write_bytes(data)
    return object_key, digest, pix.width, pix.height


def cover_year(doc: pymupdf.Document, ocr: dict[int, list[OcrLine]]) -> str:
    for page in range(1, min(4, len(doc)) + 1):
        text = " ".join(line.text for line in ocr.get(page, [])) + " " + norm(doc[page - 1].get_text("text"))
        match = re.search(r"20\d{2}\s*[-/]\s*20\d{2}", text)
        if match:
            years = sorted(re.findall(r"20\d{2}", match.group(0)))
            if len(years) == 2:
                return f"{years[0]}/{years[1]}"
    return "2026/2027"


def build_manifest(meta: dict[str, Any], units: list[Unit], figures_by_page: dict[int, list[Figure]], page_count: int) -> dict[str, Any]:
    unit_entries = []
    seen_visual_ids: set[str] = set()
    for unit in units:
        lessons = []
        for lesson in unit.lessons:
            pages = list(range(lesson.start_page, lesson.end_page + 1))
            if not pages:
                pages = [lesson.start_page]
            visuals = []
            for page_number in pages:
                for figure in figures_by_page.get(page_number, []):
                    # Adjacent lessons can share a boundary page when the printed
                    # TOC puts two rows on the same page; attach the figure to
                    # the first lesson only so visual ids stay unique.
                    if figure.id in seen_visual_ids:
                        continue
                    seen_visual_ids.add(figure.id)
                    figure.lesson_id = lesson.id
                    visuals.append({
                        "id": figure.id,
                        "page": figure.page,
                        "bbox": list(figure.bbox),
                        "kind": figure.kind,
                        "caption": figure.caption,
                        "purpose": figure.purpose,
                    })
            lessons.append({
                "id": lesson.id,
                "title": lesson.title,
                "order": lesson.order - 1,
                "objectives": lesson.objectives,
                "segments": [{"page": page_number} for page_number in pages],
                "visuals": visuals[:200],
            })
        unit_entries.append({"id": unit.id, "title": unit.title, "order": unit.order - 1, "lessons": lessons})
    return {
        "schemaVersion": 1,
        "course": meta["course"],
        "resource": meta["resource"],
        "units": unit_entries,
        "review": {"curriculumVerified": False, "contentVerified": False},
    }


def units_from_toc_json(payload: dict[str, Any], page_count: int) -> list[Unit]:
    """Build units/lessons from an LLM-transcribed TOC (scripts/toc-llm.py)."""
    units: list[Unit] = []
    for index, entry in enumerate(payload.get("units") or [], start=1):
        unit = Unit(id=f"u{index}", title=clean(str(entry.get("title") or "")) or f"وحدة {index}", order=index)
        for order, lesson in enumerate(entry.get("lessons") or [], start=1):
            printed = lesson.get("printedPage")
            if isinstance(printed, str):
                digits = re.sub(r"\D", "", printed)
                printed = int(digits) if digits else None
            if printed is not None and not 1 <= int(printed) <= page_count:
                printed = None
            unit.lessons.append(Lesson(
                id=f"u{index}-l{order}",
                title=clean(str(lesson.get("title") or "")) or f"درس {order}",
                order=order,
                printed_page=int(printed) if printed is not None else None,
                unit_order=index,
            ))
        if unit.lessons:
            units.append(unit)
    return [unit for unit in units if unit.lessons]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--grade", required=True, type=int)
    parser.add_argument("--term", required=True, type=int, choices=[1, 2])
    parser.add_argument("--subject", required=True)
    parser.add_argument("--subject-label", default="")
    parser.add_argument("--title", required=True)
    parser.add_argument("--kind", default="student_book", choices=["student_book", "workbook", "teacher_guide", "exam", "answer_key", "summary"])
    parser.add_argument("--track", default="general", choices=["general", "scientific", "literary"])
    parser.add_argument("--language", default="ar", choices=["ar", "en", "fr"])
    parser.add_argument("--download-url", default="")
    parser.add_argument("--source-url", default="https://elibrary.moe.edu.kw/StudentsLibrary")
    parser.add_argument("--dpi", type=int, default=200)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit-pages", type=int, default=0)
    parser.add_argument("--ocr-bin", type=Path, default=Path(os.environ.get("VISION_OCR_BIN", "scripts/bin/vision-ocr")))
    parser.add_argument("--toc-json", type=Path, default=None, help="Use an LLM-transcribed TOC instead of regex parsing")
    args = parser.parse_args()

    pdf_path = args.pdf.resolve()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    asset_dir = out / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    ocr_cache = out / "ocr"
    ocr_cache.mkdir(parents=True, exist_ok=True)
    if not args.ocr_bin.exists():
        raise SystemExit(f"Vision OCR binary not found at {args.ocr_bin}; run scripts/build-vision-ocr.sh")

    doc = pymupdf.open(pdf_path)
    page_count = min(len(doc), 500)
    if args.limit_pages:
        page_count = min(page_count, args.limit_pages)
    print(f"book {args.book_id}: {page_count} pages", file=sys.stderr)
    pages = list(range(1, page_count + 1))
    ocr, barcodes = render_pdf_pages(pdf_path, ocr_cache, args.dpi, pages, args.workers, args.ocr_bin)

    toc_pages: list[int] = []
    toc_source = "parsed"
    units: list[Unit] = []
    if args.toc_json:
        payload = json.loads(args.toc_json.read_text(encoding="utf-8"))
        units = units_from_toc_json(payload, page_count)
        toc_pages = [page for page in payload.get("tocPages") or [] if 1 <= int(page) <= page_count]
        toc_source = "llm" if units else "llm-empty"
        if not units:
            print("warning: toc-json yielded no units; falling back to regex parse", file=sys.stderr)
    if not units:
        units, toc_pages = build_toc(ocr, page_count)
        toc_source = "parsed" if units else "fallback"
    has_toc = bool(units)
    if not units:
        print("warning: no TOC parsed; falling back to 10-page chunks", file=sys.stderr)
        units = [Unit(id="u1", title="محتوى الكتاب", order=1)]
        for start in range(1, page_count + 1, 10):
            order = len(units[0].lessons) + 1
            units[0].lessons.append(Lesson(id=f"u1-l{order}", title=f"صفحات {start}-{min(page_count, start + 9)}", order=order, printed_page=start))
    if has_toc:
        assign_pages(units, ocr, page_count, toc_pages)
    else:
        for lesson in units[0].lessons:
            start = lesson.printed_page or 1
            lesson.start_page = start
            lesson.end_page = min(page_count, start + 9)

    figures_by_page: dict[int, list[Figure]] = defaultdict(list)
    page_previews: dict[int, tuple[str, str, int, int]] = {}
    extraction_lessons: dict[str, dict[str, Any]] = {}
    page_entries: list[dict[str, Any]] = []
    warnings: list[str] = []
    lesson_for_page: dict[int, str] = {}
    for unit in units:
        for lesson in unit.lessons:
            for page_number in range(lesson.start_page, lesson.end_page + 1):
                lesson_for_page[page_number] = lesson.id

    for page_number in pages:
        page = doc[page_number - 1]
        lines = ocr[page_number]
        segments, page_text, text_status, page_warnings = extract_page(page, lines, page_number)
        warnings.extend(page_warnings)
        preview_key, preview_sha, preview_w, preview_h = save_page_preview(page, page_number, asset_dir)
        page_previews[page_number] = (preview_key, preview_sha, preview_w, preview_h)
        page_entries.append({"page": page_number, "width": page.rect.width, "height": page.rect.height, "text": page_text, "textStatus": text_status})
        if lesson_id := lesson_for_page.get(page_number):
            extraction_lessons.setdefault(lesson_id, {"lessonId": lesson_id, "segments": [], "visualIds": []})
            for index, segment in enumerate(segments):
                extraction_lessons[lesson_id]["segments"].append({"page": page_number, "bbox": list(segment.bbox), "text": segment.text, "textStatus": segment.status})
        for figure in extract_figures(page, lines, page_number, asset_dir, lesson_for_page.get(page_number), barcodes.get(page_number, [])):
            figure.lesson_id = lesson_for_page.get(page_number)
            figures_by_page[page_number].append(figure)
            if figure.lesson_id:
                extraction_lessons.setdefault(figure.lesson_id, {"lessonId": figure.lesson_id, "segments": [], "visualIds": []})["visualIds"].append(figure.id)
        print(f"  page {page_number}/{page_count}: {len(segments)} segments, {len(figures_by_page.get(page_number, []))} figures", file=sys.stderr)
    academic_year = cover_year(doc, ocr)
    doc.close()

    for unit in units:
        for lesson in unit.lessons:
            extraction_lessons.setdefault(lesson.id, {"lessonId": lesson.id, "segments": [], "visualIds": []})
            if not extraction_lessons[lesson.id]["segments"]:
                warnings.append(f"lesson {lesson.id} has no extracted segments (pages {lesson.start_page}-{lesson.end_page})")

    figures = [figure for page_figures in figures_by_page.values() for figure in page_figures]
    assets = []
    for figure in figures:
        assets.append({
            "id": figure.id,
            "objectKey": figure.object_key,
            "sha256": figure.sha256,
            "mimeType": "image/png",
            "width": figure.width,
            "height": figure.height,
            "page": figure.page,
            "bbox": list(figure.bbox),
            "kind": figure.kind,
            "caption": figure.caption,
            "purpose": figure.purpose,
            "lessonIds": [figure.lesson_id] if figure.lesson_id else [],
        })
    for page_number, (key, digest, width, height) in page_previews.items():
        assets.append({
            "id": f"page-{page_number}",
            "objectKey": key,
            "sha256": digest,
            "mimeType": "image/png",
            "width": width,
            "height": height,
            "page": page_number,
            "bbox": [0, 0, 1, 1],
            "kind": "page",
            "caption": f"Page {page_number} preview",
            "purpose": "Use the full rendered textbook page as source context.",
            "lessonIds": [lesson_for_page[page_number]] if page_number in lesson_for_page else [],
        })

    resource = {
        "id": f"book-{args.book_id}",
        "title": args.title,
        "kind": args.kind,
        "sourceUrl": args.source_url,
        "publicationYear": academic_year.split("/")[0],
        "publisher": "Ministry of Education, State of Kuwait",
        "rightsNote": "Private local study reference retained under the private_reference access mode; not redistributed by this service.",
        "access": "private_reference",
    }
    if args.download_url:
        resource["downloadUrl"] = args.download_url
    meta = {
        "course": {
            "country": "KW",
            "curriculum": "kuwait-public",
            "academicYear": academic_year,
            "grade": args.grade,
            "track": args.track,
            "subject": args.subject,
            "semester": args.term,
            "edition": f"Kuwait MOE student library; {academic_year} edition",
            "language": args.language,
        },
        "resource": resource,
    }
    manifest = build_manifest(meta, units, figures_by_page, page_count)
    manifest_path = out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    source_sha = sha256_file(pdf_path)
    version_id = f"{args.book_id}-{source_sha[:12]}"
    extraction = {
        "versionId": version_id,
        "sourceSha256": source_sha,
        "originalKey": str(pdf_path),
        "pageCount": page_count,
        "extractor": "pymupdf+macos-vision(ar-SA,en-US)",
        "pages": page_entries,
        "lessons": [extraction_lessons[lesson.id] for unit in units for lesson in unit.lessons],
        "assets": assets,
        "warnings": sorted(set(warnings)),
    }
    (out / "extraction.json").write_text(json.dumps(extraction, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {
        "bookId": args.book_id,
        "pageCount": page_count,
        "tocPages": toc_pages,
        "tocSource": toc_source,
        "units": [{"id": unit.id, "title": unit.title, "lessons": [{"id": lesson.id, "title": lesson.title, "printedPage": lesson.printed_page, "startPage": lesson.start_page, "endPage": lesson.end_page} for lesson in unit.lessons]} for unit in units],
        "figures": len(figures),
        "warnings": sorted(set(warnings)),
    }
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "extraction": str(out / "extraction.json"), "units": len(units), "lessons": sum(len(unit.lessons) for unit in units), "figures": len(figures), "warnings": len(set(warnings))}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
