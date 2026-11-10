#!/usr/bin/env python3
"""Generate every WisprRam icon from the logo artwork (client/build/logo-source.png).

The source is the 1254x1254 app-tile artwork: the purple "W" wave with sound bars over a dark
rounded square. We extract the wave mark (separated from the gradient background), then compose:
  client/build/icon.png                 1024  app icon (macOS grid: 824 tile, 100 px margin)
  client/resources/icon.png             512   runtime app icon
  client/resources/tray/*               menu-bar / tray icons (template + colour, @1x/@2x)
  client/src/renderer/src/assets/logo-mark.png   transparent wave mark for the app sidebar
  site/assets/{favicon-32,favicon,icon-512,apple-touch-icon,og}.png
Run:  uv run --with pillow --with numpy python client/build/make-icons.py [Figtree.ttf] [InstrumentSerif-Italic.ttf]
      (the two fonts are only used for site/assets/og.png; see FONT_* below)
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "client/build/logo-source.png"
FONT_SANS = Path(sys.argv[1]) if len(sys.argv) > 1 else None   # Figtree[wght].ttf (optional)
FONT_SERIF = Path(sys.argv[2]) if len(sys.argv) > 2 else None  # InstrumentSerif-Italic.ttf (optional)

BG_TOP = (20, 18, 30)        # tile gradient: near-black navy …
BG_BOTTOM = (16, 10, 32)
GLOW = (96, 48, 220)         # … with a violet glow in the bottom-right corner, as in the artwork


def extract_mark(src: Image.Image) -> Image.Image:
    """Wave + bars as RGBA, separated from the artwork's gradient background.

    The background is not flat (it glows violet towards the bottom-right), so a plain brightness
    threshold leaks a box of background into the mark. Instead: roughly mask the mark, estimate the
    background under it by normalised convolution of the unmasked pixels, and take alpha from how
    far each pixel is from that background. Colour is un-mixed from the background estimate."""
    import numpy as np

    w, h = src.size
    # x: inside the artwork's rounded tile, whose edges would otherwise show as vertical lines
    band = src.crop((int(w * 0.15), int(h * 0.26), int(w * 0.785), int(h * 0.60))).convert("RGB")
    a = np.asarray(band, dtype=np.float32)
    rough = Image.fromarray(((a[..., 1] > 55) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(31))
    keep = 1.0 - np.asarray(rough, dtype=np.float32) / 255.0

    def blur(arr: np.ndarray, radius: float) -> np.ndarray:  # arr in 0..255
        im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        return np.asarray(im.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)

    k = blur(keep * 255.0, 45) / 255.0 + 1e-4
    bg = np.stack([blur(a[..., c] * keep, 45) for c in range(3)], axis=-1) / k[..., None]
    diff = np.abs(a - bg).max(axis=-1)
    alpha = np.clip((diff - 22.0) * 255.0 / 70.0, 0, 255)
    al = np.maximum(alpha / 255.0, 1e-3)[..., None]
    fg = np.clip(bg + (a - bg) / al, 0, 255)
    mark = Image.fromarray(np.dstack([fg, alpha]).astype(np.uint8))
    bbox = Image.fromarray(alpha.astype(np.uint8)).point(lambda v: 255 if v > 60 else 0).getbbox()
    return mark.crop(bbox)


def tile(size: int, radius: float = 0.225, inset: int = 0, mark: Image.Image | None = None,
         mark_width: float = 0.74, rounded: bool = True) -> Image.Image:
    """Dark gradient tile with a violet corner glow and the mark centred."""
    side = size - 2 * inset
    t = Image.new("RGB", (side, side))
    px = t.load()
    for y in range(side):
        k = y / (side - 1)
        row = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * k) for i in range(3))
        for x in range(side):
            px[x, y] = row
    glow = Image.new("L", (side, side), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((int(side * 0.45), int(side * 0.55), int(side * 1.45), int(side * 1.55)), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(side * 0.18)).point(lambda v: int(v * 0.85))
    t = Image.composite(Image.new("RGB", (side, side), GLOW), t, glow).convert("RGBA")
    if mark is not None:
        mw = int(side * mark_width)
        mh = int(mark.height * mw / mark.width)
        m = mark.resize((mw, mh), Image.LANCZOS)
        t.alpha_composite(m, ((side - mw) // 2, (side - mh) // 2))
    if rounded:
        mask = Image.new("L", (side * 4, side * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, side * 4 - 1, side * 4 - 1), radius=int(side * 4 * radius), fill=255)
        t.putalpha(mask.resize((side, side), Image.LANCZOS))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(t, (inset, inset))
    return out


def silhouette(mark: Image.Image, w: int, h: int, color=(0, 0, 0), dot: bool = False) -> Image.Image:
    """Single-colour glyph (macOS template images use black + alpha). Optional recording dot."""
    room = (max(4, h // 3) + 2) if dot else 0  # keep the dot clear of the glyph
    scale = min((w - 2 * room) / mark.width, h / mark.height)
    mw, mh = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
    a = mark.getchannel("A").resize((mw, mh), Image.LANCZOS).point(lambda v: 255 if v > 90 else int(v * 2.8))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    glyph = Image.new("RGBA", (mw, mh), color + (255,))
    glyph.putalpha(a)
    out.alpha_composite(glyph, ((w - mw) // 2, (h - mh) // 2))
    if dot:
        d = max(4, h // 3)
        ImageDraw.Draw(out).ellipse((w - d, 0, w - 1, d - 1), fill=(color if color == (0, 0, 0) else (239, 68, 68)) + (255,))
    return out


def coloured(mark: Image.Image, w: int, h: int, dot: bool = False) -> Image.Image:
    room = (max(6, h // 3) // 2) if dot else 0
    scale = min((w - 2 * room) / mark.width, h / mark.height)
    mw, mh = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(mark.resize((mw, mh), Image.LANCZOS), ((w - mw) // 2, (h - mh) // 2))
    if dot:
        d = max(6, h // 3)
        ImageDraw.Draw(out).ellipse((w - d, 0, w - 1, d - 1), fill=(239, 68, 68, 255))
    return out


def og_image(mark: Image.Image) -> Image.Image:
    W, H = 1200, 630
    img = tile(W, mark=None, rounded=False).resize((W, W)).crop((0, (W - H) // 2, W, (W - H) // 2 + H))
    icon = tile(300, mark=mark)
    img.alpha_composite(icon, (110, (H - 300) // 2))
    d = ImageDraw.Draw(img)
    try:
        sans = ImageFont.truetype(str(FONT_SANS), 92) if FONT_SANS else ImageFont.load_default(92)
        if FONT_SANS:
            sans.set_variation_by_axes([680])
        serif = ImageFont.truetype(str(FONT_SERIF), 76) if FONT_SERIF else ImageFont.load_default(70)
        small = ImageFont.truetype(str(FONT_SANS), 32) if FONT_SANS else ImageFont.load_default(30)
        if FONT_SANS:
            small.set_variation_by_axes([450])
    except Exception:  # pragma: no cover - fallback when fonts are missing
        sans = serif = small = ImageFont.load_default()
    x = 470
    d.text((x, 168), "WisprRam", font=sans, fill=(255, 255, 255))
    d.text((x, 290), "Wispr to your RAM.", font=serif, fill=(214, 196, 255))
    d.text((x, 404), "Self-hosted voice dictation on your own GPU.", font=small, fill=(196, 190, 214))
    d.text((x, 450), "macOS · Windows · Linux · open source", font=small, fill=(150, 144, 170))
    return img.convert("RGB")


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    mark = extract_mark(src)

    def save(img: Image.Image, rel: str) -> None:
        p = ROOT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        img.save(p, optimize=True)
        print(f"{rel:52s} {img.size[0]}x{img.size[1]}")

    save(tile(1024, inset=100, mark=mark), "client/build/icon.png")
    save(tile(512, inset=50, mark=mark), "client/resources/icon.png")
    # macOS menu bar: template images (black + alpha), 16 pt tall, wider than tall like the mark
    save(silhouette(mark, 32, 16), "client/resources/tray/trayTemplate.png")
    save(silhouette(mark, 64, 32), "client/resources/tray/trayTemplate@2x.png")
    save(silhouette(mark, 32, 16, dot=True), "client/resources/tray/trayRecordingTemplate.png")
    save(silhouette(mark, 64, 32, dot=True), "client/resources/tray/trayRecordingTemplate@2x.png")
    # Windows / Linux trays: coloured mark on transparent, 32 px square
    save(coloured(mark, 32, 32), "client/resources/tray/tray.png")
    save(coloured(mark, 32, 32, dot=True), "client/resources/tray/tray-recording.png")
    # App sidebar / onboarding mark (transparent)
    save(coloured(mark, 480, int(480 * mark.height / mark.width)), "client/src/renderer/src/assets/logo-mark.png")
    # Website
    save(tile(32, mark=mark, mark_width=0.84), "site/assets/favicon-32.png")
    save(tile(64, mark=mark, mark_width=0.82), "site/assets/favicon.png")
    save(tile(512, mark=mark), "site/assets/icon-512.png")
    save(tile(180, mark=mark, rounded=False).convert("RGB"), "site/assets/apple-touch-icon.png")
    save(og_image(mark), "site/assets/og.png")


if __name__ == "__main__":
    main()
