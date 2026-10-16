#!/usr/bin/env python3
"""Verify that every evidence-card quote appears verbatim on its stated PDF page.

Usage:  python3 scripts/verify_cards.py --pdf-dir /path/to/pdfs
The folder must contain one PDF per source, named <source-key>.pdf (e.g. brandt2014.pdf).
Requires poppler's `pdftotext`. PDFs are NOT part of this repository (copyright).

Matching is robust to line breaks, hyphenation at line ends, ligatures (ﬁ→fi), curly quotes
and two-column layouts (both layout and raw text extraction are tried).
"""
import argparse, json, re, subprocess, sys, unicodedata
from pathlib import Path

def norm(s):
    s = unicodedata.normalize('NFKC', s)
    for a, b in (('­', ''), ('’', "'"), ('‘', "'"), ('“', '"'), ('”', '"'), ('–', '-'), ('—', '-')):
        s = s.replace(a, b)
    s = re.sub(r'-\s*\n\s*', '', s)
    return re.sub(r'[^a-z0-9]', '', s.lower())

def pages(pdf):
    out = []
    for mode in (['-layout'], []):
        txt = subprocess.run(['pdftotext', *mode, str(pdf), '-'], capture_output=True, text=True).stdout
        for i, p in enumerate(txt.split('\f')):
            if len(out) <= i: out.append([])
            out[i].append(norm(p))
    return out

ap = argparse.ArgumentParser()
ap.add_argument('--pdf-dir', required=True)
ap.add_argument('--cards', default=str(Path(__file__).parent.parent / 'knowledge' / 'evidence-cards.json'))
a = ap.parse_args()
cards = json.load(open(a.cards))
cache, fails, missing = {}, [], set()
for c in cards:
    key = c['source']
    if key not in cache:
        pdf = Path(a.pdf_dir) / f'{key}.pdf'
        cache[key] = pages(pdf) if pdf.exists() else None
        if cache[key] is None: missing.add(key)
    pg = cache[key]
    if pg is None: continue
    i = c['pdf_page'] - 1
    if not (0 <= i < len(pg)) or not any(norm(c['quote']) in p for p in pg[i]):
        fails.append(c)
checked = sum(1 for c in cards if cache.get(c['source']) is not None)
print(f'{checked - len(fails)}/{checked} quotes verified on their stated page')
if missing: print('No PDF found for:', ', '.join(sorted(missing)))
for c in fails: print('  FAIL', c['id'], 'p.', c['pdf_page'], '-', c['quote'][:80])
sys.exit(1 if fails else 0)
