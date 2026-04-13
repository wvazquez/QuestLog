#!/usr/bin/env python3
"""
Run this script once to generate the QuestLog app icons.
Requires: pip install Pillow
Usage: python3 generate_icons.py
"""
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Installing Pillow...")
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont

import os

os.makedirs("icons", exist_ok=True)

def make_icon(size):
    img = Image.new("RGB", (size, size), color="#0a0a0f")
    draw = ImageDraw.Draw(img)

    # Background gradient effect (solid purple circle)
    margin = size // 8
    draw.ellipse([margin, margin, size - margin, size - margin], fill="#7c6cfc")

    # Inner circle
    m2 = size // 5
    draw.ellipse([m2, m2, size - m2, size - m2], fill="#12121a")

    # Sword emoji / text
    font_size = size // 3
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except:
        font = ImageFont.load_default()

    text = "Q"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(((size - tw) // 2, (size - th) // 2 - size // 15), text, fill="#7c6cfc", font=font)

    return img

img192 = make_icon(192)
img192.save("icons/icon-192.png", "PNG")
print("✓ icons/icon-192.png created")

img512 = make_icon(512)
img512.save("icons/icon-512.png", "PNG")
print("✓ icons/icon-512.png created")

print("\nDone! Add the icons/ folder to your git repo.")
