#!/usr/bin/env python3
"""Generate WisprRam icons (reproducible). Requires Pillow: pip install pillow
Run from anywhere:  python3 client/build/make-icons.py
Outputs: build/icon.png (1024), resources/icon.png (512), resources/tray/*.png
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent          # client/build
CLIENT = HERE.parent
RES = CLIENT / "resources"
TRAY = RES / "tray"
SS = 4  # supersampling factor

# waveform bars: (x center, height) as fractions of the glyph box (0..1)
BARS = [(0.10, 0.28), (0.30, 0.60), (0.50, 1.00), (0.70, 0.60), (0.90, 0.28)]


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def app_icon(size=1024):
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    # gradient indigo (#4F46E5) -> violet (#8B5CF6), diagonal
    c1, c2 = (79, 70, 229), (139, 92, 246)
    # build via linear gradient on a small image then resize (fast)
    g = Image.new("RGB", (256, 256))
    gp = g.load()
    for y in range(256):
        for x in range(256):
            t = (x + y) / 510.0
            gp[x, y] = lerp(c1, c2, t)
    grad = g.resize((s, s), Image.BICUBIC).convert("RGBA")
    # macOS-style squircle-ish rounded square: 824/1024 body, radius ~ 185/1024
    m = int(s * 100 / 1024)
    body = (m, m, s - m, s - m)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle(body, radius=int(s * 185 / 1024), fill=255)
    img.paste(grad, (0, 0), mask)
    # soft top-to-bottom sheen (white 34 -> 0 alpha over the upper 60 %)
    sheen = Image.new("L", (1, 256))
    for y in range(256):
        sheen.putpixel((0, y), int(max(0.0, 1 - y / (256 * 0.6)) * 34))
    sheen = sheen.resize((s, s), Image.BILINEAR)
    sheen = Image.composite(sheen, Image.new("L", (s, s), 0), mask)
    white = Image.new("RGBA", (s, s), (255, 255, 255, 255))
    white.putalpha(sheen)
    img = Image.alpha_composite(img, white)
    # white waveform glyph centered
    d = ImageDraw.Draw(img)
    gw, gh = s * 470 / 1024, s * 400 / 1024
    cx, cy = s / 2, s / 2
    bw = s * 62 / 1024
    for fx, fh in BARS:
        x = cx - gw / 2 + fx * gw
        h = gh * fh
        d.rounded_rectangle((x - bw / 2, cy - h / 2, x + bw / 2, cy + h / 2), radius=bw / 2, fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


def tray_glyph(px, recording=False, color=(0, 0, 0), fg_alpha=255):
    """Return RGBA px*px glyph on transparent. recording => 4 bars + dot."""
    s = px * 8
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fill = color + (fg_alpha,)
    pad = s * 0.08
    box = s - 2 * pad
    if not recording:
        bw = s * 0.115
        for fx, fh in BARS:
            x = pad + bw / 2 + ((fx - 0.10) / 0.80) * (box - bw)
            h = box * fh if fh >= 0.5 else box * 0.34
            d.rounded_rectangle((x - bw / 2, s / 2 - h / 2, x + bw / 2, s / 2 + h / 2), radius=bw / 2, fill=fill)
    else:
        # 3 bars on the left, filled dot on the right
        bw = s * 0.125
        xs = [pad + bw / 2, pad + bw / 2 + box * 0.19, pad + bw / 2 + box * 0.38]
        hs = [box * 0.38, box * 0.80, box * 0.50]
        for x, h in zip(xs, hs):
            d.rounded_rectangle((x - bw / 2, s / 2 - h / 2, x + bw / 2, s / 2 + h / 2), radius=bw / 2, fill=fill)
        r = s * 0.15
        cx = s - pad - r
        d.ellipse((cx - r, s / 2 - r, cx + r, s / 2 + r), fill=fill)
    return img.resize((px, px), Image.LANCZOS)


def dmg_background(w=660, h=400, scale=1):
    """Light background with an arrow between the app slot (left) and Applications (right)."""
    W, H = w * scale * SS, h * scale * SS
    img = Image.new("RGBA", (W, H), (246, 245, 255, 255))
    d = ImageDraw.Draw(img)
    for y in range(H):  # soft vertical gradient
        c = lerp((250, 249, 255), (232, 230, 252), y / H)
        d.line((0, y, W, y), fill=c + (255,))
    k = W / w
    col = (124, 111, 240, 255)
    y0 = 185 * k
    d.line((265 * k, y0, 385 * k, y0), fill=col, width=int(7 * k))
    d.line((365 * k, y0 - 22 * k, 395 * k, y0), fill=col, width=int(7 * k))
    d.line((365 * k, y0 + 22 * k, 395 * k, y0), fill=col, width=int(7 * k))
    return img.resize((w * scale, h * scale), Image.LANCZOS).convert("RGB")


def main():
    RES.mkdir(exist_ok=True)
    TRAY.mkdir(exist_ok=True)
    (HERE).mkdir(exist_ok=True)
    big = app_icon(1024)
    big.save(HERE / "icon.png")
    big.resize((512, 512), Image.LANCZOS).save(RES / "icon.png")
    # macOS template images: black on transparent
    for rec, name in ((False, "trayTemplate"), (True, "trayRecordingTemplate")):
        tray_glyph(16, rec).save(TRAY / f"{name}.png")
        tray_glyph(32, rec).save(TRAY / f"{name}@2x.png")
    # colored for Windows/Linux (indigo glyph; recording = red)
    tray_glyph(32, False, color=(99, 102, 241)).save(TRAY / "tray.png")
    tray_glyph(32, True, color=(239, 68, 68)).save(TRAY / "tray-recording.png")
    dmg_background().save(HERE / "background.png")
    dmg_background(scale=2).save(HERE / "background@2x.png")
    print("icons written")


if __name__ == "__main__":
    main()
