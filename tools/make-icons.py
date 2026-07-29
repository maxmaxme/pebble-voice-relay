#!/usr/bin/env python3
"""Draws the app icon at the three sizes Pebble needs.

Run with the repo venv: .venv/bin/python tools/make-icons.py
"""

import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKGROUND = (26, 62, 110)
FOREGROUND = (255, 255, 255)

# Everything is drawn on a 1000x1000 grid and scaled down, so the shape stays
# identical across sizes.
GRID = 1000


def draw_microphone(image, colour):
    d = ImageDraw.Draw(image)
    stroke = GRID // 12

    # Capsule.
    d.rounded_rectangle(
        (GRID * 0.38, GRID * 0.16, GRID * 0.62, GRID * 0.60),
        radius=GRID * 0.12,
        fill=colour,
    )
    # Cradle under it.
    d.arc(
        (GRID * 0.26, GRID * 0.34, GRID * 0.74, GRID * 0.76),
        start=0,
        end=180,
        fill=colour,
        width=stroke,
    )
    # Stem and base.
    d.line((GRID * 0.5, GRID * 0.72, GRID * 0.5, GRID * 0.86), fill=colour, width=stroke)
    d.line((GRID * 0.34, GRID * 0.86, GRID * 0.66, GRID * 0.86), fill=colour, width=stroke)


def menu_icon(size):
    """Launcher icon: Pebble treats it as a mask, so keep it strictly 1-bit."""
    big = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    draw_microphone(big, (0, 0, 0, 255))
    small = big.resize((size, size), Image.LANCZOS)

    # Antialiasing leaves partial alpha; snap it back to on/off.
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.putdata([(0, 0, 0, 255) if p[3] > 110 else (0, 0, 0, 0) for p in small.convert("RGBA").get_flattened_data()])
    return out


def store_icon(size):
    big = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, GRID - 1, GRID - 1), radius=GRID * 0.22, fill=BACKGROUND + (255,)
    )
    draw_microphone(big, FOREGROUND + (255,))
    return big.resize((size, size), Image.LANCZOS)


def main():
    targets = [
        (ROOT / "resources/images/menu-icon.png", menu_icon(25)),
        (ROOT / "store/icon-80.png", store_icon(80)),
        (ROOT / "store/icon-144.png", store_icon(144)),
    ]
    for path, image in targets:
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
        print("wrote {} ({}x{})".format(path.relative_to(ROOT), *image.size))


if __name__ == "__main__":
    main()
