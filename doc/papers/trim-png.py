#!/usr/bin/env python3
"""trim-png.py — crop the white letterbox/canvas margins from figure PNGs, keeping a small
uniform border (idempotent). The chromium SVG screenshot letterboxes the drawing inside the
viewport, so the raw PNGs swim in whitespace and render too small under \\includegraphics.
Usage: python3 trim-png.py <png> [<png> ...]"""
import sys
from PIL import Image, ImageChops

PAD = 12  # white border kept around the content, in (2x) pixels

for f in sys.argv[1:]:
    im = Image.open(f).convert('RGB')
    bbox = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).getbbox()
    if not bbox:
        print(f, 'blank — skipped'); continue
    l, t, r, b = bbox
    box = (max(0, l - PAD), max(0, t - PAD), min(im.width, r + PAD), min(im.height, b + PAD))
    im.crop(box).save(f)
    print(f, f'{im.width}x{im.height} -> {box[2]-box[0]}x{box[3]-box[1]}')
