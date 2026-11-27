#!/usr/bin/env python3
from __future__ import annotations
"""
Deterministic Oriental ink-wash Retina 3K (2880x1620) scene media builder.

Uses a two-octave ffmpeg Lanczos + AMD FidelityFX Contrast Adaptive Sharpening (cas)
pipeline plus flat-sky pre-conditioning and dark-ink micro-contrast enhancement so
2x Retina displays render crisp sumi-e brushwork without JPEG block amplification.

Drop any new bespoke painting into scripts/assets/scenes/<id>-bg-master.{png,jpg,webp}
and re-run `python3 scripts/build-scene-media.py` to upgrade that scene automatically.
"""

from pathlib import Path
import subprocess
import tempfile
import numpy as np
from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
SCENES_SRC = REPO_ROOT / "scripts" / "assets" / "scenes"
PORTRAITS_SRC = REPO_ROOT / "scripts" / "assets"
OUT_DIR = REPO_ROOT / "public" / "assets" / "scenes"
LAYERS_OUT = OUT_DIR / "layers"

FFMPEG_BIN = "/opt/homebrew/bin/ffmpeg" if Path("/opt/homebrew/bin/ffmpeg").exists() else "ffmpeg"
TARGET_SIZE = (2880, 1620)
WEBP_QUALITY = 94


def find_master(stem: str) -> Path | None:
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        candidate = SCENES_SRC / f"{stem}{ext}"
        if candidate.exists():
            return candidate
    return None


def to_f32(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0


def from_f32(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr * 255.0, 0, 255).astype(np.uint8))


def precondition_flat_sky(img: Image.Image) -> Image.Image:
    """Smooth only ultra-flat low-gradient regions (<0.012) so JPEG sky blocks never sharpen."""
    rgb = img.convert("RGB")
    arr = to_f32(rgb)
    smooth = to_f32(rgb.filter(ImageFilter.GaussianBlur(radius=1.1)))
    lum = arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114
    gx = np.abs(np.diff(lum, axis=1, prepend=lum[:, :1]))
    gy = np.abs(np.diff(lum, axis=0, prepend=lum[:1, :]))
    grad = np.hypot(gx, gy)
    flat_mask = np.clip((0.014 - grad) / 0.010, 0.0, 1.0)[..., None]
    blended = arr * (1.0 - flat_mask * 0.72) + smooth * (flat_mask * 0.72)
    return from_f32(blended)


def enhance_ink_crispness(arr: np.ndarray) -> np.ndarray:
    """Subtle dark-ink tonal anchor so calligraphy lines stay rich sumi-black."""
    lum = (arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114)[..., None]
    # Gently deepen dark ink strokes (lum < 0.30) while preserving bright moon & mist highlights.
    dark_pull = np.clip((0.30 - lum) / 0.30, 0.0, 1.0)
    factor = 1.0 - 0.075 * (dark_pull * dark_pull)
    return np.clip(arr * factor, 0.0, 1.0)


def ffmpeg_retina_upscale(
    img: Image.Image,
    size: tuple[int, int] = TARGET_SIZE,
    cas1: float = 0.60,
    cas2: float = 0.52,
    unsharp_amt: float = 0.38,
) -> Image.Image:
    tw, th = size
    mid_w = max(tw // 2, int(round(tw * 0.75)))
    mid_h = max(th // 2, int(round(th * 0.75)))
    mid_w += mid_w % 2
    mid_h += mid_h % 2

    cleaned = precondition_flat_sky(img)
    with tempfile.TemporaryDirectory() as tmp:
        in_png = Path(tmp) / "in.png"
        out_png = Path(tmp) / "out.png"
        cleaned.save(in_png, format="PNG")
        vf = (
            f"scale={mid_w}:{mid_h}:flags=lanczos+accurate_rnd+full_chroma_int,"
            f"cas={cas1:.2f},"
            f"scale={tw}:{th}:flags=lanczos+accurate_rnd+full_chroma_int,"
            f"cas={cas2:.2f},"
            f"unsharp=3:3:{unsharp_amt:.2f}:3:3:0.0"
        )
        subprocess.run(
            [FFMPEG_BIN, "-y", "-loglevel", "error", "-i", str(in_png), "-vf", vf, str(out_png)],
            check=True,
        )
        upscaled = Image.open(out_png).convert("RGB")
        arr = enhance_ink_crispness(to_f32(upscaled))
        return from_f32(arr)


def cover_crop(img: Image.Image, target_ratio: float, focal=(0.5, 0.5)) -> Image.Image:
    sw, sh = img.size
    src_ratio = sw / sh
    if src_ratio > target_ratio:
        new_w = int(round(sh * target_ratio))
        left = max(0, min(sw - new_w, int(round((sw - new_w) * focal[0]))))
        return img.crop((left, 0, left + new_w, sh))
    new_h = int(round(sw / target_ratio))
    top = max(0, min(sh - new_h, int(round((sh - new_h) * focal[1]))))
    return img.crop((0, top, sw, top + new_h))


def cover_resize_retina(
    img: Image.Image,
    size: tuple[int, int] = TARGET_SIZE,
    focal=(0.5, 0.5),
    cas1: float = 0.60,
    cas2: float = 0.52,
    unsharp_amt: float = 0.38,
) -> Image.Image:
    cropped = cover_crop(img.convert("RGB"), size[0] / size[1], focal=focal)
    return ffmpeg_retina_upscale(cropped, size=size, cas1=cas1, cas2=cas2, unsharp_amt=unsharp_amt)


def save_scene_webp(img: Image.Image, out_path: Path, quality: int = WEBP_QUALITY) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, format="WEBP", quality=quality, method=6)
    kb = out_path.stat().st_size / 1024
    print(f"  wrote {out_path.relative_to(REPO_ROOT)} ({img.size[0]}x{img.size[1]}, {kb:.1f} KB)")


def radial_mask(h: int, w: int, cx: float, cy: float, rx: float, ry: float, power: float = 2.0) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = (xx / w - cx) / max(rx, 1e-4)
    ny = (yy / h - cy) / max(ry, 1e-4)
    d = np.sqrt(nx * nx + ny * ny)
    return np.clip(1.0 - np.power(np.clip(d, 0.0, 1.0), power), 0.0, 1.0)


def build_sign_in() -> Image.Image:
    master = find_master("sign-in-bg-master")
    assert master is not None, "sign-in-bg-master is required"
    return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))


def build_lobby() -> Image.Image:
    master = find_master("lobby-bg-master")
    assert master is not None, "lobby-bg-master is required"
    return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))


def build_game_night() -> Image.Image:
    master = find_master("game-night-bg-master")
    assert master is not None, "game-night-bg-master is required"
    return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))


def build_game_day(night_3k: Image.Image) -> Image.Image:
    master = find_master("game-day-bg-master")
    if master is not None:
        return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))

    arr = to_f32(night_3k)
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ny = yy / h
    nx = xx / w

    moon_veil = radial_mask(h, w, 0.695, 0.08, 0.25, 0.28, power=1.6)[..., None]
    sky_mist = np.array([0.135, 0.145, 0.155], dtype=np.float32)
    arr = arr * (1.0 - moon_veil * 0.96) + sky_mist * (moon_veil * 0.96)

    lum = (arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114)[..., None]
    dawn_slate = np.concatenate([
        lum * 1.12 + 0.026,
        lum * 1.05 + 0.020,
        lum * 0.92 + 0.012,
    ], axis=-1)
    arr = arr * 0.28 + dawn_slate * 0.72

    horizon_glow = np.exp(-np.power((ny - 0.60) / 0.26, 2.0)) * np.exp(-np.power((nx - 0.50) / 0.56, 2.0))
    dawn_color = np.array([0.54, 0.39, 0.22], dtype=np.float32)
    mist_weight = np.clip((lum[..., 0] - 0.04) / 0.26, 0.18, 1.0)
    arr += dawn_color * (horizon_glow * mist_weight * 0.34)[..., None]

    upper_haze = np.exp(-np.power((ny - 0.16) / 0.30, 2.0)) * 0.06
    arr += np.array([0.66, 0.63, 0.58], dtype=np.float32) * upper_haze[..., None]

    arr = np.clip(arr * 0.94, 0.0, 0.82)
    return from_f32(arr)


def build_match_setup(sign_in_3k: Image.Image, night_3k: Image.Image) -> Image.Image:
    master = find_master("match-setup-bg-master")
    if master is not None:
        return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))

    tw, th = TARGET_SIZE
    sw, sh = sign_in_3k.size
    blend_w = int(round(tw * (1280 / 1920)))
    valley_left = ffmpeg_retina_upscale(
        sign_in_3k.crop((0, 0, int(sw * 0.59), sh)),
        size=(blend_w, th),
        cas1=0.45,
        cas2=0.42,
        unsharp_amt=0.30,
    )

    canvas = to_f32(night_3k).copy()
    arr_left = to_f32(valley_left)

    lantern_veil = radial_mask(th, tw, 0.92, 0.72, 0.14, 0.26, power=1.8)[..., None]
    canvas *= (1.0 - lantern_veil * 0.45)

    fade_x = np.ones((blend_w,), dtype=np.float32)
    ramp_len = int(round(tw * (520 / 1920)))
    t = np.linspace(1.0, 0.0, ramp_len, dtype=np.float32)
    fade_x[blend_w - ramp_len:] = t * t * (3.0 - 2.0 * t)
    canvas[:, :blend_w] = canvas[:, :blend_w] * (1.0 - fade_x[None, :, None]) + arr_left * fade_x[None, :, None]

    seer = Image.open(PORTRAITS_SRC / "seer-portrait-master.png").convert("RGB")
    srw, srh = seer.size
    obs_crop = seer.crop((int(srw * 0.74), int(srh * 0.19), srw, int(srh * 0.46)))
    obs_w = int(round(tw * (580 / 1920)))
    obs_h = int(round(th * (520 / 1080)))
    obs_resized = ffmpeg_retina_upscale(obs_crop, size=(obs_w, obs_h), cas1=0.52, cas2=0.45, unsharp_amt=0.32)
    obs_arr = to_f32(obs_resized)

    oh, ow, _ = obs_arr.shape
    yy, xx = np.mgrid[0:oh, 0:ow].astype(np.float32)
    nx = xx / max(ow - 1, 1)
    ny = yy / max(oh - 1, 1)
    mx = np.clip(nx / 0.34, 0.0, 1.0)
    mx = mx * mx * (3.0 - 2.0 * mx)
    my = np.clip(ny / 0.24, 0.0, 1.0) * np.clip((1.0 - ny) / 0.30, 0.0, 1.0)
    my = my * my * (3.0 - 2.0 * my)
    mask = (mx * my)[..., None]

    y0 = int(round(th * (240 / 1080)))
    x0 = tw - ow
    region = canvas[y0:y0 + oh, x0:x0 + ow]
    canvas[y0:y0 + oh, x0:x0 + ow] = region * (1.0 - mask * 0.92) + obs_arr * (mask * 0.92)

    canvas[..., 0] *= 0.88
    canvas[..., 1] *= 0.93
    canvas[..., 2] = np.clip(canvas[..., 2] * 1.08 + 0.014, 0.0, 1.0)

    center_calm = radial_mask(th, tw, 0.46, 0.54, 0.42, 0.44, power=1.8)[..., None]
    canvas *= (1.0 - center_calm * 0.30)
    return from_f32(canvas)


def build_shop(lobby_3k: Image.Image) -> Image.Image:
    master = find_master("shop-bg-master")
    if master is not None:
        return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))

    lw, lh = lobby_3k.size
    crop = lobby_3k.crop((int(lw * 0.30), int(lh * 0.26), lw, lh))
    base = cover_resize_retina(crop, TARGET_SIZE, focal=(0.65, 0.58), cas1=0.64, cas2=0.56, unsharp_amt=0.42)
    arr = to_f32(base)
    h, w, _ = arr.shape

    arr[..., 0] = np.clip(arr[..., 0] * 1.12 + 0.012, 0.0, 1.0)
    arr[..., 1] = np.clip(arr[..., 1] * 0.96 + 0.004, 0.0, 1.0)
    arr[..., 2] = np.clip(arr[..., 2] * 0.78, 0.0, 1.0)

    warm_r = radial_mask(h, w, 0.86, 0.50, 0.32, 0.44, power=1.8)[..., None]
    warm_top = radial_mask(h, w, 0.14, 0.22, 0.30, 0.32, power=2.0)[..., None]
    arr += np.array([0.28, 0.13, 0.04], dtype=np.float32) * (warm_r * 0.32 + warm_top * 0.14)

    calm = radial_mask(h, w, 0.36, 0.50, 0.52, 0.56, power=1.7)[..., None]
    arr *= (1.0 - calm * 0.42)
    return from_f32(arr)


def build_profile(lobby_3k: Image.Image) -> Image.Image:
    master = find_master("profile-bg-master")
    if master is not None:
        return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))

    lw, lh = lobby_3k.size
    pond_crop = lobby_3k.crop((0, int(lh * 0.34), int(lw * 0.68), lh))
    base = cover_resize_retina(pond_crop, TARGET_SIZE, focal=(0.50, 0.65), cas1=0.64, cas2=0.56, unsharp_amt=0.42)
    arr = to_f32(base)
    h, w, _ = arr.shape

    roof_mist = radial_mask(h, w, 0.90, 0.30, 0.24, 0.28, power=1.7)[..., None]
    mist_tone = np.array([0.075, 0.095, 0.105], dtype=np.float32)
    arr = arr * (1.0 - roof_mist * 0.85) + mist_tone * (roof_mist * 0.85)

    arr[..., 0] = np.clip(arr[..., 0] * 0.82, 0.0, 1.0)
    arr[..., 1] = np.clip(arr[..., 1] * 1.04 + 0.008, 0.0, 1.0)
    arr[..., 2] = np.clip(arr[..., 2] * 1.06 + 0.012, 0.0, 1.0)

    pond_glow = radial_mask(h, w, 0.72, 0.86, 0.34, 0.18, power=2.0)[..., None]
    arr += np.array([0.07, 0.15, 0.14], dtype=np.float32) * pond_glow * 0.34

    sky_calm = radial_mask(h, w, 0.48, 0.34, 0.54, 0.42, power=1.8)[..., None]
    arr *= (1.0 - sky_calm * 0.30)
    return from_f32(arr)


def build_village(lobby_3k: Image.Image) -> Image.Image:
    master = find_master("village-bg-master")
    if master is not None:
        return cover_resize_retina(Image.open(master), TARGET_SIZE, focal=(0.5, 0.5))

    lw, lh = lobby_3k.size
    vista = lobby_3k.crop((int(lw * 0.10), int(lh * 0.06), lw, lh)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    base = cover_resize_retina(vista, TARGET_SIZE, focal=(0.50, 0.54), cas1=0.58, cas2=0.50, unsharp_amt=0.36)
    arr = to_f32(base)
    h, w, _ = arr.shape

    arr[..., 0] = np.clip(arr[..., 0] * 1.02 + 0.004, 0.0, 1.0)
    arr[..., 1] = np.clip(arr[..., 1] * 0.98 + 0.004, 0.0, 1.0)
    arr[..., 2] = np.clip(arr[..., 2] * 1.04 + 0.008, 0.0, 1.0)

    center = radial_mask(h, w, 0.52, 0.50, 0.46, 0.46, power=1.8)[..., None]
    arr *= (1.0 - center * 0.26)
    return from_f32(arr)


def extract_dark_ink_layer(
    crop: Image.Image,
    out_size: tuple[int, int],
    edge_fade: tuple[float, float, float, float],
    ink_threshold: float = 0.24,
    softness: float = 0.16,
    gamma: float = 1.25,
) -> Image.Image:
    sharpened = ffmpeg_retina_upscale(crop, size=out_size, cas1=0.62, cas2=0.55, unsharp_amt=0.40)
    arr = to_f32(sharpened)
    h, w, _ = arr.shape
    lum = arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114

    alpha = np.clip((ink_threshold - lum) / max(softness, 1e-4), 0.0, 1.0)
    alpha = np.power(alpha, gamma)

    fl, fr, ft, fb = edge_fade
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx = xx / max(w - 1, 1)
    ny = yy / max(h - 1, 1)
    if fl > 0:
        alpha *= np.clip(nx / fl, 0.0, 1.0)
    if fr > 0:
        alpha *= np.clip((1.0 - nx) / fr, 0.0, 1.0)
    if ft > 0:
        alpha *= np.clip(ny / ft, 0.0, 1.0)
    if fb > 0:
        alpha *= np.clip((1.0 - ny) / fb, 0.0, 1.0)

    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rim = np.clip(lum / max(ink_threshold, 1e-4), 0.0, 1.0)
    rgba[..., 0] = np.clip((8 + rim * 18), 0, 255).astype(np.uint8)
    rgba[..., 1] = np.clip((10 + rim * 20), 0, 255).astype(np.uint8)
    rgba[..., 2] = np.clip((14 + rim * 24), 0, 255).astype(np.uint8)
    rgba[..., 3] = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba)


def build_foreground_layers(lobby_3k: Image.Image) -> None:
    LAYERS_OUT.mkdir(parents=True, exist_ok=True)

    witch = Image.open(PORTRAITS_SRC / "witch-portrait-master.png").convert("RGB")
    ww, wh = witch.size
    crop = witch.crop((int(ww * 0.72), 0, ww, int(wh * 0.44)))
    bamboo_img = extract_dark_ink_layer(
        crop,
        out_size=(690, 1110),
        edge_fade=(0.22, 0.0, 0.0, 0.24),
        ink_threshold=0.18,
        softness=0.10,
        gamma=1.32,
    )
    b_arr = np.asarray(bamboo_img).copy()
    bh, bw, _ = b_arr.shape
    yy, xx = np.mgrid[0:bh, 0:bw].astype(np.float32)
    keep_x = np.clip((xx / bw - 0.54) / 0.14, 0.0, 1.0)
    keep_y = np.clip((0.46 - yy / bh) / 0.12, 0.0, 1.0)
    keep_mask = np.maximum(keep_x, keep_y)
    b_arr[..., 3] = np.clip(b_arr[..., 3].astype(np.float32) * keep_mask, 0, 255).astype(np.uint8)
    bamboo_img = Image.fromarray(b_arr)

    bamboo_out = LAYERS_OUT / "bamboo-foreground-right.webp"
    bamboo_img.save(bamboo_out, format="WEBP", quality=94, method=6)
    print(f"  wrote {bamboo_out.relative_to(REPO_ROOT)} ({bamboo_img.size[0]}x{bamboo_img.size[1]}, {bamboo_out.stat().st_size / 1024:.1f} KB)")

    lw, lh = lobby_3k.size
    pine_crop = lobby_3k.crop((0, 0, int(lw * 0.30), int(lh * 0.34)))
    pine_img = extract_dark_ink_layer(
        pine_crop,
        out_size=(1140, 630),
        edge_fade=(0.0, 0.28, 0.0, 0.30),
        ink_threshold=0.14,
        softness=0.085,
        gamma=1.28,
    )
    pine_out = LAYERS_OUT / "pine-bough-top.webp"
    pine_img.save(pine_out, format="WEBP", quality=94, method=6)
    print(f"  wrote {pine_out.relative_to(REPO_ROOT)} ({pine_img.size[0]}x{pine_img.size[1]}, {pine_out.stat().st_size / 1024:.1f} KB)")


def main() -> None:
    print("Building Oriental ink-wash Retina 3K (2880x1620) dynamic scene assets...")
    sign_in_3k = build_sign_in()
    save_scene_webp(sign_in_3k, OUT_DIR / "sign-in-bg.webp")

    lobby_3k = build_lobby()
    save_scene_webp(lobby_3k, OUT_DIR / "lobby-bg.webp")

    night_3k = build_game_night()
    save_scene_webp(night_3k, OUT_DIR / "game-night-bg.webp")

    save_scene_webp(build_game_day(night_3k), OUT_DIR / "game-day-bg.webp")
    save_scene_webp(build_match_setup(sign_in_3k, night_3k), OUT_DIR / "match-setup-bg.webp")
    save_scene_webp(build_shop(lobby_3k), OUT_DIR / "shop-bg.webp")
    save_scene_webp(build_profile(lobby_3k), OUT_DIR / "profile-bg.webp")
    save_scene_webp(build_village(lobby_3k), OUT_DIR / "village-bg.webp")

    build_foreground_layers(lobby_3k)
    print("Done.")


if __name__ == "__main__":
    main()
