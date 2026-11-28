#!/usr/bin/env node
/**
 * Deterministic ink-wash Wuxia skin & AI folk avatar media pipeline.
 *
 * Reads 20 master paintings from:
 *   - scripts/assets/skins/<skin-id>-master.{png,jpg,jpeg,webp}  (8 skins)
 *   - scripts/assets/avatars/ai-01..12-master.{png,jpg,jpeg,webp} (12 AI folk)
 *
 * Outputs 28 Retina WebP assets to:
 *   - public/assets/skins/<skin-id>/portrait.webp (1200x1600)
 *   - public/assets/skins/<skin-id>/avatar.webp   (512x512 upper-head focal crop)
 *   - public/assets/avatars/ai-01..12.webp        (512x512)
 *
 * Usage:
 *   node scripts/build-skin-media.mjs
 *   node scripts/build-skin-media.mjs --contact-sheet <path>
 *   node scripts/build-skin-media.mjs --check
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SKINS_SRC_DIR = path.join(REPO_ROOT, 'scripts', 'assets', 'skins');
const AVATARS_SRC_DIR = path.join(REPO_ROOT, 'scripts', 'assets', 'avatars');
const PUBLIC_SKINS_DIR = path.join(REPO_ROOT, 'public', 'assets', 'skins');
const PUBLIC_AVATARS_DIR = path.join(REPO_ROOT, 'public', 'assets', 'avatars');

const FFMPEG_BIN = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const FFPROBE_BIN = existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';

export const SKIN_IDS = [
  'default',
  'mist-wanderer',
  'bamboo-vigil',
  'tidal-swordsman',
  'moonlit-crane',
  'jade-moon-oath',
  'tidebreaker-vow',
  'crimson-lotus-shadow',
];

export const AI_AVATAR_IDS = Array.from({ length: 12 }, (_, i) => `ai-${String(i + 1).padStart(2, '0')}`);

// Portrait framing overrides (zoom >= 1, xBias/yBias in [0,1]) to align every skin's
// face center & eye-line with the Mist Wanderer upper-middle reference (~33% from top).
const SKIN_PORTRAIT_FRAMING = {
  'default': { zoom: 1.00, xBias: 0.50, yBias: 0.50 },
  'mist-wanderer': { zoom: 1.00, xBias: 0.50, yBias: 0.50 },
  'bamboo-vigil': { zoom: 1.22, xBias: 0.50, yBias: 0.00 },
  'tidal-swordsman': { zoom: 1.09, xBias: 0.36, yBias: 0.00 },
  'moonlit-crane': { zoom: 1.15, xBias: 0.50, yBias: 0.00 },
  'jade-moon-oath': { zoom: 1.00, xBias: 0.50, yBias: 0.50 },
  'tidebreaker-vow': { zoom: 1.22, xBias: 0.50, yBias: 0.00 },
  'crimson-lotus-shadow': { zoom: 1.20, xBias: 0.50, yBias: 0.00 },
};

// Upper-head/headwear focal crop ratios applied to the already-aligned 1200x1600 portrait.
const SKIN_AVATAR_CROPS = {
  'default': { yRatio: 0.13, sizeRatio: 0.66 },
  'mist-wanderer': { yRatio: 0.13, sizeRatio: 0.66 },
  'bamboo-vigil': { yRatio: 0.12, sizeRatio: 0.66 },
  'tidal-swordsman': { yRatio: 0.12, sizeRatio: 0.66 },
  'moonlit-crane': { yRatio: 0.12, sizeRatio: 0.66 },
  'jade-moon-oath': { yRatio: 0.12, sizeRatio: 0.66 },
  'tidebreaker-vow': { yRatio: 0.12, sizeRatio: 0.66 },
  'crimson-lotus-shadow': { yRatio: 0.12, sizeRatio: 0.66 },
};

const SPEC = {
  portrait: { width: 1200, height: 1600, quality: 92, minBytes: 40_000, maxBytes: 1_200_000 },
  avatar: { width: 512, height: 512, quality: 92, minBytes: 10_000, maxBytes: 400_000 },
};

function findMasterFile(dir, stem) {
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const candidate = path.join(dir, `${stem}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function ffprobeJson(filePath) {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ]);
  return JSON.parse(stdout);
}

async function encodeViaFfmpegAndPil(srcPath, vf, outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const tmpPng = `${outPath}.tmp.png`;
  await execFileAsync(FFMPEG_BIN, [
    '-y', '-loglevel', 'error',
    '-i', srcPath,
    '-vf', vf,
    tmpPng,
  ]);
  await execFileAsync('python3', [
    '-c',
    `from PIL import Image; import sys; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], format='WEBP', quality=${SPEC.portrait.quality}, method=6)`,
    tmpPng,
    outPath,
  ]);
  await fs.rm(tmpPng, { force: true });
}

async function encodePortraitWebp(srcPath, outPath, framing = { zoom: 1, xBias: 0.5, yBias: 0.5 }) {
  const scaledW = Math.round(SPEC.portrait.width * framing.zoom);
  const scaledH = Math.round(SPEC.portrait.height * framing.zoom);
  const vf = [
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd`,
    `crop=${SPEC.portrait.width}:${SPEC.portrait.height}:(iw-${SPEC.portrait.width})*${framing.xBias}:(ih-${SPEC.portrait.height})*${framing.yBias}`,
    'cas=0.35',
  ].join(',');
  await encodeViaFfmpegAndPil(srcPath, vf, outPath);
}

async function encodeAvatarWebp(srcPath, outPath, cropSpec = null) {
  const vfParts = [];
  if (cropSpec) {
    vfParts.push(
      `crop=iw*${cropSpec.sizeRatio}:iw*${cropSpec.sizeRatio}:(iw-iw*${cropSpec.sizeRatio})/2:ih*${cropSpec.yRatio}`,
    );
  } else {
    vfParts.push('crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))*0.15');
  }
  vfParts.push(
    `scale=${SPEC.avatar.width}:${SPEC.avatar.height}:flags=lanczos+accurate_rnd`,
    'cas=0.30',
  );
  await encodeViaFfmpegAndPil(srcPath, vfParts.join(','), outPath);
}

async function generateContactSheet(outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const py = `
import pathlib
from PIL import Image, ImageDraw, ImageFont

root = pathlib.Path(${JSON.stringify(REPO_ROOT)})
skin_ids = ${JSON.stringify(SKIN_IDS)}
ai_ids = ${JSON.stringify(AI_AVATAR_IDS)}

cols = 4
cell_w, cell_h = 260, 360
pad = 16
# Top section: 8 portraits (2 rows x 4 cols)
# Middle section: 8 circular avatars (2 rows x 4 cols, 160px)
# Bottom section: 12 AI avatars (3 rows x 4 cols, 160px)
total_w = cols * cell_w + (cols + 1) * pad
total_h = 2 * (cell_h + pad) + 2 * (180 + pad) + 3 * (180 + pad) + 120

sheet = Image.new('RGB', (total_w, total_h), (12, 14, 18))
draw = ImageDraw.Draw(sheet)

def circle_thumb(img, size=140):
    im = img.convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size - 1, size - 1), fill=255)
    out = Image.new('RGBA', (size, size), (12, 14, 18, 255))
    out.paste(im, (0, 0), mask)
    return out.convert('RGB')

y = pad
for idx, sid in enumerate(skin_ids):
    r, c = divmod(idx, cols)
    x = pad + c * (cell_w + pad)
    cy = y + r * (cell_h + pad)
    p = root / 'public' / 'assets' / 'skins' / sid / 'portrait.webp'
    im = Image.open(p).resize((240, 320), Image.Resampling.LANCZOS)
    sheet.paste(im, (x + 10, cy))
    draw.text((x + 12, cy + 326), f"skin: {sid}", fill=(220, 214, 200))

y += 2 * (cell_h + pad) + 20
for idx, sid in enumerate(skin_ids):
    r, c = divmod(idx, cols)
    x = pad + c * (cell_w + pad)
    cy = y + r * (180 + pad)
    p = root / 'public' / 'assets' / 'skins' / sid / 'avatar.webp'
    im = circle_thumb(Image.open(p), 140)
    sheet.paste(im, (x + 60, cy))
    draw.text((x + 50, cy + 146), f"avatar: {sid}", fill=(200, 220, 210))

y += 2 * (180 + pad) + 20
for idx, aid in enumerate(ai_ids):
    r, c = divmod(idx, cols)
    x = pad + c * (cell_w + pad)
    cy = y + r * (180 + pad)
    p = root / 'public' / 'assets' / 'avatars' / f"{aid}.webp"
    im = circle_thumb(Image.open(p), 140)
    sheet.paste(im, (x + 60, cy))
    draw.text((x + 80, cy + 146), aid, fill=(190, 195, 205))

out = pathlib.Path(${JSON.stringify(outPath)})
if out.suffix.lower() == '.webp':
    sheet.save(out, format='WEBP', quality=90)
else:
    sheet.save(out)
print(f"Wrote contact sheet: {out} ({sheet.size[0]}x{sheet.size[1]})")
`;
  const { stdout } = await execFileAsync('python3', ['-c', py]);
  if (stdout.trim()) console.log(stdout.trim());
}

async function checkAll() {
  const masterHashes = new Map();
  let failures = 0;

  const checkMaster = async (dir, stem) => {
    const file = findMasterFile(dir, stem);
    if (!file) {
      console.error(`[FAIL] Missing master for ${stem}`);
      failures += 1;
      return;
    }
    const buf = await fs.readFile(file);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (masterHashes.has(hash)) {
      console.error(`[FAIL] Duplicate master hash for ${stem} (matches ${masterHashes.get(hash)})`);
      failures += 1;
    } else {
      masterHashes.set(hash, stem);
    }
  };

  const checkWebp = async (filePath, expectedW, expectedH, minBytes, maxBytes) => {
    if (!existsSync(filePath)) {
      console.error(`[FAIL] Missing output ${path.relative(REPO_ROOT, filePath)}`);
      failures += 1;
      return;
    }
    const { size } = await fs.stat(filePath);
    const meta = await ffprobeJson(filePath);
    const s = meta.streams?.[0];
    const errs = [];
    if (!s || s.codec_name !== 'webp') errs.push(`codec=${s?.codec_name}`);
    if (s?.width !== expectedW || s?.height !== expectedH) errs.push(`dim=${s?.width}x${s?.height}`);
    if (size < minBytes || size > maxBytes) errs.push(`size=${size}B`);
    if (errs.length > 0) {
      console.error(`[FAIL] ${path.relative(REPO_ROOT, filePath)} -> ${errs.join(', ')}`);
      failures += 1;
    } else {
      console.log(`[PASS] ${path.relative(REPO_ROOT, filePath)} -> webp ${s.width}x${s.height} ${size}B`);
    }
  };

  for (const sid of SKIN_IDS) {
    await checkMaster(SKINS_SRC_DIR, `${sid}-master`);
    await checkWebp(
      path.join(PUBLIC_SKINS_DIR, sid, 'portrait.webp'),
      SPEC.portrait.width,
      SPEC.portrait.height,
      SPEC.portrait.minBytes,
      SPEC.portrait.maxBytes,
    );
    await checkWebp(
      path.join(PUBLIC_SKINS_DIR, sid, 'avatar.webp'),
      SPEC.avatar.width,
      SPEC.avatar.height,
      SPEC.avatar.minBytes,
      SPEC.avatar.maxBytes,
    );
  }

  for (const aid of AI_AVATAR_IDS) {
    await checkMaster(AVATARS_SRC_DIR, `${aid}-master`);
    await checkWebp(
      path.join(PUBLIC_AVATARS_DIR, `${aid}.webp`),
      SPEC.avatar.width,
      SPEC.avatar.height,
      SPEC.avatar.minBytes,
      SPEC.avatar.maxBytes,
    );
  }

  console.log(`Checked 20 masters (${masterHashes.size} unique) and 28 WebP outputs (${failures} failed).`);
  if (failures > 0) process.exitCode = 1;
}

async function buildAll(contactSheetPath) {
  for (const sid of SKIN_IDS) {
    const master = findMasterFile(SKINS_SRC_DIR, `${sid}-master`);
    if (!master) throw new Error(`Missing skin master for ${sid}`);
    const portraitOut = path.join(PUBLIC_SKINS_DIR, sid, 'portrait.webp');
    await encodePortraitWebp(master, portraitOut, SKIN_PORTRAIT_FRAMING[sid]);
    await encodeAvatarWebp(portraitOut, path.join(PUBLIC_SKINS_DIR, sid, 'avatar.webp'), SKIN_AVATAR_CROPS[sid]);
  }
  for (const aid of AI_AVATAR_IDS) {
    const master = findMasterFile(AVATARS_SRC_DIR, `${aid}-master`);
    if (!master) throw new Error(`Missing AI avatar master for ${aid}`);
    await encodeAvatarWebp(master, path.join(PUBLIC_AVATARS_DIR, `${aid}.webp`), null);
  }
  if (contactSheetPath) {
    await generateContactSheet(contactSheetPath);
  }
  console.log('Built 28 WebP assets (8 skin portraits, 8 skin avatars, 12 AI folk avatars).');
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
  await checkAll();
} else {
  const csIdx = args.indexOf('--contact-sheet');
  const csPath = csIdx >= 0 ? args[csIdx + 1] : null;
  await buildAll(csPath);
}
