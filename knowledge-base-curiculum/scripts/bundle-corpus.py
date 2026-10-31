#!/usr/bin/env python3
"""Build an authenticated-transfer bundle; never include the output in Git."""
import argparse
import base64
import gzip
import hashlib
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--staging', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--latest-editions', action='store_true',
                        help='Bundle only the newest edition per (grade, semester, subject, track);'
                             ' every book of that edition year is kept as a version')
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit('Refusing to overwrite an existing bundle')
    if args.latest_editions:
        groups = {}
        for directory in sorted(args.staging.glob('book-*')):
            manifest = json.loads((directory / 'manifest.json').read_text())
            course = manifest['course']
            groups.setdefault((course['grade'], course['semester'], course['subject'], course['track']), []).append(
                (course['academicYear'], manifest['resource']['kind'], directory))
        keep = set()
        for members in groups.values():
            # Prefer the newest edition that actually contains a student book;
            # a newer workbook alone must not displace the older student book,
            # because workbook-only courses lose their primary content.
            student_years = [year for year, kind, _ in members if kind == 'student_book']
            if student_years:
                chosen_year = max(student_years)
            else:
                teacher_years = [year for year, kind, _ in members if kind == 'teacher_guide']
                chosen_year = max(teacher_years) if teacher_years else max(year for year, _, _ in members)
            same_year = [(kind, directory) for year, kind, directory in members if year == chosen_year]
            students = [directory for kind, directory in same_year if kind == 'student_book']
            keep.update(directory for _, directory in same_year)
            # Multiple uploads of the same book (same year, same kind, near
            # identical page counts) duplicate the whole course content; keep
            # only the largest extraction.
            for kind in ('student_book', 'workbook', 'teacher_guide'):
                same_kind = [(directory, len(json.loads((directory / 'extraction.json').read_text()).get('pages', [])))
                             for k, directory in same_year if k == kind]
                if len(same_kind) > 1:
                    counts = [count for _, count in same_kind]
                    if max(counts) - min(counts) <= 3:
                        best = max(same_kind, key=lambda item: item[1])[0]
                        for directory, _ in same_kind:
                            if directory is not best:
                                keep.discard(directory)
                                print(f'Dropping duplicate upload {directory.name}')
    else:
        keep = None
    seen = {}
    books = 0
    with args.out.open('xb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=1, mtime=0) as output:
        def emit(record):
            output.write((json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n').encode())
        for directory in sorted(args.staging.glob('book-*')):
            if keep is not None and directory not in keep:
                print(f'Skipping {directory.name} (older edition)')
                continue
            manifest = json.loads((directory / 'manifest.json').read_text())
            extraction = json.loads((directory / 'extraction.json').read_text())
            emit({'type': 'book', 'manifest': manifest, 'extraction': extraction})
            for asset in extraction['assets']:
                key = asset['objectKey']
                if not re.fullmatch(r'assets/[a-f0-9]{64}\.png', key):
                    raise ValueError('Unexpected asset path')
                if key in seen:
                    if seen[key] != asset['sha256']:
                        raise ValueError('Conflicting asset digest')
                    continue
                data = (directory / key).read_bytes()
                digest = hashlib.sha256(data).hexdigest()
                if digest != asset['sha256']:
                    raise ValueError(f'Asset checksum mismatch in {directory.name}')
                emit({'type': 'asset', 'key': key, 'sha256': digest, 'data': base64.b64encode(data).decode('ascii')})
                seen[key] = digest
            books += 1
            print(f'Bundled {directory.name} ({books} books, {len(seen)} unique assets)', flush=True)
    with args.out.open('rb') as bundle:
        digest = hashlib.file_digest(bundle, 'sha256').hexdigest()
    print(json.dumps({'books': books, 'assets': len(seen), 'bytes': args.out.stat().st_size, 'sha256': digest}))


if __name__ == '__main__':
    main()
