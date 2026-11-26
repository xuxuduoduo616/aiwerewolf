#!/usr/bin/env node
/**
 * Deterministic ink-wash Wuxia role & night-skill media pipeline.
 *
 * Renders raster masters and supporting ink-wash SVG artwork via local Playwright
 * Chromium to PNG, encodes 3:4 portrait `.webp` (1440x1920), 1:1 skill `.webp`
 * (768x768), silent H.264 `yuv420p` `+faststart` `.mp4` entrance/VFX clips via
 * `/opt/homebrew/bin/ffmpeg`, crisp vector `badge.svg`, and offline bilingual
 * voiceovers (`voice-en.mp3`, `voice-zh.mp3`) via macOS `say` + `ffmpeg`.
 *
 * Audio provenance:
 *   All generated `.mp3` voice tracks are `preview-local-tts` offline preview
 *   assets synthesized locally with macOS `say` and normalized via `ffmpeg`
 *   (`silenceremove` + EBU R128 `loudnorm`). Zero external APIs or keys.
 *
 * Usage:
 *   node scripts/build-role-media.mjs --roles witch --skills witch-save,witch-poison
 *   node scripts/build-role-media.mjs --roles witch --skills witch-save,witch-poison --check
 *   node scripts/build-role-media.mjs --all
 *   node scripts/build-role-media.mjs --all --check
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const PUBLIC_ROLES_DIR = path.join(REPO_ROOT, 'public', 'assets', 'roles');
const PUBLIC_SKILLS_DIR = path.join(REPO_ROOT, 'public', 'assets', 'skills');

const FFMPEG_BIN = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const FFPROBE_BIN = existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe';
const SAY_BIN = existsSync('/usr/bin/say') ? '/usr/bin/say' : 'say';

export const TTS_PROVENANCE = 'preview-local-tts';

export const MEDIA_SPEC = {
  portrait: {
    width: 1440,
    height: 1920,
    bleedWidth: 1728,
    bleedHeight: 2304,
    bleedOriginX: -90,
    bleedOriginY: -120,
    webpQuality: 94,
  },
  entrance: {
    width: 1080,
    height: 1440,
    fps: 30,
    durationSec: 2.6,
    frames: 78, // 2.6s * 30fps
    maxBytes: 1048576, // strictly < 1MB
    minDurationSec: 2.2,
    maxDurationSec: 3.0,
  },
  skill: {
    width: 768,
    height: 768,
    fps: 30,
    durationSec: 44 / 30, // ~1.467s
    frames: 44,
    webpQuality: 92,
    maxBytes: 409600, // < 400KB budget
    minDurationSec: 1.0,
    maxDurationSec: 1.7,
  },
  voice: {
    minDurationSec: 2.0,
    maxDurationSec: 3.8,
    sampleRate: 44100,
    bitrate: '128k',
  },
};

// ---------------------------------------------------------------------------
// Shared Ink-Wash Wuxia SVG Primitives
// ---------------------------------------------------------------------------

const wrapSvgHtml = (svgMarkup, width, height) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: transparent;
  }
  svg {
    display: block;
    width: ${width}px;
    height: ${height}px;
  }
</style>
</head>
<body>${svgMarkup}</body>
</html>`;

const sharedInkWashDefs = (prefix) => `
  <filter id="${prefix}-paper" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.022 0.036" numOctaves="4" seed="17" result="noise"/>
    <feColorMatrix type="matrix" in="noise" values="
      0 0 0 0 0.85
      0 0 0 0 0.83
      0 0 0 0 0.77
      0 0 0 0.08 0" result="grain"/>
  </filter>
  <filter id="${prefix}-ink-blur-soft" x="-25%" y="-25%" width="150%" height="150%">
    <feGaussianBlur stdDeviation="16"/>
  </filter>
  <filter id="${prefix}-ink-blur-wide" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="32"/>
  </filter>
  <filter id="${prefix}-glow-emerald" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="14" result="b1"/>
    <feGaussianBlur stdDeviation="5" in="SourceGraphic" result="b2"/>
    <feMerge>
      <feMergeNode in="b1"/>
      <feMergeNode in="b2"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
  <filter id="${prefix}-glow-crimson" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="14" result="b1"/>
    <feGaussianBlur stdDeviation="5" in="SourceGraphic" result="b2"/>
    <feMerge>
      <feMergeNode in="b1"/>
      <feMergeNode in="b2"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
  <filter id="${prefix}-brush-edge" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="9" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
`;

// ---------------------------------------------------------------------------
// Witch Artwork Builders (Pilot Role + 2 Night Skills)
// ---------------------------------------------------------------------------

/**
 * Witch 3:4 Portrait SVG (900x1200 logical coordinates; supports bleed viewBox).
 * Composition keeps head, face, veil collar, and twin glowing potions inside
 * the top-center 65% (x: 195..705, y: 120..760) for 9:16 mobile `center 20%`
 * cropping, with dark ink-mist breathing room across the bottom 22% (y: 936..1200).
 * Contains zero embedded text or letters.
 */
const buildWitchPortraitSvg = ({ viewBox = '0 0 900 1200' } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%">
  <defs>
    ${sharedInkWashDefs('wp')}
    <filter id="wp-cloud-wash" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="4" seed="23" result="f"/>
      <feColorMatrix type="matrix" in="f" values="
        0 0 0 0 0.14
        0 0 0 0 0.18
        0 0 0 0 0.22
        0 0 0 0.55 -0.12"/>
    </filter>
    <linearGradient id="wp-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#050709"/>
      <stop offset="30%" stop-color="#0e141a"/>
      <stop offset="65%" stop-color="#141b22"/>
      <stop offset="100%" stop-color="#06080a"/>
    </linearGradient>
    <radialGradient id="wp-moon-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f6f1e4" stop-opacity="0.92"/>
      <stop offset="28%" stop-color="#d2d7cf" stop-opacity="0.52"/>
      <stop offset="58%" stop-color="#52606c" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0b1014" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wp-moon-disc" cx="42%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#faf6ec"/>
      <stop offset="62%" stop-color="#ded8c6"/>
      <stop offset="100%" stop-color="#96a0a8"/>
    </radialGradient>
    <linearGradient id="wp-cloak" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#1a222b"/>
      <stop offset="40%" stop-color="#0d1217"/>
      <stop offset="100%" stop-color="#050709"/>
    </linearGradient>
    <linearGradient id="wp-robe-fold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#252f39"/>
      <stop offset="55%" stop-color="#12181f"/>
      <stop offset="100%" stop-color="#080b0e"/>
    </linearGradient>
    <linearGradient id="wp-silk-trim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7c8791" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#dad4c5" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#69747e" stop-opacity="0.3"/>
    </linearGradient>
    <linearGradient id="wp-veil-silk" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#1e2730" stop-opacity="0.93"/>
      <stop offset="55%" stop-color="#11171d" stop-opacity="0.96"/>
      <stop offset="100%" stop-color="#090c10" stop-opacity="0.99"/>
    </linearGradient>
    <linearGradient id="wp-skin" x1="0.35" y1="0" x2="0.65" y2="1">
      <stop offset="0%" stop-color="#efe9dc"/>
      <stop offset="62%" stop-color="#cfc7b7"/>
      <stop offset="100%" stop-color="#92969b"/>
    </linearGradient>
    <radialGradient id="wp-emerald-core" cx="40%" cy="34%" r="62%">
      <stop offset="0%" stop-color="#ecfdf5"/>
      <stop offset="32%" stop-color="#34d399"/>
      <stop offset="76%" stop-color="#059669"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </radialGradient>
    <radialGradient id="wp-emerald-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#34d399" stop-opacity="0.48"/>
      <stop offset="55%" stop-color="#10b981" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#059669" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wp-crimson-core" cx="40%" cy="34%" r="62%">
      <stop offset="0%" stop-color="#fff1f2"/>
      <stop offset="30%" stop-color="#fb7185"/>
      <stop offset="70%" stop-color="#e11d48"/>
      <stop offset="100%" stop-color="#4c0519"/>
    </radialGradient>
    <radialGradient id="wp-crimson-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fb7185" stop-opacity="0.50"/>
      <stop offset="55%" stop-color="#e11d48" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#881337" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wp-bottom-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#06080a" stop-opacity="0"/>
      <stop offset="48%" stop-color="#06080a" stop-opacity="0.76"/>
      <stop offset="100%" stop-color="#040608" stop-opacity="0.99"/>
    </linearGradient>
  </defs>

  <!-- Nocturnal Ink Sky -->
  <rect x="-150" y="-180" width="1200" height="1680" fill="url(#wp-sky)"/>

  <!-- Organic Sumi-e Cloud Wash -->
  <rect x="-150" y="-180" width="1200" height="1050" filter="url(#wp-cloud-wash)" opacity="0.65"/>

  <!-- Backlit Pale Wuxia Moon (centered behind head for dramatic rim light) -->
  <circle cx="450" cy="256" r="300" fill="url(#wp-moon-halo)"/>
  <circle cx="450" cy="256" r="154" fill="url(#wp-moon-disc)" opacity="0.93"/>
  <!-- Drifting ink-wash clouds slicing across the moon -->
  <g filter="url(#wp-ink-blur-soft)" opacity="0.52">
    <path d="M 245 232 Q 360 202 490 226 Q 595 244 670 215" fill="none" stroke="#182028" stroke-width="20" stroke-linecap="round"/>
    <path d="M 285 316 Q 410 292 545 322 Q 615 336 665 312" fill="none" stroke="#12181f" stroke-width="24" stroke-linecap="round"/>
  </g>

  <!-- Distant Misty Peaks & Curved Wuxia Pavilion Eave -->
  <path d="M -140 760 C -20 620, 65 510, 155 520 C 235 528, 305 605, 385 570 C 460 535, 535 455, 630 488 C 725 520, 845 615, 1060 725 L 1060 1380 L -140 1380 Z" fill="#0f151c" opacity="0.82"/>
  <path d="M -140 845 C 25 690, 140 625, 255 642 C 365 658, 455 588, 565 612 C 675 636, 815 695, 1060 805 L 1060 1380 L -140 1380 Z" fill="#0a0e13" opacity="0.92"/>
  <!-- Subtle distant eave silhouette on far left mist -->
  <path d="M 48 566 Q 92 562 128 544 Q 108 564 134 574 L 54 574 Z" fill="#080b0e" opacity="0.72"/>

  <!-- Wind-Bent Bamboo & Pine Silhouettes Framing Negative Space -->
  <g stroke="#080b0e" fill="#080b0e" opacity="0.86">
    <!-- Upper-right gnarled pine -->
    <path d="M 1030 68 Q 882 104 776 148 Q 716 174 654 166" fill="none" stroke-width="13" stroke-linecap="round"/>
    <path d="M 792 142 Q 748 96 698 88 M 856 120 Q 814 172 758 196" fill="none" stroke-width="6" stroke-linecap="round"/>
    <g filter="url(#wp-ink-blur-soft)" opacity="0.75">
      <ellipse cx="668" cy="162" rx="46" ry="18" fill="#0b0f14"/>
      <ellipse cx="708" cy="88" rx="42" ry="16" fill="#0b0f14"/>
      <ellipse cx="772" cy="192" rx="48" ry="18" fill="#0b0f14"/>
    </g>
    <!-- Upper-left slender bamboo entering gracefully from off-canvas -->
    <path d="M -110 490 Q 18 320 118 122" fill="none" stroke-width="5" opacity="0.72"/>
    <path d="M -60 510 Q 52 365 154 218" fill="none" stroke-width="3.5" opacity="0.56"/>
    <path d="M 88 192 Q 142 170 178 194 Q 130 202 88 192 Z" opacity="0.75"/>
    <path d="M 104 148 Q 160 118 198 136 Q 150 152 104 148 Z" opacity="0.75"/>
    <path d="M 68 242 Q 124 226 158 252 Q 112 256 68 242 Z" opacity="0.68"/>
    <path d="M 122 262 Q 172 246 202 268 Q 160 274 122 262 Z" opacity="0.6"/>
  </g>

  <!-- === THE WITCH FIGURE (Organic Calligraphic Ink-Wash Brushwork) === -->

  <!-- Outer Cloak Silhouette & Flowing Wide Sleeves -->
  <g>
    <path d="M 450 116
             C 484 122, 534 164, 558 228
             C 574 274, 578 332, 608 378
             C 658 438, 728 518, 756 628
             C 712 662, 650 676, 594 644
             C 574 716, 588 830, 628 1020
             L 660 1240 L 240 1240 L 272 1020
             C 312 830, 326 716, 306 644
             C 250 676, 188 662, 144 628
             C 172 518, 242 438, 292 378
             C 322 332, 326 274, 342 228
             C 366 164, 416 122, 450 116 Z"
          fill="url(#wp-cloak)"/>
  </g>

  <!-- Soft Moonlight Rim Brushstrokes on Hood & Draping Shoulders -->
  <path d="M 352 226 C 374 164, 414 128, 450 120 C 486 128, 526 164, 548 226"
        fill="none" stroke="url(#wp-silk-trim)" stroke-width="3" stroke-linecap="round"/>
  <path d="M 318 358 C 266 416, 202 500, 154 616"
        fill="none" stroke="url(#wp-silk-trim)" stroke-width="2.2" stroke-linecap="round" opacity="0.72"/>
  <path d="M 582 358 C 634 416, 698 500, 746 616"
        fill="none" stroke="url(#wp-silk-trim)" stroke-width="2.2" stroke-linecap="round" opacity="0.72"/>

  <!-- Deep Hood Interior Shadow -->
  <path d="M 450 146 C 504 152, 538 200, 536 272 C 534 334, 502 386, 450 404 C 398 386, 366 334, 364 272 C 362 200, 396 152, 450 146 Z"
        fill="#06080b"/>

  <!-- Flowing Ink Hair Behind Cheeks -->
  <path d="M 450 176 C 492 178, 520 218, 514 276 C 509 324, 498 378, 518 446 C 490 406, 486 358, 484 322 L 416 322 C 414 358, 410 406, 382 446 C 402 378, 391 324, 386 276 C 380 218, 408 178, 450 176 Z"
        fill="#0a0d11"/>

  <!-- Face & Delicate Chin Contour -->
  <path d="M 402 238 C 402 204, 423 186, 450 186 C 477 186, 498 204, 498 238 C 498 274, 486 312, 450 332 C 414 312, 402 274, 402 238 Z"
        fill="url(#wp-skin)"/>
  <!-- Cheek chiaroscuro ink wash -->
  <path d="M 403 242 C 405 276, 417 308, 450 329 C 428 302, 421 272, 421 242 C 421 218, 434 196, 448 188 C 419 191, 403 212, 403 242 Z"
        fill="#4f5861" opacity="0.34"/>

  <!-- Hair Parting & Silver Crescent Clasp -->
  <path d="M 450 176 C 433 192, 412 218, 398 264 C 405 228, 422 202, 446 188 Z" fill="#0b0e13"/>
  <path d="M 450 176 C 467 192, 488 218, 502 264 C 495 228, 478 202, 454 188 Z" fill="#0b0e13"/>
  <path d="M 437 184 A 14 14 0 1 0 463 184 A 11 11 0 1 1 437 184 Z" fill="#e5dfd1"/>
  <circle cx="450" cy="197" r="3" fill="#34d399" filter="url(#wp-glow-emerald)"/>

  <!-- Calligraphic Eyebrows & Calm Piercing Eyes -->
  <path d="M 415 243 Q 428 237 441 243" fill="none" stroke="#11161b" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M 459 243 Q 472 237 485 243" fill="none" stroke="#11161b" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Left Eye -->
  <path d="M 415 256 Q 428 249 440 256 Q 428 262 415 256 Z" fill="#f3efe6"/>
  <circle cx="428" cy="256" r="4.3" fill="#0e161d"/>
  <circle cx="429.5" cy="254.5" r="1.4" fill="#d1fae5"/>
  <path d="M 413 256 Q 428 247 442 256" fill="none" stroke="#0b0f13" stroke-width="2.4" stroke-linecap="round"/>
  <!-- Right Eye -->
  <path d="M 460 256 Q 472 249 485 256 Q 472 262 460 256 Z" fill="#f3efe6"/>
  <circle cx="472" cy="256" r="4.3" fill="#0e161d"/>
  <circle cx="473.5" cy="254.5" r="1.4" fill="#fecdd3"/>
  <path d="M 458 256 Q 472 247 487 256" fill="none" stroke="#0b0f13" stroke-width="2.4" stroke-linecap="round"/>

  <!-- Softly Draped Silk Face Veil (Curved organic cloth, zero boxy borders) -->
  <path d="M 396 276 Q 450 264 504 276 C 512 318, 514 356, 502 384 Q 450 412 398 384 C 386 356, 388 318, 396 276 Z"
        fill="url(#wp-veil-silk)"/>
  <path d="M 399 278 Q 450 267 501 278" fill="none" stroke="url(#wp-silk-trim)" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M 412 302 Q 450 322 488 302 M 404 334 Q 450 358 496 334 M 414 366 Q 450 386 486 366"
        fill="none" stroke="#36424d" stroke-width="1.3" opacity="0.65" stroke-linecap="round"/>

  <!-- Windswept Loose Ink Locks -->
  <path d="M 396 268 C 378 320, 368 386, 378 462 M 404 316 C 392 362, 390 412, 402 454"
        fill="none" stroke="#090c10" stroke-width="4.4" stroke-linecap="round"/>
  <path d="M 504 268 C 522 320, 532 386, 522 462 M 496 316 C 508 362, 510 412, 498 454"
        fill="none" stroke="#090c10" stroke-width="4.4" stroke-linecap="round"/>

  <!-- Organic Crossed Hanfu Collar & Flowing Robe Drapery (No geometric boxes) -->
  <path d="M 342 364 C 392 435, 434 494, 484 552 L 450 584 C 394 522, 344 466, 312 406 Z"
        fill="url(#wp-robe-fold)"/>
  <path d="M 558 364 C 508 435, 466 494, 416 552 L 450 584 C 506 522, 556 466, 588 406 Z"
        fill="#141b22"/>
  <!-- Soft silk collar edge highlights -->
  <path d="M 346 370 C 396 440, 436 496, 480 546" fill="none" stroke="url(#wp-silk-trim)" stroke-width="2" stroke-linecap="round"/>
  <path d="M 554 370 C 504 440, 464 496, 420 546" fill="none" stroke="url(#wp-silk-trim)" stroke-width="2" stroke-linecap="round"/>

  <!-- Subtle Drapery Folds across Chest & Sleeves -->
  <path d="M 362 560 C 402 608, 432 644, 450 676 C 468 644, 498 608, 538 560"
        fill="none" stroke="#28323c" stroke-width="2.2" opacity="0.7" stroke-linecap="round"/>
  <path d="M 284 442 C 254 504, 218 564, 178 624" fill="none" stroke="#252e38" stroke-width="2.6" opacity="0.75" stroke-linecap="round"/>
  <path d="M 616 442 C 646 504, 682 564, 722 624" fill="none" stroke="#252e38" stroke-width="2.6" opacity="0.75" stroke-linecap="round"/>

  <!-- Tapered Silk Waist Sash & Flowing Drifting Ribbons -->
  <path d="M 366 648 Q 450 684 534 648 C 542 668, 540 692, 532 710 Q 450 744 368 710 C 360 692, 358 668, 366 648 Z"
        fill="#151c24"/>
  <path d="M 368 652 Q 450 688 532 652 M 370 706 Q 450 740 530 706"
        fill="none" stroke="url(#wp-silk-trim)" stroke-width="1.6" stroke-linecap="round"/>
  <!-- Flowing asymmetrical silk sash tails -->
  <path d="M 424 714 C 402 782, 376 854, 344 926 C 370 912, 396 894, 412 872 C 428 814, 438 764, 444 720 Z"
        fill="#131920" opacity="0.92"/>
  <path d="M 468 714 C 492 784, 520 858, 558 932 C 530 920, 502 900, 484 876 C 468 818, 458 766, 454 720 Z"
        fill="#10151b" opacity="0.9"/>
  <path d="M 424 716 C 402 784, 378 852, 346 922 M 468 716 C 492 784, 518 854, 554 926"
        fill="none" stroke="#6f7a84" stroke-width="1.3" opacity="0.55" stroke-linecap="round"/>
  <!-- Jade & Silver Waist Medallion -->
  <circle cx="450" cy="692" r="12" fill="#182028" stroke="#d5cfc0" stroke-width="1.8"/>
  <circle cx="450" cy="692" r="4.5" fill="#34d399" opacity="0.8"/>

  <!-- === LEFT SLEEVE, HAND & EMERALD ANTIDOTE GOURD === -->
  <path d="M 332 478 C 304 514, 278 552, 268 584 C 292 604, 336 592, 368 552 Z" fill="#11171d"/>
  <path d="M 272 582 C 290 598, 326 588, 354 558" fill="none" stroke="#36424d" stroke-width="1.6" opacity="0.7"/>
  <!-- Graceful Left Fingers cupping gourd -->
  <path d="M 250 568 C 258 556, 274 556, 288 564 C 298 570, 296 582, 286 588 C 272 595, 254 588, 248 578 Z"
        fill="url(#wp-skin)"/>
  <path d="M 254 576 Q 268 584 282 578" fill="none" stroke="#7c8287" stroke-width="1.2" opacity="0.65"/>

  <circle cx="268" cy="524" r="102" fill="url(#wp-emerald-aura)"/>
  <g filter="url(#wp-glow-emerald)">
    <ellipse cx="268" cy="552" rx="29" ry="32" fill="url(#wp-emerald-core)" stroke="#d1fae5" stroke-width="1.7"/>
    <ellipse cx="268" cy="508" rx="18.5" ry="21.5" fill="url(#wp-emerald-core)" stroke="#d1fae5" stroke-width="1.7"/>
    <path d="M 249 525 Q 268 531 287 525" fill="none" stroke="#e4dfd2" stroke-width="3" stroke-linecap="round"/>
    <path d="M 262 486 L 274 486 L 272 475 L 264 475 Z" fill="#8b6f4e" stroke="#e4dfd2" stroke-width="1.2"/>
    <path d="M 284 527 C 296 550, 294 576, 290 594" fill="none" stroke="#6ee7b7" stroke-width="2" stroke-linecap="round"/>
    <path d="M 286 590 L 294 590 L 298 622 L 283 622 Z" fill="#10b981" opacity="0.88"/>
  </g>
  <!-- Swirling Emerald Spirit Vapor & Motes -->
  <g filter="url(#wp-glow-emerald)" opacity="0.9">
    <path d="M 268 470 C 246 436, 288 402, 258 362 C 240 338, 258 308, 278 292"
          fill="none" stroke="#6ee7b7" stroke-width="3" stroke-linecap="round" opacity="0.84"/>
    <path d="M 276 462 C 302 424, 264 394, 294 354"
          fill="none" stroke="#a7f3d0" stroke-width="1.8" stroke-linecap="round" opacity="0.65"/>
    <circle cx="249" cy="408" r="3.4" fill="#ecfdf5"/>
    <circle cx="288" cy="378" r="2.5" fill="#6ee7b7"/>
    <circle cx="262" cy="330" r="2.1" fill="#a7f3d0"/>
  </g>

  <!-- === RIGHT SLEEVE, HAND & CRIMSON POISON VIAL === -->
  <path d="M 568 478 C 596 514, 622 552, 632 582 C 608 602, 564 590, 532 552 Z" fill="#11171d"/>
  <path d="M 628 580 C 610 596, 574 586, 546 556" fill="none" stroke="#36424d" stroke-width="1.6" opacity="0.7"/>
  <!-- Graceful Right Fingers holding vial -->
  <path d="M 650 564 C 642 552, 626 552, 612 560 C 602 566, 604 578, 614 584 C 628 591, 646 584, 652 574 Z"
        fill="url(#wp-skin)"/>
  <path d="M 646 572 Q 632 580 618 574" fill="none" stroke="#7c8287" stroke-width="1.2" opacity="0.65"/>

  <circle cx="632" cy="518" r="102" fill="url(#wp-crimson-aura)"/>
  <g filter="url(#wp-glow-crimson)" transform="rotate(-11 632 524)">
    <path d="M 616 506 L 648 506 L 656 542 L 632 566 L 608 542 Z"
          fill="url(#wp-crimson-core)" stroke="#fecdd3" stroke-width="1.7"/>
    <rect x="624" y="490" width="16" height="16" rx="2" fill="#23141a" stroke="#e4dfd2" stroke-width="1.5"/>
    <path d="M 626 490 L 632 472 L 638 490 Z" fill="#e4dfd2"/>
    <path d="M 622 512 L 628 542 L 632 558" fill="none" stroke="#fff1f2" stroke-width="1.5" opacity="0.8"/>
  </g>
  <!-- Curling Crimson Venom Wisps & Embers -->
  <g filter="url(#wp-glow-crimson)" opacity="0.9">
    <path d="M 626 470 C 652 434, 610 400, 642 360 C 660 338, 642 310, 622 292"
          fill="none" stroke="#fb7185" stroke-width="3" stroke-linecap="round" opacity="0.84"/>
    <path d="M 618 460 C 594 426, 634 396, 606 356"
          fill="none" stroke="#fda4af" stroke-width="1.8" stroke-linecap="round" opacity="0.65"/>
    <circle cx="648" cy="404" r="3.3" fill="#fff1f2"/>
    <circle cx="610" cy="374" r="2.4" fill="#fb7185"/>
    <circle cx="634" cy="328" r="2.1" fill="#fda4af"/>
  </g>

  <!-- Subtle Drifting Foreground Ink-Mist & Bottom 22% Subtitle Breathing Room -->
  <g filter="url(#wp-ink-blur-wide)" opacity="0.72">
    <ellipse cx="220" cy="940" rx="280" ry="90" fill="#151c23"/>
    <ellipse cx="680" cy="960" rx="280" ry="90" fill="#12181f"/>
    <ellipse cx="450" cy="1065" rx="460" ry="125" fill="#080b0e"/>
  </g>
  <rect x="-150" y="900" width="1200" height="450" fill="url(#wp-bottom-fade)"/>

  <!-- Subtle Xuan-Paper Grain Overlay -->
  <rect x="-150" y="-180" width="1200" height="1680" filter="url(#wp-paper)" opacity="0.88"/>
</svg>`;

/**
 * Swirling organic ink-wash mist veil (900x1200 RGBA) without concentric oval banding.
 */
const buildMistVeilSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200" width="900" height="1200">
  <defs>
    <filter id="mv-fog" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.009 0.015" numOctaves="4" seed="41" result="noise"/>
      <feColorMatrix type="matrix" in="noise" values="
        0 0 0 0 0.16
        0 0 0 0 0.21
        0 0 0 0 0.26
        0 0 0 0.85 -0.18"/>
    </filter>
    <radialGradient id="mv-vignette" cx="50%" cy="46%" r="58%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.78"/>
      <stop offset="68%" stop-color="#ffffff" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <mask id="mv-mask">
      <rect width="900" height="1200" fill="url(#mv-vignette)"/>
    </mask>
  </defs>
  <rect width="900" height="1200" filter="url(#mv-fog)" mask="url(#mv-mask)"/>
</svg>`;

/**
 * Witch Identity Badge SVG (crisp twin alchemy potion gourd & vial, readable at 20-32px).
 * Zero embedded text.
 */
const buildWitchBadgeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  <defs>
    <radialGradient id="wb-bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#222a32"/>
      <stop offset="100%" stop-color="#0d1115"/>
    </radialGradient>
    <linearGradient id="wb-jade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a7f3d0"/>
      <stop offset="55%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#065f46"/>
    </linearGradient>
    <linearGradient id="wb-cinnabar" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fecdd3"/>
      <stop offset="55%" stop-color="#e11d48"/>
      <stop offset="100%" stop-color="#881337"/>
    </linearGradient>
  </defs>
  <!-- Ink-wash moon medallion ring -->
  <circle cx="32" cy="32" r="28" fill="url(#wb-bg)" stroke="#d9d6ca" stroke-width="2.4"/>
  <circle cx="32" cy="32" r="23.5" stroke="#64748b" stroke-width="1" stroke-dasharray="6 3"/>
  <!-- Left: Jade Antidote Calabash Gourd -->
  <g transform="translate(-1 1)">
    <ellipse cx="23" cy="40" rx="9" ry="10.5" fill="url(#wb-jade)" stroke="#ece8db" stroke-width="2.1"/>
    <ellipse cx="23" cy="25.5" rx="6" ry="7" fill="url(#wb-jade)" stroke="#ece8db" stroke-width="2.1"/>
    <path d="M18.5 31.5 Q23 33.5 27.5 31.5" stroke="#ece8db" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="20.5" y="15" width="5" height="4" rx="1" fill="#d9d6ca"/>
  </g>
  <!-- Right: Tilted Cinnabar Poison Vial -->
  <g transform="rotate(14 43 34)">
    <path d="M36 27 H50 L53 41 L43 50 L33 41 Z" fill="url(#wb-cinnabar)" stroke="#ece8db" stroke-width="2.1" stroke-linejoin="round"/>
    <rect x="39.5" y="21" width="7" height="6" rx="1" fill="#1e293b" stroke="#ece8db" stroke-width="1.8"/>
    <path d="M40.5 21 L43 14.5 L45.5 21 Z" fill="#ece8db"/>
  </g>
</svg>
`;

/**
 * Skill VFX SVG: witch-save (640x640) — Jade Antidote pouring emerald healing lotus mist.
 * Zero embedded text.
 */
const buildWitchSaveSkillSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">
  <defs>
    ${sharedInkWashDefs('ws')}
    <radialGradient id="ws-bg" cx="50%" cy="52%" r="60%">
      <stop offset="0%" stop-color="#0d2922"/>
      <stop offset="48%" stop-color="#0d1619"/>
      <stop offset="100%" stop-color="#050709"/>
    </radialGradient>
    <radialGradient id="ws-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ecfdf5"/>
      <stop offset="35%" stop-color="#34d399"/>
      <stop offset="72%" stop-color="#059669" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#064e3b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ws-gourd" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#a7f3d0"/>
      <stop offset="50%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
  </defs>
  <rect width="640" height="640" fill="url(#ws-bg)"/>

  <!-- Ink-Wash Calligraphic Halo Rings -->
  <g filter="url(#ws-brush-edge)" opacity="0.78">
    <circle cx="320" cy="336" r="222" fill="none" stroke="#263833" stroke-width="18" stroke-dasharray="180 34 90 28"/>
    <circle cx="320" cy="336" r="176" fill="none" stroke="#34d399" stroke-width="3.5" stroke-dasharray="140 28 70 24" opacity="0.65"/>
  </g>

  <!-- Central Healing Aura -->
  <circle cx="320" cy="355" r="215" fill="url(#ws-core)" opacity="0.62"/>

  <!-- Blooming Ink-Wash Lotus Petals beneath Elixir Stream -->
  <g filter="url(#ws-glow-emerald)" opacity="0.9">
    <path d="M 320 495 C 258 468, 224 415, 252 365 C 282 396, 304 440, 320 495 Z" fill="#065f46" stroke="#6ee7b7" stroke-width="2"/>
    <path d="M 320 495 C 382 468, 416 415, 388 365 C 358 396, 336 440, 320 495 Z" fill="#065f46" stroke="#6ee7b7" stroke-width="2"/>
    <path d="M 320 498 C 216 485, 165 445, 192 398 C 236 420, 278 452, 320 498 Z" fill="#064e3b" stroke="#34d399" stroke-width="1.8" opacity="0.8"/>
    <path d="M 320 498 C 424 485, 475 445, 448 398 C 404 420, 362 452, 320 498 Z" fill="#064e3b" stroke="#34d399" stroke-width="1.8" opacity="0.8"/>
    <path d="M 320 495 C 290 432, 294 374, 320 332 C 346 374, 350 432, 320 495 Z" fill="#10b981" stroke="#d1fae5" stroke-width="2.2"/>
  </g>

  <!-- Tilted Jade Gourd pouring Luminous Elixir -->
  <g transform="translate(362 195) rotate(-42)" filter="url(#ws-glow-emerald)">
    <ellipse cx="0" cy="36" rx="46" ry="52" fill="url(#ws-gourd)" stroke="#ecfdf5" stroke-width="2.8"/>
    <ellipse cx="0" cy="-34" rx="28" ry="33" fill="url(#ws-gourd)" stroke="#ecfdf5" stroke-width="2.8"/>
    <path d="M -29 -6 Q 0 5 29 -6" fill="none" stroke="#e6e1d3" stroke-width="5" stroke-linecap="round"/>
    <rect x="-10" y="-76" width="20" height="12" rx="3" fill="#132a24" stroke="#ecfdf5" stroke-width="2"/>
  </g>

  <!-- Pouring Elixir Stream & Rising Healing Ribbons -->
  <g filter="url(#ws-glow-emerald)">
    <path d="M 294 246 C 254 292, 286 352, 320 412 C 336 364, 314 316, 304 252 Z" fill="#a7f3d0" opacity="0.92"/>
    <path d="M 236 452 C 194 360, 224 268, 282 184" fill="none" stroke="#6ee7b7" stroke-width="4" stroke-linecap="round" opacity="0.82"/>
    <path d="M 410 456 C 454 366, 434 276, 384 202" fill="none" stroke="#a7f3d0" stroke-width="3.2" stroke-linecap="round" opacity="0.72"/>
    <circle cx="242" cy="322" r="5" fill="#ecfdf5"/>
    <circle cx="398" cy="340" r="4.5" fill="#a7f3d0"/>
    <circle cx="320" cy="432" r="7" fill="#ecfdf5"/>
    <circle cx="275" cy="210" r="3.5" fill="#d1fae5"/>
  </g>

  <rect width="640" height="640" filter="url(#ws-paper)" opacity="0.85"/>
</svg>`;

/**
 * Skill VFX SVG: witch-poison (640x640) — Cinnabar Venom unleashing ink-thorn miasma.
 * Zero embedded text.
 */
const buildWitchPoisonSkillSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">
  <defs>
    ${sharedInkWashDefs('wpo')}
    <radialGradient id="wpo-bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#2b0b16"/>
      <stop offset="48%" stop-color="#140b11"/>
      <stop offset="100%" stop-color="#050608"/>
    </radialGradient>
    <radialGradient id="wpo-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffe4e6"/>
      <stop offset="32%" stop-color="#f43f5e"/>
      <stop offset="72%" stop-color="#9f1239" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#4c0519" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wpo-vial" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fecdd3"/>
      <stop offset="50%" stop-color="#e11d48"/>
      <stop offset="100%" stop-color="#4c0519"/>
    </linearGradient>
  </defs>
  <rect width="640" height="640" fill="url(#wpo-bg)"/>

  <!-- Jagged Ink-Wash Vortex Rings -->
  <g filter="url(#wpo-brush-edge)" opacity="0.84">
    <circle cx="320" cy="328" r="224" fill="none" stroke="#3b121e" stroke-width="18" stroke-dasharray="150 38 110 30"/>
    <circle cx="320" cy="328" r="172" fill="none" stroke="#fb7185" stroke-width="3.5" stroke-dasharray="120 30 60 22" opacity="0.65"/>
  </g>

  <!-- Central Venom Glow -->
  <circle cx="320" cy="340" r="215" fill="url(#wpo-core)" opacity="0.58"/>

  <!-- Shattering Ink-Thorn & Crimson Spiral Ribbons -->
  <g filter="url(#wpo-glow-crimson)">
    <path d="M 320 342 C 230 330, 178 398, 224 468 C 194 405, 250 364, 320 374 Z" fill="#9f1239" stroke="#fda4af" stroke-width="1.8"/>
    <path d="M 320 342 C 410 330, 462 398, 416 468 C 446 405, 390 364, 320 374 Z" fill="#9f1239" stroke="#fda4af" stroke-width="1.8"/>
    <path d="M 320 328 C 205 256, 172 178, 258 136 C 216 196, 254 274, 320 328 Z" fill="#881337" opacity="0.88"/>
    <path d="M 320 328 C 435 256, 468 178, 382 136 C 424 196, 386 274, 320 328 Z" fill="#881337" opacity="0.88"/>
  </g>

  <!-- Faceted Crimson Poison Vial -->
  <g transform="translate(320 292) rotate(-18)" filter="url(#wpo-glow-crimson)">
    <path d="M -42 -36 H 42 L 62 46 L 0 108 L -62 46 Z" fill="url(#wpo-vial)" stroke="#ffe4e6" stroke-width="3" stroke-linejoin="round"/>
    <path d="M -22 -24 L -12 46 L 0 92" fill="none" stroke="#ffe4e6" stroke-width="2.4" opacity="0.78"/>
    <rect x="-18" y="-72" width="36" height="36" rx="4" fill="#1f1117" stroke="#e6e1d3" stroke-width="2.5"/>
    <path d="M -14 -72 L 0 -114 L 14 -72 Z" fill="#ece8db"/>
  </g>

  <!-- Venom Droplets & Splatter Motes -->
  <g filter="url(#wpo-glow-crimson)">
    <path d="M 320 426 Q 308 468 320 488 Q 332 468 320 426 Z" fill="#ffe4e6"/>
    <circle cx="212" cy="280" r="5" fill="#fb7185"/>
    <circle cx="430" cy="288" r="5" fill="#fb7185"/>
    <circle cx="256" cy="462" r="4" fill="#ffe4e6"/>
    <circle cx="388" cy="458" r="4" fill="#ffe4e6"/>
  </g>

  <rect width="640" height="640" filter="url(#wpo-paper)" opacity="0.85"/>
</svg>`;

/**
 * Reusable aura overlay SVG for skill VFX videos (640x640 RGBA).
 */
const buildSkillAuraOverlaySvg = (hexGlow, hexLight) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">
  <defs>
    <radialGradient id="sa-ring" cx="50%" cy="50%" r="50%">
      <stop offset="40%" stop-color="${hexGlow}" stop-opacity="0"/>
      <stop offset="68%" stop-color="${hexGlow}" stop-opacity="0.34"/>
      <stop offset="86%" stop-color="${hexLight}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${hexGlow}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="320" cy="320" r="285" fill="url(#sa-ring)"/>
  <circle cx="320" cy="320" r="200" fill="none" stroke="${hexLight}" stroke-width="2.5" stroke-dasharray="48 26 24 18" opacity="0.6"/>
</svg>`;

// ---------------------------------------------------------------------------
// Remaining 5 Role Artwork Builders (Dark Ink-Wash Wuxia)
// ---------------------------------------------------------------------------

/**
 * Seer 3:4 Portrait SVG (900x1200; supports bleed viewBox).
 * Midnight-indigo ink-wash mystic with sheer silk blindfold/veil, silver moon
 * halo, and glowing celestial moon-mirror eye prop inside top-center 65%.
 */
const buildSeerPortraitSvg = ({ viewBox = '0 0 900 1200' } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%">
  <defs>
    ${sharedInkWashDefs('sp')}
    <filter id="sp-cloud-wash" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.017" numOctaves="4" seed="31" result="f"/>
      <feColorMatrix type="matrix" in="f" values="
        0 0 0 0 0.14
        0 0 0 0 0.20
        0 0 0 0 0.30
        0 0 0 0.56 -0.12"/>
    </filter>
    <filter id="sp-glow-indigo" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="14" result="b1"/>
      <feGaussianBlur stdDeviation="5" in="SourceGraphic" result="b2"/>
      <feMerge>
        <feMergeNode in="b1"/>
        <feMergeNode in="b2"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="sp-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#04070d"/>
      <stop offset="32%" stop-color="#0b1524"/>
      <stop offset="68%" stop-color="#111d30"/>
      <stop offset="100%" stop-color="#05070b"/>
    </linearGradient>
    <radialGradient id="sp-moon-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f0f9ff" stop-opacity="0.92"/>
      <stop offset="32%" stop-color="#93c5fd" stop-opacity="0.44"/>
      <stop offset="62%" stop-color="#1e3a5f" stop-opacity="0.20"/>
      <stop offset="100%" stop-color="#09111d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sp-moon-disc" cx="44%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="60%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#64748b"/>
    </radialGradient>
    <linearGradient id="sp-robe" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#192538"/>
      <stop offset="45%" stop-color="#0d1522"/>
      <stop offset="100%" stop-color="#05080d"/>
    </linearGradient>
    <linearGradient id="sp-silk-trim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#64748b" stop-opacity="0.3"/>
      <stop offset="50%" stop-color="#bae6fd" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#64748b" stop-opacity="0.3"/>
    </linearGradient>
    <linearGradient id="sp-skin" x1="0.35" y1="0" x2="0.65" y2="1">
      <stop offset="0%" stop-color="#eef2f6"/>
      <stop offset="64%" stop-color="#cbd5e1"/>
      <stop offset="100%" stop-color="#8896a6"/>
    </linearGradient>
    <radialGradient id="sp-eye-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="32%" stop-color="#7dd3fc"/>
      <stop offset="72%" stop-color="#0284c7"/>
      <stop offset="100%" stop-color="#0c4a6e"/>
    </radialGradient>
    <radialGradient id="sp-eye-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.54"/>
      <stop offset="55%" stop-color="#0284c7" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#075985" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sp-bottom-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="48%" stop-color="#05070b" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#040609" stop-opacity="0.99"/>
    </linearGradient>
  </defs>

  <rect x="-150" y="-180" width="1200" height="1680" fill="url(#sp-sky)"/>
  <rect x="-150" y="-180" width="1200" height="1050" filter="url(#sp-cloud-wash)" opacity="0.68"/>

  <!-- Pale Celestial Moon & Faint Astrolabe Orbit Rings -->
  <circle cx="450" cy="248" r="306" fill="url(#sp-moon-halo)"/>
  <circle cx="450" cy="248" r="152" fill="url(#sp-moon-disc)" opacity="0.9"/>
  <g opacity="0.34" fill="none" stroke="#bae6fd">
    <circle cx="450" cy="248" r="196" stroke-width="1.6" stroke-dasharray="16 10 4 10"/>
    <circle cx="450" cy="248" r="228" stroke-width="1.2" stroke-dasharray="48 18 12 18"/>
  </g>
  <g filter="url(#sp-ink-blur-soft)" opacity="0.54">
    <path d="M 240 226 Q 368 198 492 222 Q 600 242 678 210" fill="none" stroke="#131e30" stroke-width="20" stroke-linecap="round"/>
    <path d="M 274 304 Q 412 282 548 312 Q 624 328 674 302" fill="none" stroke="#0d1522" stroke-width="22" stroke-linecap="round"/>
  </g>

  <!-- Distant Observatory Cliff & Ink Peaks -->
  <path d="M -140 770 C -10 620, 88 506, 178 518 C 258 530, 326 604, 412 566 C 492 530, 566 456, 658 492 C 748 528, 868 625, 1060 735 L 1060 1380 L -140 1380 Z" fill="#0d1624" opacity="0.86"/>
  <path d="M -140 855 C 35 700, 152 634, 272 648 C 384 662, 468 594, 578 618 C 686 642, 822 706, 1060 818 L 1060 1380 L -140 1380 Z" fill="#080e17" opacity="0.94"/>

  <!-- Subtle Star Motes & Plum Branch Silhouette -->
  <g fill="#e0f2fe" opacity="0.72">
    <circle cx="176" cy="148" r="2.2"/>
    <circle cx="242" cy="96" r="1.6"/>
    <circle cx="690" cy="118" r="2.3"/>
    <circle cx="748" cy="176" r="1.5"/>
    <circle cx="628" cy="78" r="1.8"/>
  </g>
  <g stroke="#080d14" fill="#080d14" opacity="0.84">
    <path d="M -100 220 Q 48 188 184 148 Q 222 136 254 118" fill="none" stroke-width="7" stroke-linecap="round"/>
    <path d="M 102 172 Q 148 122 192 104 M 156 156 Q 198 180 236 178" fill="none" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M 1020 460 Q 860 398 730 318" fill="none" stroke-width="8" stroke-linecap="round"/>
  </g>

  <!-- === THE SEER FIGURE === -->
  <g>
    <path d="M 450 128
             C 488 134, 526 168, 542 222
             C 562 276, 566 334, 604 378
             C 662 436, 728 524, 742 646
             C 694 672, 636 672, 588 642
             C 572 726, 586 842, 624 1025
             L 654 1240 L 246 1240 L 276 1025
             C 314 842, 328 726, 312 642
             C 264 672, 206 672, 158 646
             C 172 524, 238 436, 296 378
             C 334 334, 338 276, 358 222
             C 374 168, 412 134, 450 128 Z"
          fill="url(#sp-robe)"/>
  </g>

  <!-- High Mystic Collar & Silver Rim -->
  <path d="M 358 228 C 378 166, 414 134, 450 128 C 486 134, 522 166, 542 228"
        fill="none" stroke="url(#sp-silk-trim)" stroke-width="2.8" stroke-linecap="round"/>
  <path d="M 304 376 C 244 438, 192 522, 164 636 M 596 376 C 656 438, 708 522, 736 636"
        fill="none" stroke="url(#sp-silk-trim)" stroke-width="2" opacity="0.72" stroke-linecap="round"/>

  <!-- Topknot, Jade/Silver Celestial Crown Pin & Flowing Hair -->
  <path d="M 424 176 C 426 140, 474 140, 476 176 Z" fill="#090d14"/>
  <path d="M 388 158 L 512 146" stroke="#cbd5e1" stroke-width="3.2" stroke-linecap="round"/>
  <circle cx="388" cy="158" r="5" fill="#7dd3fc" filter="url(#sp-glow-indigo)"/>
  <path d="M 450 166 C 494 170, 524 214, 518 278 C 512 332, 502 384, 520 452 C 492 408, 488 358, 486 320 L 414 320 C 412 358, 408 408, 380 452 C 398 384, 388 332, 382 278 C 376 214, 406 170, 450 166 Z"
        fill="#080c12"/>

  <!-- Pale Face -->
  <path d="M 404 234 C 404 202, 424 184, 450 184 C 476 184, 496 202, 496 234 C 496 272, 484 308, 450 328 C 416 308, 404 272, 404 234 Z"
        fill="url(#sp-skin)"/>
  <path d="M 405 238 C 407 274, 420 306, 450 325 C 430 298, 422 268, 422 238 C 422 214, 434 194, 448 186 C 420 190, 405 210, 405 238 Z"
        fill="#475569" opacity="0.32"/>

  <!-- Translucent Indigo-Silver Silk Blindfold + Glowing Third-Eye Seal -->
  <path d="M 398 232 Q 450 222 502 232 L 504 264 Q 450 274 396 264 Z"
        fill="#172436" opacity="0.92" stroke="#bae6fd" stroke-width="1.6"/>
  <path d="M 498 248 C 528 266, 548 296, 558 342 C 542 324, 526 296, 498 264 Z" fill="#131e2e" opacity="0.88"/>
  <!-- Glowing Forehead Astral Eye Mark -->
  <g filter="url(#sp-glow-indigo)">
    <path d="M 434 214 Q 450 202 466 214 Q 450 226 434 214 Z" fill="#e0f2fe" stroke="#38bdf8" stroke-width="1.5"/>
    <circle cx="450" cy="214" r="4.2" fill="#0284c7"/>
    <circle cx="450" cy="214" r="1.8" fill="#ffffff"/>
  </g>
  <!-- Calm Serene Lips -->
  <path d="M 436 292 Q 450 297 464 292" fill="none" stroke="#475569" stroke-width="2" stroke-linecap="round"/>

  <!-- Crossed Taoist Robe Lapels & Flowing Astrolabe Waist Sash -->
  <path d="M 342 362 C 392 432, 434 490, 484 548 L 450 582 C 394 520, 344 464, 312 404 Z" fill="#121c2c"/>
  <path d="M 558 362 C 508 432, 466 490, 416 548 L 450 582 C 506 520, 556 464, 588 404 Z" fill="#172438"/>
  <path d="M 346 368 C 396 438, 436 494, 480 544 M 554 368 C 504 438, 464 494, 420 544"
        fill="none" stroke="url(#sp-silk-trim)" stroke-width="2" stroke-linecap="round"/>
  <path d="M 366 648 Q 450 682 534 648 L 530 708 Q 450 742 370 708 Z" fill="#111a28"/>
  <path d="M 368 652 Q 450 686 532 652 M 370 705 Q 450 738 530 705" fill="none" stroke="url(#sp-silk-trim)" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M 426 714 C 402 786, 374 862, 342 934 L 408 880 C 424 818, 436 764, 444 718 Z" fill="#0e1622"/>
  <path d="M 472 714 C 496 786, 524 862, 558 934 L 490 880 C 474 818, 462 764, 456 718 Z" fill="#0b111b"/>

  <!-- === RAISED SLEEVE, HAND & CELESTIAL MOON-MIRROR EYE PROP === -->
  <path d="M 344 496 C 392 528, 422 570, 450 606 C 414 636, 348 618, 314 574 Z" fill="#0e1724"/>
  <path d="M 420 578 C 436 560, 466 560, 482 578 C 488 594, 474 608, 450 608 C 426 608, 414 594, 420 578 Z" fill="url(#sp-skin)"/>
  <circle cx="450" cy="488" r="128" fill="url(#sp-eye-aura)"/>
  <g filter="url(#sp-glow-indigo)">
    <!-- Ornate Silver Moon-Mirror Frame -->
    <circle cx="450" cy="488" r="70" fill="#081220" stroke="#e0f2fe" stroke-width="3.2"/>
    <circle cx="450" cy="488" r="56" fill="none" stroke="#7dd3fc" stroke-width="1.8" stroke-dasharray="14 8"/>
    <path d="M 450 404 L 450 418 M 450 558 L 450 572 M 366 488 L 380 488 M 520 488 L 534 488" stroke="#bae6fd" stroke-width="2.6" stroke-linecap="round"/>
    <!-- Luminous Celestial Eye Inside Mirror -->
    <path d="M 398 488 Q 450 444 502 488 Q 450 532 398 488 Z" fill="#e0f2fe" stroke="#38bdf8" stroke-width="2.4"/>
    <circle cx="450" cy="488" r="21" fill="url(#sp-eye-core)"/>
    <circle cx="450" cy="488" r="8.5" fill="#061224"/>
    <circle cx="456" cy="481" r="4" fill="#ffffff"/>
    <!-- Spirit Light Rays -->
    <path d="M 450 398 C 422 362, 474 334, 450 296" fill="none" stroke="#7dd3fc" stroke-width="2.4" stroke-linecap="round" opacity="0.8"/>
    <circle cx="384" cy="412" r="3.2" fill="#e0f2fe"/>
    <circle cx="518" cy="416" r="2.8" fill="#7dd3fc"/>
  </g>

  <!-- Bottom 22% Dark Ink-Mist Breathing Room -->
  <g filter="url(#sp-ink-blur-wide)" opacity="0.74">
    <ellipse cx="220" cy="942" rx="280" ry="90" fill="#0d1522"/>
    <ellipse cx="680" cy="962" rx="280" ry="90" fill="#0a101a"/>
    <ellipse cx="450" cy="1065" rx="460" ry="125" fill="#05070b"/>
  </g>
  <rect x="-150" y="900" width="1200" height="450" fill="url(#sp-bottom-fade)"/>
  <rect x="-150" y="-180" width="1200" height="1680" filter="url(#sp-paper)" opacity="0.88"/>
</svg>`;

/**
 * Seer Identity Badge SVG (64x64) — Celestial moon-mirror & luminous indigo eye.
 */
const buildSeerBadgeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  <defs>
    <radialGradient id="sb-bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#17253a"/>
      <stop offset="100%" stop-color="#090f1a"/>
    </radialGradient>
    <radialGradient id="sb-eye" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f0f9ff"/>
      <stop offset="48%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#0369a1"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="28" fill="url(#sb-bg)" stroke="#dbeafe" stroke-width="2.4"/>
  <circle cx="32" cy="32" r="22.5" stroke="#60a5fa" stroke-width="1.2" stroke-dasharray="5 3"/>
  <path d="M 32 10 V 15 M 32 49 V 54 M 10 32 H 15 M 49 32 H 54" stroke="#bae6fd" stroke-width="2" stroke-linecap="round"/>
  <path d="M 13 32 Q 32 17 51 32 Q 32 47 13 32 Z" fill="#0f172a" stroke="#e0f2fe" stroke-width="2.2" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="7.5" fill="url(#sb-eye)"/>
  <circle cx="32" cy="32" r="3" fill="#081221"/>
  <circle cx="34" cy="30" r="1.4" fill="#ffffff"/>
</svg>
`;

/**
 * Werewolf 3:4 Portrait SVG (900x1200; supports bleed viewBox).
 * Obsidian ink-wash night prowler wearing a sculpted wolf-fang mask with glowing
 * crimson slit eyes and clawed gauntlet under a blood-rimmed moon.
 */
const buildWerewolfPortraitSvg = ({ viewBox = '0 0 900 1200' } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%">
  <defs>
    ${sharedInkWashDefs('wwp')}
    <filter id="wwp-cloud-wash" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.010 0.020" numOctaves="4" seed="53" result="f"/>
      <feColorMatrix type="matrix" in="f" values="
        0 0 0 0 0.22
        0 0 0 0 0.12
        0 0 0 0 0.14
        0 0 0 0.56 -0.14"/>
    </filter>
    <linearGradient id="wwp-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#050406"/>
      <stop offset="34%" stop-color="#160c10"/>
      <stop offset="68%" stop-color="#1c1116"/>
      <stop offset="100%" stop-color="#060507"/>
    </linearGradient>
    <radialGradient id="wwp-moon-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fecaca" stop-opacity="0.78"/>
      <stop offset="34%" stop-color="#dc2626" stop-opacity="0.34"/>
      <stop offset="68%" stop-color="#450a0a" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#0c0709" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wwp-moon-disc" cx="44%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#f7efe8"/>
      <stop offset="62%" stop-color="#d6b4ad"/>
      <stop offset="100%" stop-color="#7f3b3b"/>
    </radialGradient>
    <linearGradient id="wwp-cloak" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#1f1a1d"/>
      <stop offset="45%" stop-color="#0f0c0e"/>
      <stop offset="100%" stop-color="#050406"/>
    </linearGradient>
    <linearGradient id="wwp-mask" x1="0.3" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="#e7e1d6"/>
      <stop offset="56%" stop-color="#9c968e"/>
      <stop offset="100%" stop-color="#353133"/>
    </linearGradient>
    <linearGradient id="wwp-bottom-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#060507" stop-opacity="0"/>
      <stop offset="48%" stop-color="#060507" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#040305" stop-opacity="0.99"/>
    </linearGradient>
  </defs>

  <rect x="-150" y="-180" width="1200" height="1680" fill="url(#wwp-sky)"/>
  <rect x="-150" y="-180" width="1200" height="1050" filter="url(#wwp-cloud-wash)" opacity="0.65"/>

  <!-- Crimson-Rimmed Full Moon -->
  <circle cx="450" cy="242" r="306" fill="url(#wwp-moon-halo)"/>
  <circle cx="450" cy="242" r="158" fill="url(#wwp-moon-disc)" opacity="0.9"/>
  <g filter="url(#wwp-ink-blur-soft)" opacity="0.6">
    <path d="M 226 218 Q 360 184 504 218 Q 612 242 694 202" fill="none" stroke="#180d11" stroke-width="24" stroke-linecap="round"/>
    <path d="M 262 308 Q 410 278 552 316 Q 630 332 688 296" fill="none" stroke="#11090c" stroke-width="26" stroke-linecap="round"/>
  </g>

  <!-- Jagged Crag Peaks & Twisted Dead Pine -->
  <path d="M -140 770 L 36 532 L 154 606 L 278 492 L 420 598 L 574 478 L 716 588 L 876 502 L 1060 740 L 1060 1380 L -140 1380 Z" fill="#100b0e" opacity="0.88"/>
  <path d="M -140 860 L 92 648 L 240 698 L 392 614 L 560 676 L 748 618 L 1060 825 L 1060 1380 L -140 1380 Z" fill="#090709" opacity="0.95"/>
  <path d="M -90 140 Q 62 182 194 148 Q 248 134 292 104" fill="none" stroke="#080608" stroke-width="11" stroke-linecap="round"/>
  <path d="M 1030 165 Q 888 188 760 242" fill="none" stroke="#080608" stroke-width="12" stroke-linecap="round"/>

  <!-- === THE WEREWOLF WARRIOR FIGURE === -->
  <g>
    <path d="M 450 156
             C 510 162, 574 224, 594 310
             C 644 362, 704 446, 738 584
             C 696 632, 636 658, 588 640
             C 576 726, 596 846, 634 1030
             L 662 1240 L 238 1240 L 266 1030
             C 304 846, 324 726, 312 640
             C 264 658, 204 632, 162 584
             C 196 446, 256 362, 306 310
             C 326 224, 390 162, 450 156 Z"
          fill="url(#wwp-cloak)"/>
  </g>

  <!-- Furred Mantle Ruff & Crimson Slash Trim -->
  <path d="M 304 338 L 334 304 L 358 342 L 392 312 L 420 352 L 450 326 L 480 352 L 508 312 L 542 342 L 566 304 L 596 338 L 574 396 L 450 422 L 326 396 Z"
        fill="#191418"/>
  <path d="M 326 396 Q 450 426 574 396" fill="none" stroke="#52464b" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
  <path d="M 326 376 C 392 444, 446 502, 502 562" fill="none" stroke="#b91c1c" stroke-width="2.8" opacity="0.72" stroke-linecap="round"/>
  <path d="M 574 376 C 508 444, 454 502, 398 562" fill="none" stroke="#a8a29e" stroke-width="1.8" opacity="0.55" stroke-linecap="round"/>

  <!-- Windswept Wild Ink Mane -->
  <path d="M 358 190 L 322 258 L 352 252 L 326 316 L 372 296 L 528 296 L 574 316 L 548 252 L 578 258 L 542 190 Z"
        fill="#080608"/>

  <!-- === INK-WASH WOLF MASK & BARED FANGS === -->
  <g>
    <!-- Left & Right Wolf Ears -->
    <path d="M 380 202 L 356 106 L 422 174 Z" fill="#171316" stroke="#d6d3cb" stroke-width="2"/>
    <path d="M 520 202 L 544 106 L 478 174 Z" fill="#171316" stroke="#d6d3cb" stroke-width="2"/>
    <path d="M 384 188 L 368 130 L 408 174 Z" fill="#451a22" opacity="0.8"/>
    <path d="M 516 188 L 532 130 L 492 174 Z" fill="#451a22" opacity="0.8"/>
    <!-- Sculpted Bone-and-Obsidian Wolf Mask -->
    <path d="M 378 202 L 450 164 L 522 202 L 534 268 L 490 342 L 450 364 L 410 342 L 366 268 Z"
          fill="url(#wwp-mask)" stroke="#e7e5e4" stroke-width="2.2" stroke-linejoin="round"/>
    <!-- Calligraphic Brow & Cheek Ink Markings -->
    <path d="M 388 228 L 440 256 L 450 338 L 460 256 L 512 228" fill="none" stroke="#181316" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M 384 268 L 422 288 M 516 268 L 478 288" stroke="#261f22" stroke-width="3" stroke-linecap="round"/>
  </g>
  <!-- Glowing Crimson Slit Eyes -->
  <g filter="url(#wwp-glow-crimson)">
    <path d="M 392 238 L 434 252 L 402 262 Z" fill="#fef2f2" stroke="#ef4444" stroke-width="1.8"/>
    <path d="M 508 238 L 466 252 L 498 262 Z" fill="#fef2f2" stroke="#ef4444" stroke-width="1.8"/>
    <circle cx="414" cy="250" r="4.2" fill="#dc2626"/>
    <circle cx="486" cy="250" r="4.2" fill="#dc2626"/>
  </g>
  <!-- Snarling Jaw & Sharp Ivory Fangs -->
  <path d="M 412 316 Q 450 298 488 316 L 476 346 Q 450 356 424 346 Z" fill="#0d080a"/>
  <path d="M 420 314 L 428 340 L 436 314 Z" fill="#fafaf9"/>
  <path d="M 464 314 L 472 340 L 480 314 Z" fill="#fafaf9"/>
  <path d="M 438 316 L 444 330 L 450 316 L 456 330 L 462 316 Z" fill="#e7e5e4"/>

  <!-- Crimson Waist Belt & Hanging Wolf Fang Talisman -->
  <path d="M 366 644 Q 450 676 534 644 L 530 704 Q 450 738 370 704 Z" fill="#180d11"/>
  <path d="M 368 648 Q 450 680 532 648 M 370 702 Q 450 734 530 702" fill="none" stroke="#b91c1c" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M 450 694 L 440 738 L 450 762 L 460 738 Z" fill="#e7e5e4"/>

  <!-- === RAISED CLAWED GAUNTLET & CRIMSON SLASH WISPS === -->
  <path d="M 554 494 C 602 528, 636 570, 622 608 C 588 618, 542 598, 520 554 Z" fill="#120e11"/>
  <g filter="url(#wwp-glow-crimson)">
    <!-- Clawed Gauntlet & 4 Curved Blades -->
    <path d="M 548 530 L 584 504 L 614 532 L 588 576 L 544 566 Z" fill="#1f191d" stroke="#d6d3cb" stroke-width="2"/>
    <path d="M 552 526 C 516 488, 494 454, 488 418 C 512 448, 536 478, 566 516 Z" fill="#f5f5f4" stroke="#ef4444" stroke-width="1.4"/>
    <path d="M 570 514 C 544 472, 532 436, 534 398 C 550 434, 566 468, 586 508 Z" fill="#f5f5f4" stroke="#ef4444" stroke-width="1.4"/>
    <path d="M 588 510 C 574 468, 572 430, 582 396 C 590 434, 596 470, 604 510 Z" fill="#f5f5f4" stroke="#ef4444" stroke-width="1.4"/>
    <!-- Crimson Slash Aura -->
    <path d="M 462 414 C 504 450, 544 498, 586 562" fill="none" stroke="#ef4444" stroke-width="3.2" stroke-linecap="round" opacity="0.86"/>
    <path d="M 508 394 C 546 436, 576 482, 606 544" fill="none" stroke="#fca5a5" stroke-width="2" stroke-linecap="round" opacity="0.72"/>
  </g>

  <!-- Bottom 22% Dark Ink-Mist Breathing Room -->
  <g filter="url(#wwp-ink-blur-wide)" opacity="0.76">
    <ellipse cx="220" cy="942" rx="280" ry="90" fill="#140d11"/>
    <ellipse cx="680" cy="962" rx="280" ry="90" fill="#110b0e"/>
    <ellipse cx="450" cy="1065" rx="460" ry="125" fill="#060507"/>
  </g>
  <rect x="-150" y="900" width="1200" height="450" fill="url(#wwp-bottom-fade)"/>
  <rect x="-150" y="-180" width="1200" height="1680" filter="url(#wwp-paper)" opacity="0.88"/>
</svg>`;

/**
 * Werewolf Identity Badge SVG (64x64) — Fierce Wuxia snarling wolf head & blood-moon silhouette.
 */
const buildWerewolfBadgeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  <defs>
    <radialGradient id="wwb-bg" cx="50%" cy="46%" r="54%">
      <stop offset="0%" stop-color="#2c1016"/>
      <stop offset="68%" stop-color="#14090d"/>
      <stop offset="100%" stop-color="#070507"/>
    </radialGradient>
    <radialGradient id="wwb-moon" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fca5a5" stop-opacity="0.34"/>
      <stop offset="65%" stop-color="#991b1b" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="wwb-fur" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#e7e2d8"/>
      <stop offset="52%" stop-color="#78716c"/>
      <stop offset="100%" stop-color="#1c1917"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="28" fill="url(#wwb-bg)" stroke="#e7e5e4" stroke-width="2.3"/>
  <circle cx="32" cy="30" r="20" fill="url(#wwb-moon)"/>
  <circle cx="32" cy="30" r="16.5" stroke="#b91c1c" stroke-width="1.2" stroke-dasharray="10 4 5 4" opacity="0.72"/>

  <!-- Fierce Wuxia Snarling Wolf Head Silhouette (3/4 profile with tufted ruff) -->
  <path d="M 16 52 C 13 43, 12 33, 17 24 L 13 18 L 20 17 L 19 9 L 28 16 L 34 15 L 40 9 L 41 18 L 48 22 L 54 27 L 50 32 L 42 33 L 50 38 L 43 41 L 35 40 L 40 48 L 32 47 L 28 53 L 22 49 Z"
        fill="url(#wwb-fur)" stroke="#f5f5f4" stroke-width="1.7" stroke-linejoin="round"/>
  <!-- Inner Ears & Cheek Fur Calligraphic Shading -->
  <path d="M 21 12 L 24 18 L 21 20 Z" fill="#7f1d1d"/>
  <path d="M 39 12 L 38 18 L 35 17 Z" fill="#7f1d1d"/>
  <path d="M 19 30 L 25 27 L 22 36 L 28 33 L 25 43" stroke="#181214" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Furrowed Snout Bridge & Nose -->
  <path d="M 30 22 L 42 25 L 51 27" stroke="#1c1917" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M 49 26 L 54 27 L 51 31 L 47 29 Z" fill="#090708"/>
  <!-- Glowing Crimson Lupine Slit Eyes -->
  <path d="M 27 23 L 34 25 L 29 27 Z" fill="#ef4444"/>
  <path d="M 37 23 L 43 24 L 39 26.5 Z" fill="#ef4444"/>
  <circle cx="30.5" cy="25" r="0.9" fill="#fef2f2"/>
  <circle cx="40" cy="24.5" r="0.9" fill="#fef2f2"/>
  <!-- Snarling Open Maw & Bared Curved Fangs -->
  <path d="M 33 34 L 49 32 L 45 38 L 35 38 Z" fill="#0d0608"/>
  <path d="M 36 33 L 38 38 L 40 33 M 43 32.5 L 45 37.5 L 47 32.5" fill="#fafaf9"/>
  <path d="M 38 38 L 39.5 34.5 L 41 38" fill="#e7e5e4"/>
</svg>
`;

/**
 * Hunter 3:4 Portrait SVG (900x1200; supports bleed viewBox).
 * Storm-slate Wuxia ranger in wide conical bamboo hat (douli) wielding a
 * mechanical repeating crossbow with amber-gold tipped bolt.
 */
const buildHunterPortraitSvg = ({ viewBox = '0 0 900 1200' } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%">
  <defs>
    ${sharedInkWashDefs('hp')}
    <filter id="hp-cloud-wash" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.009 0.018" numOctaves="4" seed="67" result="f"/>
      <feColorMatrix type="matrix" in="f" values="
        0 0 0 0 0.16
        0 0 0 0 0.18
        0 0 0 0 0.21
        0 0 0 0.56 -0.13"/>
    </filter>
    <filter id="hp-glow-amber" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feGaussianBlur stdDeviation="4" in="SourceGraphic" result="b2"/>
      <feMerge>
        <feMergeNode in="b1"/>
        <feMergeNode in="b2"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="hp-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#050709"/>
      <stop offset="32%" stop-color="#11171f"/>
      <stop offset="68%" stop-color="#1b2127"/>
      <stop offset="100%" stop-color="#06080b"/>
    </linearGradient>
    <radialGradient id="hp-moon-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fef3c7" stop-opacity="0.82"/>
      <stop offset="35%" stop-color="#d97706" stop-opacity="0.26"/>
      <stop offset="68%" stop-color="#334155" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#0a0e14" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="hp-moon-disc" cx="42%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#fefce8"/>
      <stop offset="62%" stop-color="#d6cfc0"/>
      <stop offset="100%" stop-color="#7c8288"/>
    </radialGradient>
    <linearGradient id="hp-hat" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#4a4033"/>
      <stop offset="55%" stop-color="#221e19"/>
      <stop offset="100%" stop-color="#0b0c0e"/>
    </linearGradient>
    <linearGradient id="hp-cloak" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#1f2730"/>
      <stop offset="48%" stop-color="#10151b"/>
      <stop offset="100%" stop-color="#06080b"/>
    </linearGradient>
    <linearGradient id="hp-skin" x1="0.35" y1="0" x2="0.65" y2="1">
      <stop offset="0%" stop-color="#e7dfd1"/>
      <stop offset="64%" stop-color="#c0b6a5"/>
      <stop offset="100%" stop-color="#7c7a76"/>
    </linearGradient>
    <linearGradient id="hp-bottom-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#06080b" stop-opacity="0"/>
      <stop offset="48%" stop-color="#06080b" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#040608" stop-opacity="0.99"/>
    </linearGradient>
  </defs>

  <rect x="-150" y="-180" width="1200" height="1680" fill="url(#hp-sky)"/>
  <rect x="-150" y="-180" width="1200" height="1050" filter="url(#hp-cloud-wash)" opacity="0.64"/>

  <!-- Pale Amber-Rimmed Moon behind Bamboo Hat -->
  <circle cx="450" cy="236" r="296" fill="url(#hp-moon-halo)"/>
  <circle cx="450" cy="236" r="148" fill="url(#hp-moon-disc)" opacity="0.9"/>
  <g filter="url(#hp-ink-blur-soft)" opacity="0.54">
    <path d="M 238 220 Q 372 192 508 218 Q 610 238 686 206" fill="none" stroke="#161d26" stroke-width="20" stroke-linecap="round"/>
  </g>

  <!-- Windswept Cliff & Reed Silhouettes -->
  <path d="M -140 770 C 12 612, 118 524, 224 540 C 318 554, 384 612, 474 568 C 562 526, 654 474, 764 522 C 858 564, 948 634, 1060 730 L 1060 1380 L -140 1380 Z" fill="#10151c" opacity="0.86"/>
  <path d="M -140 860 C 48 708, 178 652, 304 662 C 422 672, 502 606, 616 632 C 734 658, 868 716, 1060 822 L 1060 1380 L -140 1380 Z" fill="#090d12" opacity="0.94"/>
  <!-- Sweeping Reed Stalks on Left & Right -->
  <g stroke="#080b0f" fill="none" stroke-linecap="round" opacity="0.8">
    <path d="M -60 640 Q 48 480 148 340 M -40 690 Q 64 546 168 424" stroke-width="4"/>
    <path d="M 980 620 Q 864 468 770 330" stroke-width="4.5"/>
  </g>

  <!-- === THE HUNTER FIGURE === -->
  <g>
    <path d="M 450 202
             C 514 212, 566 266, 588 340
             C 644 398, 708 482, 742 618
             C 694 648, 634 658, 584 634
             C 572 722, 586 840, 626 1028
             L 656 1240 L 244 1240 L 274 1028
             C 314 840, 328 722, 316 634
             C 266 658, 206 648, 158 618
             C 192 482, 256 398, 312 340
             C 334 266, 386 212, 450 202 Z"
          fill="url(#hp-cloak)"/>
  </g>

  <!-- Face & High Windproof Scarf Collar -->
  <path d="M 404 242 C 404 208, 424 192, 450 192 C 476 192, 496 208, 496 242 C 496 278, 484 316, 450 334 C 416 316, 404 278, 404 242 Z"
        fill="url(#hp-skin)"/>
  <!-- Shadow under hat brim -->
  <path d="M 404 226 Q 450 212 496 226 L 494 252 Q 450 242 406 252 Z" fill="#181c22" opacity="0.65"/>
  <!-- Fierce Hawk Eyes -->
  <path d="M 416 258 Q 430 251 442 258 Q 430 264 416 258 Z" fill="#f8fafc"/>
  <circle cx="430" cy="258" r="4.1" fill="#111827"/>
  <circle cx="431.5" cy="256.5" r="1.4" fill="#fde68a"/>
  <path d="M 458 258 Q 470 251 484 258 Q 470 264 458 258 Z" fill="#f8fafc"/>
  <circle cx="470" cy="258" r="4.1" fill="#111827"/>
  <circle cx="471.5" cy="256.5" r="1.4" fill="#fde68a"/>
  <!-- High Scarf Collar Covering Jaw -->
  <path d="M 384 286 Q 450 272 516 286 C 522 328, 518 364, 504 388 Q 450 412 396 388 C 382 364, 378 328, 384 286 Z"
        fill="#171d24"/>
  <path d="M 386 288 Q 450 275 514 288 M 398 318 Q 450 336 502 318 M 404 352 Q 450 370 496 352" fill="none" stroke="#475569" stroke-width="1.6" stroke-linecap="round"/>

  <!-- Wide Conical Bamboo Hat (Douli) -->
  <g>
    <path d="M 244 232 Q 450 112 656 232 Q 450 262 244 232 Z" fill="url(#hp-hat)" stroke="#cbd5e1" stroke-width="2.2"/>
    <path d="M 304 226 Q 450 144 596 226" fill="none" stroke="#786b56" stroke-width="1.8" opacity="0.72"/>
    <path d="M 358 228 Q 450 172 542 228" fill="none" stroke="#786b56" stroke-width="1.5" opacity="0.62"/>
  </g>
  <!-- Hat Chin Cord -->
  <path d="M 388 238 Q 400 288 424 316 M 512 238 Q 500 288 476 316" fill="none" stroke="#94a3b8" stroke-width="1.8" opacity="0.72"/>

  <!-- Martial Shoulder Armor Strap & Quiver -->
  <path d="M 332 368 L 510 568" stroke="#2c241d" stroke-width="18" stroke-linecap="round"/>
  <path d="M 332 368 L 510 568" stroke="#b45309" stroke-width="2.2" stroke-dasharray="10 12" opacity="0.7"/>
  <!-- Crossbow Bolt Quiver peeking behind right shoulder -->
  <g transform="translate(556 320) rotate(22)">
    <rect x="-14" y="-36" width="28" height="74" rx="4" fill="#1e1b18" stroke="#94a3b8" stroke-width="1.6"/>
    <path d="M -8 -36 L -12 -58 M 0 -36 L 0 -62 M 8 -36 L 12 -58" stroke="#e2e8f0" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M -14 -54 L -8 -62 M -2 -58 L 2 -66 M 10 -54 L 16 -62" stroke="#f59e0b" stroke-width="2.2"/>
  </g>

  <!-- Waist Belt & Leather Pouch -->
  <path d="M 366 644 Q 450 676 534 644 L 530 704 Q 450 738 370 704 Z" fill="#1b1815"/>
  <path d="M 368 648 Q 450 680 532 648 M 370 702 Q 450 734 530 702" fill="none" stroke="#b45309" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>
  <rect x="434" y="666" width="32" height="24" rx="4" fill="#292524" stroke="#fbbf24" stroke-width="1.8"/>

  <!-- === WUXIA REPEATING CROSSBOW PROP (held across chest in upper-center safe zone) === -->
  <g transform="translate(446 508) rotate(-18)">
    <!-- Curved Steel & Rosewood Crossbow Prod -->
    <path d="M -154 -36 Q 0 -106 154 -36" fill="none" stroke="#e2e8f0" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M -154 -36 Q 0 -92 154 -36" fill="none" stroke="#475569" stroke-width="3" stroke-linecap="round"/>
    <!-- Drawn Bowstring -->
    <path d="M -150 -36 L 0 28 L 150 -36" fill="none" stroke="#fde68a" stroke-width="2.4"/>
    <!-- Repeating Magazine & Stock -->
    <rect x="-22" y="-86" width="44" height="164" rx="6" fill="#1f1b18" stroke="#cbd5e1" stroke-width="2.4"/>
    <rect x="-13" y="-64" width="26" height="86" rx="3" fill="#332920" stroke="#94a3b8" stroke-width="1.6"/>
    <!-- Glowing Amber-Gold Repeating Bolt Loaded & Ready -->
    <g filter="url(#hp-glow-amber)">
      <path d="M 0 -132 L 0 28" stroke="#fef3c7" stroke-width="4.2" stroke-linecap="round"/>
      <path d="M 0 -152 L -11 -122 L 0 -128 L 11 -122 Z" fill="#fbbf24" stroke="#fffbeb" stroke-width="1.6"/>
      <circle cx="0" cy="-136" r="6" fill="#fef3c7" opacity="0.85"/>
    </g>
  </g>
  <!-- Left & Right Hands Gripping Crossbow -->
  <path d="M 358 518 C 372 504, 394 508, 402 524 C 398 542, 376 546, 360 536 Z" fill="url(#hp-skin)"/>
  <path d="M 488 492 C 504 480, 524 486, 528 504 C 522 520, 502 522, 488 510 Z" fill="url(#hp-skin)"/>

  <!-- Bottom 22% Dark Ink-Mist Breathing Room -->
  <g filter="url(#hp-ink-blur-wide)" opacity="0.74">
    <ellipse cx="220" cy="942" rx="280" ry="90" fill="#131922"/>
    <ellipse cx="680" cy="962" rx="280" ry="90" fill="#10151c"/>
    <ellipse cx="450" cy="1065" rx="460" ry="125" fill="#06080b"/>
  </g>
  <rect x="-150" y="900" width="1200" height="450" fill="url(#hp-bottom-fade)"/>
  <rect x="-150" y="-180" width="1200" height="1680" filter="url(#hp-paper)" opacity="0.88"/>
</svg>`;

/**
 * Hunter Identity Badge SVG (64x64) — Wuxia repeating crossbow & notched bolt.
 */
const buildHunterBadgeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  <defs>
    <radialGradient id="hb-bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#26231e"/>
      <stop offset="100%" stop-color="#0d0f12"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="28" fill="url(#hb-bg)" stroke="#e7e5e4" stroke-width="2.4"/>
  <circle cx="32" cy="32" r="23" stroke="#d97706" stroke-width="1.2" stroke-dasharray="6 3"/>
  <g transform="rotate(-32 32 32)">
    <!-- Crossbow Prod -->
    <path d="M 14 27 Q 32 14 50 27" stroke="#f5f5f4" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M 15 27 L 32 38 L 49 27" stroke="#fbbf24" stroke-width="1.6"/>
    <!-- Stock & Bolt -->
    <rect x="29" y="21" width="6" height="27" rx="2" fill="#292524" stroke="#e7e5e4" stroke-width="1.8"/>
    <path d="M 32 11 V 38" stroke="#fef3c7" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M 32 8 L 28 15 H 36 Z" fill="#fbbf24"/>
  </g>
</svg>
`;

/**
 * Idiot 3:4 Portrait SVG (900x1200; supports bleed viewBox).
 * Eccentric Wuxia scholar-fool peering knowingly over a cracked bamboo folding
 * fan with kintsugi gold crack line & ink-wash landscape stroke.
 */
const buildIdiotPortraitSvg = ({ viewBox = '0 0 900 1200' } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%">
  <defs>
    ${sharedInkWashDefs('ip')}
    <filter id="ip-cloud-wash" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.017" numOctaves="4" seed="79" result="f"/>
      <feColorMatrix type="matrix" in="f" values="
        0 0 0 0 0.22
        0 0 0 0 0.19
        0 0 0 0 0.16
        0 0 0 0.56 -0.13"/>
    </filter>
    <filter id="ip-glow-gold" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" result="b1"/>
      <feMerge>
        <feMergeNode in="b1"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="ip-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070709"/>
      <stop offset="34%" stop-color="#171413"/>
      <stop offset="68%" stop-color="#221d1a"/>
      <stop offset="100%" stop-color="#070607"/>
    </linearGradient>
    <radialGradient id="ip-moon-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fef3c7" stop-opacity="0.86"/>
      <stop offset="35%" stop-color="#d6c6a5" stop-opacity="0.34"/>
      <stop offset="68%" stop-color="#57534e" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#141110" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ip-moon-disc" cx="44%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#fdfaf0"/>
      <stop offset="64%" stop-color="#ded5be"/>
      <stop offset="100%" stop-color="#9c9381"/>
    </radialGradient>
    <linearGradient id="ip-robe" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#292420"/>
      <stop offset="48%" stop-color="#151311"/>
      <stop offset="100%" stop-color="#080707"/>
    </linearGradient>
    <linearGradient id="ip-fan-leaf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f5efe2"/>
      <stop offset="62%" stop-color="#d6cbb4"/>
      <stop offset="100%" stop-color="#a89c84"/>
    </linearGradient>
    <linearGradient id="ip-skin" x1="0.35" y1="0" x2="0.65" y2="1">
      <stop offset="0%" stop-color="#efe8d8"/>
      <stop offset="64%" stop-color="#cdc2ad"/>
      <stop offset="100%" stop-color="#8d877d"/>
    </linearGradient>
    <linearGradient id="ip-bottom-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070607" stop-opacity="0"/>
      <stop offset="48%" stop-color="#070607" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#050405" stop-opacity="0.99"/>
    </linearGradient>
  </defs>

  <rect x="-150" y="-180" width="1200" height="1680" fill="url(#ip-sky)"/>
  <rect x="-150" y="-180" width="1200" height="1050" filter="url(#ip-cloud-wash)" opacity="0.65"/>

  <!-- Hazy Parchment Moon -->
  <circle cx="450" cy="248" r="296" fill="url(#ip-moon-halo)"/>
  <circle cx="450" cy="248" r="146" fill="url(#ip-moon-disc)" opacity="0.92"/>
  <g filter="url(#ip-ink-blur-soft)" opacity="0.5">
    <path d="M 244 234 Q 368 206 492 228 Q 596 248 672 218" fill="none" stroke="#1c1816" stroke-width="20" stroke-linecap="round"/>
  </g>

  <!-- Misty Bridge & Hanging Willow Branches -->
  <path d="M -140 770 C 0 622, 118 534, 224 552 C 324 568, 404 612, 496 568 C 584 526, 684 484, 788 534 C 884 578, 964 644, 1060 735 L 1060 1380 L -140 1380 Z" fill="#141110" opacity="0.86"/>
  <path d="M -140 860 C 48 708, 178 652, 304 662 C 422 672, 502 606, 616 632 C 734 658, 868 716, 1060 822 L 1060 1380 L -140 1380 Z" fill="#0b0909" opacity="0.94"/>
  <g stroke="#0a0808" fill="none" stroke-linecap="round" opacity="0.78">
    <path d="M 1030 92 Q 870 112 738 148" stroke-width="8"/>
    <path d="M 790 136 Q 764 226 756 322 M 842 124 Q 814 218 812 314 M 748 146 Q 704 224 686 314" stroke-width="2.4"/>
  </g>

  <!-- === THE SCHOLAR-FOOL FIGURE === -->
  <g>
    <path d="M 450 138
             C 492 144, 532 178, 548 232
             C 568 286, 574 342, 608 388
             C 666 446, 728 532, 740 644
             C 694 670, 636 672, 588 642
             C 572 726, 586 842, 624 1025
             L 654 1240 L 246 1240 L 276 1025
             C 314 842, 328 726, 312 642
             C 264 672, 206 670, 160 644
             C 172 532, 234 446, 292 388
             C 326 342, 332 286, 352 232
             C 368 178, 408 144, 450 138 Z"
          fill="url(#ip-robe)"/>
  </g>

  <!-- Askew Scholar Hairpin, Loose Tousled Locks & Knowing Half-Smile Face -->
  <path d="M 426 178 C 432 138, 480 144, 474 182 Z" fill="#0b0909"/>
  <path d="M 384 134 L 516 178" stroke="#d6cfc0" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M 450 168 C 494 172, 522 216, 516 278 C 510 330, 500 384, 518 450 C 490 406, 486 356, 484 318 L 416 318 C 414 356, 410 406, 382 450 C 400 384, 390 330, 384 278 C 378 216, 406 172, 450 168 Z"
        fill="#0b0909"/>
  <path d="M 392 230 C 376 266, 372 308, 384 342 M 508 228 C 526 262, 532 302, 520 336" fill="none" stroke="#0b0909" stroke-width="4.2" stroke-linecap="round"/>

  <path d="M 404 234 C 404 202, 424 184, 450 184 C 476 184, 496 202, 496 234 C 496 272, 484 308, 450 328 C 416 308, 404 272, 404 234 Z"
        fill="url(#ip-skin)"/>
  <!-- Asymmetric Knowing Eyebrows & Half-Lidded Sharp Eyes -->
  <path d="M 415 240 Q 429 231 442 238" fill="none" stroke="#181412" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M 458 242 Q 472 236 486 244" fill="none" stroke="#181412" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M 416 254 Q 429 247 441 254 Q 429 260 416 254 Z" fill="#fafaf9"/>
  <circle cx="430" cy="254" r="4" fill="#181412"/>
  <circle cx="431.5" cy="252.5" r="1.3" fill="#fef3c7"/>
  <path d="M 459 254 Q 472 247 485 254 Q 472 260 459 254 Z" fill="#fafaf9"/>
  <circle cx="471" cy="254" r="4" fill="#181412"/>
  <circle cx="472.5" cy="252.5" r="1.3" fill="#fef3c7"/>
  <!-- Crooked Knowing Smile -->
  <path d="M 434 292 Q 450 302 468 288" fill="none" stroke="#44403c" stroke-width="2.2" stroke-linecap="round"/>

  <!-- Loosely Draped Scholar Robe Collar & Tilted Gourd Sash -->
  <path d="M 336 364 C 390 434, 434 492, 484 550 L 450 584 C 392 522, 342 464, 310 404 Z" fill="#1d1a17"/>
  <path d="M 564 364 C 510 434, 466 492, 416 550 L 450 584 C 508 522, 558 464, 590 404 Z" fill="#151311"/>
  <path d="M 340 370 C 394 440, 436 494, 480 546 M 560 370 C 506 440, 464 494, 420 546"
        fill="none" stroke="#d6cbb4" stroke-width="1.8" opacity="0.6" stroke-linecap="round"/>
  <path d="M 366 648 Q 450 682 534 648 L 530 708 Q 450 742 370 708 Z" fill="#191614"/>
  <path d="M 368 652 Q 450 686 532 652 M 370 705 Q 450 738 530 705" fill="none" stroke="#a89c84" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>
  <!-- Small Wine Gourd Hanging from Sash -->
  <g transform="translate(526 706) rotate(16)">
    <ellipse cx="0" cy="18" rx="14" ry="17" fill="#785c3a" stroke="#e7dfd1" stroke-width="1.6"/>
    <ellipse cx="0" cy="-2" rx="9" ry="11" fill="#785c3a" stroke="#e7dfd1" stroke-width="1.6"/>
  </g>

  <!-- === CRACKED BAMBOO FOLDING FAN PROP (Held up in front of chest/chin) === -->
  <g transform="translate(450 544) rotate(-8)">
    <!-- Fan Leaf with Jagged Notch & Gold Kintsugi Crack -->
    <path d="M 0 0 L -158 -124 A 196 196 0 0 1 -18 -195 L -26 -142 L 8 -196 A 196 196 0 0 1 158 -124 Z"
          fill="url(#ip-fan-leaf)" stroke="#e7e5e4" stroke-width="2.4" stroke-linejoin="round"/>
    <!-- Ink-Wash Mountain Silhouette Painted on Fan Leaf -->
    <path d="M -92 -82 Q -46 -126 -14 -94 Q 24 -138 78 -84 Q 22 -74 -92 -82 Z" fill="#44403c" opacity="0.62"/>
    <!-- Bamboo Fan Ribs -->
    <g stroke="#57534e" stroke-width="2.4" stroke-linecap="round">
      <line x1="0" y1="0" x2="-152" y2="-120"/>
      <line x1="0" y1="0" x2="-106" y2="-156"/>
      <line x1="0" y1="0" x2="-56" y2="-182"/>
      <line x1="0" y1="0" x2="10" y2="-188"/>
      <line x1="0" y1="0" x2="64" y2="-178"/>
      <line x1="0" y1="0" x2="112" y2="-152"/>
      <line x1="0" y1="0" x2="152" y2="-120"/>
    </g>
    <!-- Glowing Gold-Lacquer Kintsugi Crack Seam -->
    <g filter="url(#ip-glow-gold)">
      <path d="M -18 -195 L -26 -142 L -6 -108 L -14 -68" fill="none" stroke="#fbbf24" stroke-width="2.8" stroke-linecap="round"/>
      <circle cx="-26" cy="-142" r="3" fill="#fef3c7"/>
    </g>
    <!-- Fan Pivot Pin & Tassel -->
    <circle cx="0" cy="0" r="8" fill="#292524" stroke="#fbbf24" stroke-width="2"/>
    <path d="M 0 8 C 8 34, 4 62, 12 88" fill="none" stroke="#d97706" stroke-width="3.2" stroke-linecap="round"/>
  </g>
  <!-- Hand Holding Fan Pivot -->
  <path d="M 426 544 C 436 530, 464 530, 474 544 C 476 560, 464 572, 448 572 C 432 572, 424 560, 426 544 Z" fill="url(#ip-skin)"/>

  <!-- Bottom 22% Dark Ink-Mist Breathing Room -->
  <g filter="url(#ip-ink-blur-wide)" opacity="0.74">
    <ellipse cx="220" cy="942" rx="280" ry="90" fill="#171413"/>
    <ellipse cx="680" cy="962" rx="280" ry="90" fill="#12100f"/>
    <ellipse cx="450" cy="1065" rx="460" ry="125" fill="#070607"/>
  </g>
  <rect x="-150" y="900" width="1200" height="450" fill="url(#ip-bottom-fade)"/>
  <rect x="-150" y="-180" width="1200" height="1680" filter="url(#ip-paper)" opacity="0.88"/>
</svg>`;

/**
 * Idiot Identity Badge SVG (64x64) — Cracked bamboo folding fan.
 */
const buildIdiotBadgeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  <defs>
    <radialGradient id="ib-bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#292420"/>
      <stop offset="100%" stop-color="#0e0c0c"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="28" fill="url(#ib-bg)" stroke="#e7dfd1" stroke-width="2.4"/>
  <circle cx="32" cy="32" r="23" stroke="#a89c84" stroke-width="1.2" stroke-dasharray="6 3"/>
  <!-- Unfolded Fan with Visible Crack Notch -->
  <path d="M 32 47 L 12 29 A 26 26 0 0 1 30 18 L 28 28 L 35 18 A 26 26 0 0 1 52 29 Z"
        fill="#e7dfd1" stroke="#f5f5f4" stroke-width="2" stroke-linejoin="round"/>
  <path d="M 32 47 L 19 25 M 32 47 L 44 25" stroke="#57534e" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M 30 18 L 28 28 L 33 34" stroke="#d97706" stroke-width="2" stroke-linecap="round"/>
  <circle cx="32" cy="47" r="2.5" fill="#fbbf24"/>
</svg>
`;

/**
 * Villager 3:4 Portrait SVG (900x1200; supports bleed viewBox).
 * Steadfast Wuxia commoner/watchman with woven straw hat slung at shoulders
 * and glowing warm-amber paper lantern piercing swirling village fog.
 */
const buildVillagerPortraitSvg = ({ viewBox = '0 0 900 1200' } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%">
  <defs>
    ${sharedInkWashDefs('vp')}
    <filter id="vp-cloud-wash" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="4" seed="89" result="f"/>
      <feColorMatrix type="matrix" in="f" values="
        0 0 0 0 0.16
        0 0 0 0 0.20
        0 0 0 0 0.23
        0 0 0 0.56 -0.13"/>
    </filter>
    <filter id="vp-glow-lantern" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="16" result="b1"/>
      <feGaussianBlur stdDeviation="5" in="SourceGraphic" result="b2"/>
      <feMerge>
        <feMergeNode in="b1"/>
        <feMergeNode in="b2"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <linearGradient id="vp-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#050709"/>
      <stop offset="34%" stop-color="#0f151b"/>
      <stop offset="68%" stop-color="#172028"/>
      <stop offset="100%" stop-color="#06080b"/>
    </linearGradient>
    <radialGradient id="vp-moon-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f5f1e4" stop-opacity="0.86"/>
      <stop offset="35%" stop-color="#94a3b8" stop-opacity="0.32"/>
      <stop offset="68%" stop-color="#334155" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#0b1014" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vp-moon-disc" cx="42%" cy="38%" r="60%">
      <stop offset="0%" stop-color="#faf6ec"/>
      <stop offset="62%" stop-color="#d6d0c0"/>
      <stop offset="100%" stop-color="#87919b"/>
    </radialGradient>
    <linearGradient id="vp-tunic" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#222a33"/>
      <stop offset="48%" stop-color="#11171d"/>
      <stop offset="100%" stop-color="#06080b"/>
    </linearGradient>
    <linearGradient id="vp-straw-hat" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8c7350"/>
      <stop offset="55%" stop-color="#4e402e"/>
      <stop offset="100%" stop-color="#1e1913"/>
    </linearGradient>
    <radialGradient id="vp-lantern-aura" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.62"/>
      <stop offset="45%" stop-color="#d97706" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#78350f" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vp-lantern-core" cx="50%" cy="46%" r="54%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="45%" stop-color="#fcd34d"/>
      <stop offset="85%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#78350f"/>
    </radialGradient>
    <linearGradient id="vp-skin" x1="0.35" y1="0" x2="0.65" y2="1">
      <stop offset="0%" stop-color="#ede6d8"/>
      <stop offset="64%" stop-color="#c9bfad"/>
      <stop offset="100%" stop-color="#84888e"/>
    </linearGradient>
    <linearGradient id="vp-bottom-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#06080b" stop-opacity="0"/>
      <stop offset="48%" stop-color="#06080b" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#040608" stop-opacity="0.99"/>
    </linearGradient>
  </defs>

  <rect x="-150" y="-180" width="1200" height="1680" fill="url(#vp-sky)"/>
  <rect x="-150" y="-180" width="1200" height="1050" filter="url(#vp-cloud-wash)" opacity="0.66"/>

  <!-- Pale Village Moon -->
  <circle cx="450" cy="248" r="290" fill="url(#vp-moon-halo)"/>
  <circle cx="450" cy="248" r="144" fill="url(#vp-moon-disc)" opacity="0.9"/>
  <g filter="url(#vp-ink-blur-soft)" opacity="0.5">
    <path d="M 248 232 Q 372 204 494 226 Q 596 244 672 216" fill="none" stroke="#161d24" stroke-width="20" stroke-linecap="round"/>
  </g>

  <!-- Misty Village Rooftops & Ink Foothills -->
  <path d="M -140 770 C 0 622, 118 534, 224 552 C 324 568, 404 612, 496 568 C 584 526, 684 484, 788 534 C 884 578, 964 644, 1060 735 L 1060 1380 L -140 1380 Z" fill="#0f151c" opacity="0.86"/>
  <path d="M -140 860 C 48 708, 178 652, 304 662 C 422 672, 502 606, 616 632 C 734 658, 868 716, 1060 822 L 1060 1380 L -140 1380 Z" fill="#0a0e13" opacity="0.94"/>
  <!-- Curved Village Eaves Silhouette -->
  <path d="M 38 618 Q 88 614 128 594 L 116 624 L 132 624 L 132 652 L 56 652 L 56 624 Z" fill="#090c10" opacity="0.78"/>
  <path d="M 756 610 Q 802 606 838 588 L 828 616 L 842 616 L 842 642 L 772 642 L 772 616 Z" fill="#090c10" opacity="0.78"/>

  <!-- === THE VILLAGER FIGURE === -->
  <g>
    <path d="M 450 184
             C 492 190, 528 224, 542 268
             C 560 314, 568 358, 600 398
             C 656 456, 718 536, 732 644
             C 686 670, 628 672, 582 642
             C 568 726, 584 842, 622 1025
             L 652 1240 L 248 1240 L 278 1025
             C 316 842, 332 726, 318 642
             C 272 672, 214 670, 168 644
             C 182 536, 244 456, 300 398
             C 332 358, 340 314, 358 268
             C 372 224, 408 190, 450 184 Z"
          fill="url(#vp-tunic)"/>
  </g>

  <!-- Flowing Hair & Steadfast Face -->
  <path d="M 450 198 C 492 202, 518 232, 512 284 C 506 328, 496 368, 512 426 C 488 392, 484 348, 482 314 L 418 314 C 416 348, 412 392, 388 426 C 404 368, 394 328, 388 284 C 382 232, 408 202, 450 198 Z"
        fill="#0a0d12"/>
  <path d="M 404 238 C 404 206, 424 190, 450 190 C 476 190, 496 206, 496 238 C 496 276, 484 312, 450 330 C 416 312, 404 276, 404 238 Z"
        fill="url(#vp-skin)"/>
  <!-- Warm Lantern Rim-Light on Left Cheek -->
  <path d="M 405 240 C 407 272, 418 304, 444 324 C 428 296, 424 268, 424 238 C 424 218, 432 202, 442 194 C 418 198, 405 216, 405 240 Z"
        fill="#fbbf24" opacity="0.24"/>
  <!-- Clear Resolute Eyes -->
  <path d="M 415 244 Q 428 238 441 244" fill="none" stroke="#11161b" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M 459 244 Q 472 238 485 244" fill="none" stroke="#11161b" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M 416 258 Q 429 251 441 258 Q 429 264 416 258 Z" fill="#fafaf9"/>
  <circle cx="429" cy="258" r="4.2" fill="#11161b"/>
  <circle cx="430.5" cy="256.5" r="1.4" fill="#fef3c7"/>
  <path d="M 459 258 Q 471 251 484 258 Q 471 264 459 258 Z" fill="#fafaf9"/>
  <circle cx="471" cy="258" r="4.2" fill="#11161b"/>
  <circle cx="472.5" cy="256.5" r="1.4" fill="#fef3c7"/>
  <path d="M 436 296 Q 450 300 464 296" fill="none" stroke="#52525b" stroke-width="2" stroke-linecap="round"/>

  <!-- Woven Conical Straw Hat worn above Brow (unmistakable silhouette) -->
  <g>
    <path d="M 276 226 Q 450 112 624 226 Q 450 248 276 226 Z" fill="url(#vp-straw-hat)" stroke="#e2ddd2" stroke-width="2.2"/>
    <path d="M 332 220 Q 450 144 568 220" fill="none" stroke="#9e8764" stroke-width="1.6" opacity="0.78"/>
    <path d="M 378 222 Q 450 172 522 222" fill="none" stroke="#9e8764" stroke-width="1.4" opacity="0.65"/>
  </g>
  <path d="M 392 230 Q 406 286 428 320 M 508 230 Q 494 286 472 320" fill="none" stroke="#a89878" stroke-width="1.8" opacity="0.72"/>

  <!-- Crossed Linen Tunic & Flowing Waist Sash -->
  <path d="M 342 364 C 392 432, 434 490, 484 548 L 450 582 C 394 520, 344 464, 312 404 Z" fill="#161d24"/>
  <path d="M 558 364 C 508 432, 466 490, 416 548 L 450 582 C 506 520, 556 464, 588 404 Z" fill="#1b232c"/>
  <path d="M 346 370 C 396 440, 436 494, 480 544 M 554 370 C 504 440, 464 494, 420 544"
        fill="none" stroke="#94a3b8" stroke-width="1.8" opacity="0.65" stroke-linecap="round"/>
  <path d="M 366 648 Q 450 682 534 648 L 530 708 Q 450 742 370 708 Z" fill="#141a21"/>
  <path d="M 368 652 Q 450 686 532 652 M 370 705 Q 450 738 530 705" fill="none" stroke="#78716c" stroke-width="1.5" stroke-linecap="round" opacity="0.75"/>

  <!-- === RAISED BAMBOO POLE & GLOWING AMBER PAPER LANTERN === -->
  <path d="M 326 488 C 296 520, 272 558, 266 588 C 292 606, 336 592, 364 554 Z" fill="#12181f"/>
  <!-- Crooked Bamboo Lantern Pole -->
  <path d="M 318 656 Q 284 524 276 382 Q 274 342 316 336" fill="none" stroke="#786348" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M 254 574 C 264 560, 284 562, 294 574 C 294 590, 276 598, 260 590 Z" fill="url(#vp-skin)"/>

  <!-- Warm Amber Paper Lantern Piercing Fog -->
  <circle cx="316" cy="436" r="142" fill="url(#vp-lantern-aura)"/>
  <g filter="url(#vp-glow-lantern)">
    <line x1="316" y1="336" x2="316" y2="372" stroke="#d6d3cb" stroke-width="2"/>
    <rect x="294" y="370" width="44" height="10" rx="2" fill="#292524" stroke="#e7e5e4" stroke-width="1.6"/>
    <ellipse cx="316" cy="434" rx="44" ry="56" fill="url(#vp-lantern-core)" stroke="#fef3c7" stroke-width="2.2"/>
    <path d="M 278 408 Q 316 418 354 408 M 272 434 Q 316 444 360 434 M 278 460 Q 316 470 354 460" fill="none" stroke="#b45309" stroke-width="1.6" opacity="0.68"/>
    <rect x="296" y="486" width="40" height="9" rx="2" fill="#292524" stroke="#e7e5e4" stroke-width="1.6"/>
    <path d="M 316 495 L 316 534" stroke="#ef4444" stroke-width="3.2" stroke-linecap="round"/>
  </g>

  <!-- Bottom 22% Dark Ink-Mist Breathing Room -->
  <g filter="url(#vp-ink-blur-wide)" opacity="0.74">
    <ellipse cx="220" cy="942" rx="280" ry="90" fill="#121820"/>
    <ellipse cx="680" cy="962" rx="280" ry="90" fill="#0f141a"/>
    <ellipse cx="450" cy="1065" rx="460" ry="125" fill="#06080b"/>
  </g>
  <rect x="-150" y="900" width="1200" height="450" fill="url(#vp-bottom-fade)"/>
  <rect x="-150" y="-180" width="1200" height="1680" filter="url(#vp-paper)" opacity="0.88"/>
</svg>`;

/**
 * Villager Identity Badge SVG (64x64) — Woven straw hat & warm paper lantern.
 */
const buildVillagerBadgeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  <defs>
    <radialGradient id="vb-bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1e262e"/>
      <stop offset="100%" stop-color="#0b0e12"/>
    </radialGradient>
    <radialGradient id="vb-lantern" cx="50%" cy="46%" r="54%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="55%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#b45309"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="28" fill="url(#vb-bg)" stroke="#e2e8f0" stroke-width="2.4"/>
  <circle cx="32" cy="32" r="23" stroke="#64748b" stroke-width="1.2" stroke-dasharray="6 3"/>
  <!-- Woven Conical Straw Hat -->
  <path d="M 14 27 L 32 14 L 50 27 Q 32 31 14 27 Z" fill="#786348" stroke="#f5f5f4" stroke-width="2" stroke-linejoin="round"/>
  <!-- Glowing Amber Paper Lantern -->
  <rect x="27" y="31" width="10" height="3" fill="#292524" stroke="#f5f5f4" stroke-width="1.2"/>
  <ellipse cx="32" cy="41" rx="9" ry="9" fill="url(#vb-lantern)" stroke="#fef3c7" stroke-width="1.8"/>
  <path d="M 24 41 Q 32 43 40 41" stroke="#b45309" stroke-width="1.4"/>
  <path d="M 32 50 V 55" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
</svg>
`;

// ---------------------------------------------------------------------------
// Remaining 2 Night Skill VFX Artwork Builders
// ---------------------------------------------------------------------------

/**
 * Skill VFX SVG: seer-check (640x640) — Silver-indigo celestial eye & moon-mirror pulse.
 * Zero embedded text.
 */
const buildSeerCheckSkillSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">
  <defs>
    ${sharedInkWashDefs('sc')}
    <filter id="sc-glow-indigo" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="14" result="b1"/>
      <feGaussianBlur stdDeviation="5" in="SourceGraphic" result="b2"/>
      <feMerge>
        <feMergeNode in="b1"/>
        <feMergeNode in="b2"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <radialGradient id="sc-bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#0e2240"/>
      <stop offset="48%" stop-color="#091322"/>
      <stop offset="100%" stop-color="#050709"/>
    </radialGradient>
    <radialGradient id="sc-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f0f9ff"/>
      <stop offset="35%" stop-color="#38bdf8"/>
      <stop offset="72%" stop-color="#1d4ed8" stop-opacity="0.65"/>
      <stop offset="100%" stop-color="#0c4a6e" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="640" fill="url(#sc-bg)"/>

  <!-- Ink-Wash Astrolabe & Moon-Mirror Rings -->
  <g filter="url(#sc-brush-edge)" opacity="0.82">
    <circle cx="320" cy="320" r="230" fill="none" stroke="#1e3554" stroke-width="18" stroke-dasharray="170 32 88 26"/>
    <circle cx="320" cy="320" r="184" fill="none" stroke="#7dd3fc" stroke-width="3.5" stroke-dasharray="130 26 60 22" opacity="0.72"/>
  </g>
  <circle cx="320" cy="320" r="220" fill="url(#sc-core)" opacity="0.6"/>

  <!-- Engraved Crescent Moon-Mirror Frame -->
  <g filter="url(#sc-glow-indigo)">
    <circle cx="320" cy="320" r="136" fill="#071224" stroke="#e0f2fe" stroke-width="4"/>
    <circle cx="320" cy="320" r="116" fill="none" stroke="#38bdf8" stroke-width="2" stroke-dasharray="18 10"/>
    <path d="M 320 156 V 184 M 320 456 V 484 M 156 320 H 184 M 456 320 H 484" stroke="#bae6fd" stroke-width="4" stroke-linecap="round"/>
    <!-- Luminous Celestial Eye -->
    <path d="M 192 320 Q 320 222 448 320 Q 320 418 192 320 Z" fill="#e0f2fe" stroke="#38bdf8" stroke-width="3.5"/>
    <circle cx="320" cy="320" r="52" fill="url(#sc-core)"/>
    <circle cx="320" cy="320" r="22" fill="#071224"/>
    <circle cx="334" cy="306" r="9" fill="#ffffff"/>
  </g>

  <!-- Truth-Revealing Star Motes & Light Beams -->
  <g filter="url(#sc-glow-indigo)" opacity="0.9">
    <path d="M 180 206 C 232 162, 280 144, 320 140" fill="none" stroke="#bae6fd" stroke-width="3" stroke-linecap="round"/>
    <path d="M 460 434 C 408 478, 360 496, 320 500" fill="none" stroke="#bae6fd" stroke-width="3" stroke-linecap="round"/>
    <circle cx="192" cy="212" r="5" fill="#f0f9ff"/>
    <circle cx="448" cy="428" r="5" fill="#f0f9ff"/>
    <circle cx="452" cy="196" r="4" fill="#7dd3fc"/>
    <circle cx="188" cy="442" r="4" fill="#7dd3fc"/>
  </g>

  <rect width="640" height="640" filter="url(#sc-paper)" opacity="0.85"/>
</svg>`;

/**
 * Skill VFX SVG: wolf-kill (640x640 logical -> 768x768) — Razor ink-crimson triple
 * wolf claw slash tearing through moonlit mist with glowing crimson lupine glint.
 * Zero embedded text.
 */
const buildWolfKillSkillSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="640" height="640">
  <defs>
    ${sharedInkWashDefs('wk')}
    <filter id="wk-mist" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012 0.022" numOctaves="4" seed="61" result="f"/>
      <feColorMatrix type="matrix" in="f" values="
        0 0 0 0 0.24
        0 0 0 0 0.08
        0 0 0 0 0.10
        0 0 0 0.54 -0.14"/>
    </filter>
    <radialGradient id="wk-bg" cx="50%" cy="50%" r="62%">
      <stop offset="0%" stop-color="#2c0810"/>
      <stop offset="48%" stop-color="#13060a"/>
      <stop offset="100%" stop-color="#040507"/>
    </radialGradient>
    <radialGradient id="wk-moon" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fecaca" stop-opacity="0.72"/>
      <stop offset="45%" stop-color="#dc2626" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wk-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fee2e2"/>
      <stop offset="32%" stop-color="#ef4444"/>
      <stop offset="72%" stop-color="#991b1b" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#450a0a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="640" fill="url(#wk-bg)"/>
  <rect width="640" height="640" filter="url(#wk-mist)" opacity="0.72"/>

  <!-- Pale Blood-Moon & Sumi-e Vortex Rings -->
  <circle cx="320" cy="312" r="204" fill="url(#wk-moon)"/>
  <circle cx="320" cy="312" r="126" fill="#e7ded8" opacity="0.16"/>
  <g filter="url(#wk-brush-edge)" opacity="0.88">
    <circle cx="320" cy="320" r="236" fill="none" stroke="#3b0d16" stroke-width="18" stroke-dasharray="168 32 96 24 64 28"/>
    <circle cx="320" cy="320" r="186" fill="none" stroke="#f87171" stroke-width="3" stroke-dasharray="116 26 52 20" opacity="0.72"/>
  </g>
  <circle cx="320" cy="320" r="215" fill="url(#wk-core)" opacity="0.54"/>

  <!-- Shadowy Lupine Glint Eyes & Snarl Silhouette in Moonlit Mist -->
  <g opacity="0.86">
    <path d="M 224 218 L 240 164 L 278 206 L 320 198 L 362 206 L 400 164 L 416 218 C 430 278, 412 346, 370 398 L 320 434 L 270 398 C 228 346, 210 278, 224 218 Z"
          fill="#0b0507" stroke="#7f1d1d" stroke-width="2.5"/>
    <g filter="url(#wk-glow-crimson)">
      <path d="M 248 256 L 298 272 L 260 282 Z" fill="#fef2f2" stroke="#ef4444" stroke-width="1.8"/>
      <path d="M 392 256 L 342 272 L 380 282 Z" fill="#fef2f2" stroke="#ef4444" stroke-width="1.8"/>
      <circle cx="274" cy="269" r="3.5" fill="#dc2626"/>
      <circle cx="366" cy="269" r="3.5" fill="#dc2626"/>
    </g>
  </g>

  <!-- Razor-Sharp Ink-Crimson Triple Wolf Claw Slash Tearing Across Canvas -->
  <g filter="url(#wk-glow-crimson)">
    <!-- Upper Claw Tear -->
    <path d="M 194 118 C 304 176, 414 260, 528 394 C 446 318, 336 226, 194 118 Z" fill="#ffffff" stroke="#ef4444" stroke-width="3"/>
    <path d="M 242 146 C 330 202, 414 274, 492 356" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
    <!-- Center Dominant Claw Tear -->
    <path d="M 122 152 C 254 224, 388 326, 514 482 C 402 384, 274 282, 122 152 Z" fill="#ffffff" stroke="#ef4444" stroke-width="3.6"/>
    <path d="M 156 176 C 274 252, 384 342, 488 452" fill="none" stroke="#fff1f2" stroke-width="5.2" stroke-linecap="round"/>
    <!-- Lower Claw Tear -->
    <path d="M 106 234 C 218 296, 332 378, 434 504 C 336 418, 228 334, 106 234 Z" fill="#ffffff" stroke="#ef4444" stroke-width="3"/>
    <path d="M 142 262 C 238 322, 326 392, 404 472" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
  </g>

  <!-- Razor Ink-Splatter Wisps & Crimson Embers -->
  <g filter="url(#wk-glow-crimson)">
    <path d="M 452 238 L 494 214 L 474 252 Z" fill="#ef4444"/>
    <path d="M 164 362 L 128 394 L 182 382 Z" fill="#dc2626"/>
    <circle cx="152" cy="316" r="5" fill="#ef4444"/>
    <circle cx="496" cy="286" r="4.5" fill="#fca5a5"/>
    <circle cx="458" cy="482" r="5.5" fill="#fef2f2"/>
    <circle cx="226" cy="466" r="4" fill="#ef4444"/>
    <circle cx="386" cy="166" r="4" fill="#fca5a5"/>
  </g>

  <rect width="640" height="640" filter="url(#wk-paper)" opacity="0.85"/>
</svg>`;

// ---------------------------------------------------------------------------
// Role & Skill Registries (All 6 Roles + 4 Night Skills)
// ---------------------------------------------------------------------------

export const ROLE_SPECS = {
  witch: {
    id: 'witch',
    masterPortraitPath: path.join(SCRIPT_DIR, 'assets', 'witch-portrait-master.png'),
    buildPortraitSvg: buildWitchPortraitSvg,
    buildBadgeSvg: buildWitchBadgeSvg,
    lines: {
      en: {
        voice: 'Moira',
        text: 'One drop mends the soul; another seals the night.',
      },
      zh: {
        voice: 'Tingting',
        text: '一滴回魂续命，一滴封喉断夜。',
      },
    },
  },
  seer: {
    id: 'seer',
    masterPortraitPath: path.join(SCRIPT_DIR, 'assets', 'seer-portrait-master.png'),
    buildPortraitSvg: buildSeerPortraitSvg,
    buildBadgeSvg: buildSeerBadgeSvg,
    lines: {
      en: {
        voice: 'Samantha',
        text: 'Beneath the ink-stained moon, no mask hides its true shadow.',
      },
      zh: {
        voice: 'Meijia',
        text: '水墨孤月之下，真假终见分晓。',
      },
    },
  },
  werewolf: {
    id: 'werewolf',
    masterPortraitPath: path.join(SCRIPT_DIR, 'assets', 'werewolf-portrait-master.png'),
    buildPortraitSvg: buildWerewolfPortraitSvg,
    buildBadgeSvg: buildWerewolfBadgeSvg,
    lines: {
      en: {
        voice: 'Daniel',
        rate: 195,
        text: 'Walk among the lanterns by day; let the fangs speak at midnight.',
      },
      zh: {
        voice: 'Rocko (Chinese (China mainland))',
        text: '白昼隐入灯火，子夜利爪封喉。',
      },
    },
  },
  hunter: {
    id: 'hunter',
    masterPortraitPath: path.join(SCRIPT_DIR, 'assets', 'hunter-portrait-master.png'),
    buildPortraitSvg: buildHunterPortraitSvg,
    buildBadgeSvg: buildHunterBadgeSvg,
    lines: {
      en: {
        voice: 'Aman',
        text: 'Even if I fall tonight, my final bolt never misses.',
      },
      zh: {
        voice: 'Eddy (Chinese (China mainland))',
        text: '纵使今夜倒下，最后一箭也绝不落空。',
      },
    },
  },
  idiot: {
    id: 'idiot',
    masterPortraitPath: path.join(SCRIPT_DIR, 'assets', 'idiot-portrait-master.png'),
    buildPortraitSvg: buildIdiotPortraitSvg,
    buildBadgeSvg: buildIdiotBadgeSvg,
    lines: {
      en: {
        voice: 'Karen',
        text: 'Laugh at the fool if you wish—only the waking survive the crowd.',
      },
      zh: {
        voice: 'Grandpa (Chinese (China mainland))',
        text: '世人笑我痴狂，唯有清醒者死里逃生。',
      },
    },
  },
  villager: {
    id: 'villager',
    masterPortraitPath: path.join(SCRIPT_DIR, 'assets', 'villager-portrait-master.png'),
    buildPortraitSvg: buildVillagerPortraitSvg,
    buildBadgeSvg: buildVillagerBadgeSvg,
    lines: {
      en: {
        voice: 'Tessa',
        rate: 205,
        text: 'No mystic art in hand, only clear eyes to pierce the fog.',
      },
      zh: {
        voice: 'Flo (Chinese (China mainland))',
        text: '手中虽无奇术，明眼亦能破雾寻狼。',
      },
    },
  },
};

export const SKILL_SPECS = {
  'witch-save': {
    id: 'witch-save',
    buildSkillSvg: buildWitchSaveSkillSvg,
    auraGlow: '#10b981',
    auraLight: '#a7f3d0',
  },
  'witch-poison': {
    id: 'witch-poison',
    buildSkillSvg: buildWitchPoisonSkillSvg,
    auraGlow: '#e11d48',
    auraLight: '#fecdd3',
  },
  'seer-check': {
    id: 'seer-check',
    buildSkillSvg: buildSeerCheckSkillSvg,
    auraGlow: '#38bdf8',
    auraLight: '#bae6fd',
  },
  'wolf-kill': {
    id: 'wolf-kill',
    buildSkillSvg: buildWolfKillSkillSvg,
    auraGlow: '#dc2626',
    auraLight: '#fecaca',
  },
};

// ---------------------------------------------------------------------------
// Rendering & Encoding Pipeline
// ---------------------------------------------------------------------------

const runExec = async (bin, args) => {
  try {
    return await execFileAsync(bin, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : '';
    const stdout = error?.stdout ? String(error.stdout) : '';
    throw new Error(`${bin} ${args.join(' ')} failed: ${error.message}\n${stderr || stdout}`);
  }
};

const renderSvgToPng = async (page, svgMarkup, width, height, outPngPath, { omitBackground = false } = {}) => {
  await page.setViewportSize({ width, height });
  await page.setContent(wrapSvgHtml(svgMarkup, width, height), { waitUntil: 'load' });
  await page.screenshot({ path: outPngPath, type: 'png', omitBackground });
};

const encodePngToWebp = async (page, inPngPath, outWebpPath, width, height, quality) => {
  const pngBytes = await fs.readFile(inPngPath);
  const pngDataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`;
  const webpDataUrl = await page.evaluate(
    ({ src, w, h, q }) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('2d context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/webp', q);
        if (!out.startsWith('data:image/webp;base64,')) {
          reject(new Error('Chromium canvas did not produce image/webp'));
          return;
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error('Failed to load PNG into canvas for WebP encoding'));
      img.src = src;
    }),
    { src: pngDataUrl, w: width, h: height, q: quality / 100 },
  );
  const base64 = webpDataUrl.slice('data:image/webp;base64,'.length);
  await fs.writeFile(outWebpPath, Buffer.from(base64, 'base64'));
};

const encodeEntranceMp4 = async (bleedPngPath, portraitPngPath, mistPngPath, outMp4Path) => {
  const { width, height, fps, frames } = MEDIA_SPEC.entrance;
  // Blend ease-out camera push (0..2.0s) across 1080x1440 bleed -> 900x1200 inner box,
  // cross-dissolving mist veil (0..1.85s) and settling onto exact portrait hold frames (2.0..2.6s).
  // `zoompan` uses output frame `on` (0..77). Push spans frames 0..59; frames 60..77 hold steady.
  const holdStartFrame = 60;
  const holdStartSec = (holdStartFrame / fps).toFixed(4);
  const totalSec = (frames / fps).toFixed(4);

  const filterComplex = [
    `[0:v]scale=${MEDIA_SPEC.portrait.bleedWidth}:${MEDIA_SPEC.portrait.bleedHeight}:flags=lanczos,`
    + `zoompan=z='if(lt(on,${holdStartFrame}),1.0+0.2*(1-pow(1-on/${holdStartFrame},3)),1.2)'`
    + `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},settb=1/${fps}[pushed]`,
    `[1:v]scale=${width}:${height}:flags=lanczos,loop=loop=${frames - 1}:size=1:start=0,fps=${fps},setpts=N/(${fps}*TB),settb=1/${fps}[hold]`,
    `[pushed][hold]xfade=transition=fade:duration=0.18:offset=1.82[cam]`,
    `[2:v]format=rgba,scale=${width}:${height}:flags=lanczos,loop=loop=${frames - 1}:size=1:start=0,fps=${fps},setpts=N/(${fps}*TB),settb=1/${fps},`
    + `fade=t=out:st=0.25:d=1.55:alpha=1[mist]`,
    `[cam][mist]overlay=x='min(0,-30+30*t/1.8)':y='0':shortest=1,`
    + `fade=t=in:st=0:d=0.35:color=0x06080b,trim=duration=${totalSec},format=yuv420p[vout]`,
  ].join(';');

  // Encode with CRF 19 first for Retina HD clarity; if >= maxBytes budget, step up CRF deterministically.
  for (const crf of [19, 22, 25, 28]) {
    await runExec(FFMPEG_BIN, [
      '-y',
      '-i', bleedPngPath,
      '-i', portraitPngPath,
      '-i', mistPngPath,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-t', totalSec,
      '-r', String(fps),
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.0',
      '-preset', 'slow',
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      '-fflags', '+bitexact',
      '-flags:v', '+bitexact',
      '-map_metadata', '-1',
      outMp4Path,
    ]);
    const { size } = await fs.stat(outMp4Path);
    if (size < MEDIA_SPEC.entrance.maxBytes) {
      return;
    }
  }
  const { size } = await fs.stat(outMp4Path);
  throw new Error(`entrance.mp4 exceeded ${MEDIA_SPEC.entrance.maxBytes} bytes (${size} bytes)`);
};

// All times are normalized to the authored clip. The impact occurs before
// the game dismisses the cue, including its shortest 1.3-second variant.
const unit = n => Math.max(0, Math.min(1, n));
const tau = Math.PI * 2;

const skillMotion = {
  'seer-check': (t) => {
    const angle = 210 * (1 - (1 - t) ** 3);
    const focus = Math.sin(Math.PI * unit((t - 0.28) / 0.64));
    return `<g transform="rotate(${angle} 384 372)" fill="none" stroke="#c0e5ff" stroke-width="3">
      <circle cx="384" cy="372" r="177" stroke-dasharray="109 262" />
      <circle cx="384" cy="372" r="216" stroke-dasharray="45 181" />
      </g><ellipse cx="384" cy="372" rx="${12 + 134 * focus}" ry="${3 + 32 * focus}"
        fill="none" stroke="#dcfaff" opacity="${focus}" stroke-width="4"/> `;
  },
  'witch-save': (t) => {
    const fall = unit(t / 0.42);
    const drop = `<ellipse cx="384" cy="${180 + 350 * fall ** 2}" rx="9" ry="18"
      fill="#dcfff2" opacity="${1 - Math.floor(fall)}"/>`;
    const waves = [0, 0.1, 0.2].map(delay => {
      const progress = unit((t - 0.39 - delay) / 0.42);
      return `<ellipse cx="384" cy="530" rx="${5 + 289 * progress}" ry="${3 + 76 * progress}"
        stroke="#9fffd3" fill="none" stroke-width="${5 - 3 * progress}" opacity="${Math.sin(progress * Math.PI)}"/>`;
    });
    return drop + waves.join('');
  },
  'witch-poison': (t) => Array.from({ length: 40 }, (_, i) => {
    const progress = unit((t - (i % 8) * 0.024) / 0.77);
    const radius = (38 + i * 3) * progress;
    const angle = i * 2.4 + 4.2 * progress;
    const x = 308 + 116 * progress + Math.cos(angle) * radius;
    const y = 263 + 226 * progress + Math.sin(angle) * radius;
    return `<circle cx="${x}" cy="${y}" r="${4 + 23 * progress}" fill="${i % 3 ? '#6f244d' : '#b65488'}"
      opacity="${0.55 * Math.sin(progress * Math.PI)}"/>`;
  }).join(''),
  'wolf-kill': (t) => [0, 1, 2].map(i => {
    const cut = unit((t - i * 0.085) / 0.34);
    const fade = 1 - unit((t - 0.48 - i * 0.055) / 0.32);
    const offset = i * 54;
    return `<path d="M ${-80 + offset},42 Q ${265 + offset},340 ${650 + offset},658"
      fill="none" stroke="#ffdddd" stroke-width="${6 - i}" opacity="${fade}" pathLength="1"
      stroke-dasharray="${cut} 2" />`;
  }).join(''),
};

const encodeSkillMp4 = async (page, tmpDir, skillId, posterPath, outMp4Path) => {
  const { width, height, fps, frames, maxBytes } = MEDIA_SPEC.skill;
  const posterSrc = 'data:image/webp;base64,' + (await fs.readFile(posterPath)).toString('base64');
  await page.setViewportSize({ width, height });
  await page.setContent(`<style>*{margin:0}body{background:#080b10;overflow:hidden}
    img,svg{position:absolute;inset:0;width:100%;height:100%}
    g{filter:drop-shadow(0 0 6px currentColor)}</style>
    <img src="${posterSrc}"/><svg viewBox="0 0 768 768"><g/></svg>`);
  await page.locator('img').evaluate(img => img.decode());
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / (frames - 1);
    const impact = Math.exp(-((t - 0.46) ** 2) / 0.008);
    const motion = skillMotion[skillId](t);
    const recoil = skillId === 'wolf-kill' ? 0.014 * Math.sin(t * tau * 9) * impact : 0;
    await page.evaluate(({ t, impact, motion, recoil }) => {
      const img = document.querySelector('img');
      img.style.transform = `scale(${1.055 - 0.055 * t + recoil})`;
      img.style.filter = `brightness(${0.35 + 0.65 * Math.min(1, t * 3) + 0.16 * impact})`;
      const layer = document.querySelector('g');
      layer.innerHTML = motion;
      layer.style.opacity = String(Math.min(1, t * 9, (1 - t) * 5));
    }, { t, impact, motion, recoil });
    await page.screenshot({ type: 'png', path: path.join(tmpDir, `${skillId}-${String(frame).padStart(3, '0')}.png`) });
  }
  for (const crf of [19, 22, 25, 28]) {
    await runExec(FFMPEG_BIN, ['-y', '-framerate', String(fps), '-i', path.join(tmpDir, `${skillId}-%03d.png`),
      '-frames:v', String(frames), '-vf', 'scale=out_range=tv,format=yuv420p', '-color_range', 'tv', '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0',
      '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-an', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', outMp4Path]);
    if ((await fs.stat(outMp4Path)).size < maxBytes) return;
  }
  throw new Error(`${skillId}.mp4 exceeded ${maxBytes} bytes`);
};


/**
 * Generate offline `preview-local-tts` voice track via macOS `say` + `ffmpeg`.
 */
const generateLocalTtsMp3 = async ({ voice, rate, text, tmpDir, outMp3Path }) => {
  const rawAiff = path.join(tmpDir, `${path.basename(outMp3Path, '.mp3')}.aiff`);
  const sayArgs = ['-v', voice, ...(rate ? ['-r', String(rate)] : []), '-o', rawAiff, text];
  await runExec(SAY_BIN, sayArgs);
  const audioFilter = [
    'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB',
    'areverse',
    'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB',
    'areverse',
    'apad=pad_dur=0.12',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ].join(',');

  await runExec(FFMPEG_BIN, [
    '-y',
    '-i', rawAiff,
    '-af', audioFilter,
    '-ar', String(MEDIA_SPEC.voice.sampleRate),
    '-ac', '1',
    '-c:a', 'libmp3lame',
    '-b:a', MEDIA_SPEC.voice.bitrate,
    '-fflags', '+bitexact',
    '-map_metadata', '-1',
    '-metadata', `comment=${TTS_PROVENANCE}`,
    outMp3Path,
  ]);
};

// ---------------------------------------------------------------------------
// Build Orchestration
// ---------------------------------------------------------------------------

const buildMasterPortraitBleedSvg = (masterPngBase64) => {
  const dataUri = `data:image/png;base64,${masterPngBase64}`;
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-90 -120 1080 1440" width="100%" height="100%">
  <defs>
    <filter id="mp-backdrop-blur" x="-15%" y="-15%" width="130%" height="130%">
      <feGaussianBlur stdDeviation="24"/>
    </filter>
    <filter id="mp-edge-feather" x="-5%" y="-5%" width="110%" height="110%">
      <feGaussianBlur stdDeviation="12"/>
    </filter>
    <radialGradient id="mp-vignette" cx="50%" cy="44%" r="62%">
      <stop offset="45%" stop-color="#06070a" stop-opacity="0"/>
      <stop offset="82%" stop-color="#06070a" stop-opacity="0.58"/>
      <stop offset="100%" stop-color="#06070a" stop-opacity="0.96"/>
    </radialGradient>
    <mask id="mp-center-mask">
      <rect x="-90" y="-120" width="1080" height="1440" fill="#000000"/>
      <rect x="36" y="48" width="828" height="1104" rx="12" fill="#ffffff" filter="url(#mp-edge-feather)"/>
    </mask>
  </defs>
  <rect x="-90" y="-120" width="1080" height="1440" fill="#06070a"/>
  <image href="${dataUri}" x="-90" y="-120" width="1080" height="1440" preserveAspectRatio="xMidYMid slice" filter="url(#mp-backdrop-blur)" opacity="0.62"/>
  <rect x="-90" y="-120" width="1080" height="1440" fill="url(#mp-vignette)"/>
  <image href="${dataUri}" x="0" y="0" width="900" height="1200" preserveAspectRatio="none" mask="url(#mp-center-mask)"/>
</svg>`;
};

const buildRoleAssets = async (page, tmpDir, roleId, artworkOnly) => {
  const spec = ROLE_SPECS[roleId];
  const roleDir = path.join(PUBLIC_ROLES_DIR, roleId);
  await fs.mkdir(roleDir, { recursive: true });

  // 1. Vector badge.svg
  const badgePath = path.join(roleDir, 'badge.svg');
  if (!artworkOnly) await fs.writeFile(badgePath, spec.buildBadgeSvg(), 'utf8');

  // 2. Portrait PNG (1440x1920) -> portrait.webp
  const portraitPng = path.join(tmpDir, `${roleId}-portrait.png`);
  const portraitBleedPng = path.join(tmpDir, `${roleId}-portrait-bleed.png`);
  const mistVeilPng = path.join(tmpDir, `${roleId}-mist-veil.png`);

  const hasMasterPortrait = Boolean(spec.masterPortraitPath);
  if (hasMasterPortrait) {
    await runExec(FFMPEG_BIN, [
      '-y',
      '-i', spec.masterPortraitPath,
      '-vf', `scale=${MEDIA_SPEC.portrait.width}:${MEDIA_SPEC.portrait.height}:flags=lanczos`,
      portraitPng,
    ]);
  } else {
    await renderSvgToPng(
      page,
      spec.buildPortraitSvg({ viewBox: '0 0 900 1200' }),
      MEDIA_SPEC.portrait.width,
      MEDIA_SPEC.portrait.height,
      portraitPng,
    );
  }
  await encodePngToWebp(
    page,
    portraitPng,
    path.join(roleDir, 'portrait.webp'),
    MEDIA_SPEC.portrait.width,
    MEDIA_SPEC.portrait.height,
    MEDIA_SPEC.portrait.webpQuality,
  );

  // 3. Bleed PNG (1728x2304) + Mist Veil RGBA PNG -> entrance.mp4
  if (hasMasterPortrait) {
    const masterBase64 = (await fs.readFile(portraitPng)).toString('base64');
    await renderSvgToPng(
      page,
      buildMasterPortraitBleedSvg(masterBase64),
      MEDIA_SPEC.portrait.bleedWidth,
      MEDIA_SPEC.portrait.bleedHeight,
      portraitBleedPng,
    );
  } else {
    const bleedViewBox = `${MEDIA_SPEC.portrait.bleedOriginX} ${MEDIA_SPEC.portrait.bleedOriginY} 1080 1440`;
    await renderSvgToPng(
      page,
      spec.buildPortraitSvg({ viewBox: bleedViewBox }),
      MEDIA_SPEC.portrait.bleedWidth,
      MEDIA_SPEC.portrait.bleedHeight,
      portraitBleedPng,
    );
  }
  await renderSvgToPng(
    page,
    buildMistVeilSvg(),
    MEDIA_SPEC.portrait.width,
    MEDIA_SPEC.portrait.height,
    mistVeilPng,
    { omitBackground: true },
  );
  await encodeEntranceMp4(portraitBleedPng, portraitPng, mistVeilPng, path.join(roleDir, 'entrance.mp4'));

  if (artworkOnly) {
    return ['portrait.webp', 'entrance.mp4'].map(file => path.relative(REPO_ROOT, path.join(roleDir, file)));
  }

  // 4. Offline preview-local-tts bilingual voiceovers
  await generateLocalTtsMp3({
    voice: spec.lines.en.voice,
    rate: spec.lines.en.rate,
    text: spec.lines.en.text,
    tmpDir,
    outMp3Path: path.join(roleDir, 'voice-en.mp3'),
  });
  await generateLocalTtsMp3({
    voice: spec.lines.zh.voice,
    rate: spec.lines.zh.rate,
    text: spec.lines.zh.text,
    tmpDir,
    outMp3Path: path.join(roleDir, 'voice-zh.mp3'),
  });

  return [
    path.relative(REPO_ROOT, badgePath),
    path.relative(REPO_ROOT, path.join(roleDir, 'portrait.webp')),
    path.relative(REPO_ROOT, path.join(roleDir, 'entrance.mp4')),
    path.relative(REPO_ROOT, path.join(roleDir, 'voice-en.mp3')),
    path.relative(REPO_ROOT, path.join(roleDir, 'voice-zh.mp3')),
  ];
};

const buildSkillAssets = async (page, tmpDir, skillId) => {
  await fs.mkdir(PUBLIC_SKILLS_DIR, { recursive: true });
  const master = path.join(SCRIPT_DIR, 'assets', `${skillId}-effect-master.png`);
  const outWebp = path.join(PUBLIC_SKILLS_DIR, `${skillId}.webp`);
  const outMp4 = path.join(PUBLIC_SKILLS_DIR, `${skillId}.mp4`);
  const { width, height, webpQuality } = MEDIA_SPEC.skill;
  await encodePngToWebp(page, master, outWebp, width, height, webpQuality);
  await encodeSkillMp4(page, tmpDir, skillId, outWebp, outMp4);

  return [
    path.relative(REPO_ROOT, outWebp),
    path.relative(REPO_ROOT, outMp4),
  ];
};

// ---------------------------------------------------------------------------
// Inspection & Validation (`--check`)
// ---------------------------------------------------------------------------

const ffprobeJson = async (filePath) => {
  const { stdout } = await runExec(FFPROBE_BIN, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-of', 'json',
    filePath,
  ]);
  return JSON.parse(stdout);
};

/**
 * Inspect top-level ISO BMFF atoms to verify `moov` precedes `mdat` (`+faststart`).
 */
const readMp4TopAtoms = async (filePath) => {
  const buf = await fs.readFile(filePath);
  const atoms = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size32 = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    let size = size32;
    if (size === 1 && offset + 16 <= buf.length) {
      size = Number(buf.readBigUInt64BE(offset + 8));
    } else if (size === 0) {
      size = buf.length - offset;
    }
    if (size < 8 || offset + size > buf.length) break;
    atoms.push({ type, offset, size });
    offset += size;
  }
  return atoms;
};

const validateSvgBadge = async (filePath) => {
  const errors = [];
  if (!existsSync(filePath)) {
    return { ok: false, errors: ['missing file'], summary: 'MISSING' };
  }
  const content = await fs.readFile(filePath, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes < 200 || bytes > 65536) errors.push(`unexpected SVG byte size ${bytes}`);
  if (!/<svg\b[^>]*viewBox="0 0 64 64"/.test(content)) errors.push('missing <svg viewBox="0 0 64 64">');
  if (/<text\b|<tspan\b|<script\b/i.test(content)) errors.push('disallowed <text>/<script> element in SVG');
  return {
    ok: errors.length === 0,
    errors,
    summary: `svg 64x64 ${bytes}B`,
  };
};

const validateImageWebp = async (filePath, expectedWidth, expectedHeight) => {
  const errors = [];
  if (!existsSync(filePath)) {
    return { ok: false, errors: ['missing file'], summary: 'MISSING' };
  }
  const { size } = await fs.stat(filePath);
  const meta = await ffprobeJson(filePath);
  const stream = meta.streams?.[0];
  if (!stream) {
    errors.push('no ffprobe stream found');
  } else {
    if (stream.codec_name !== 'webp') errors.push(`codec=${stream.codec_name} (expected webp)`);
    if (stream.width !== expectedWidth || stream.height !== expectedHeight) {
      errors.push(`dimensions=${stream.width}x${stream.height} (expected ${expectedWidth}x${expectedHeight})`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: `${stream?.codec_name || '?'} ${stream?.width || '?'}x${stream?.height || '?'} ${size}B`,
  };
};

const validateSilentMp4 = async (filePath, { width, height, minDur, maxDur, maxBytes }) => {
  const errors = [];
  if (!existsSync(filePath)) {
    return { ok: false, errors: ['missing file'], summary: 'MISSING' };
  }
  const { size } = await fs.stat(filePath);
  if (size >= maxBytes) errors.push(`size=${size}B >= budget ${maxBytes}B`);

  const meta = await ffprobeJson(filePath);
  const streams = meta.streams || [];
  const videoStreams = streams.filter((s) => s.codec_type === 'video');
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  if (videoStreams.length !== 1) errors.push(`videoStreams=${videoStreams.length} (expected 1)`);
  if (audioStreams.length !== 0) errors.push(`audioStreams=${audioStreams.length} (expected 0 / silent)`);

  const vs = videoStreams[0];
  if (vs) {
    if (vs.codec_name !== 'h264') errors.push(`codec=${vs.codec_name} (expected h264)`);
    if (vs.pix_fmt !== 'yuv420p') errors.push(`pix_fmt=${vs.pix_fmt} (expected yuv420p)`);
    if (vs.width !== width || vs.height !== height) {
      errors.push(`dimensions=${vs.width}x${vs.height} (expected ${width}x${height})`);
    }
  }
  const duration = Number(meta.format?.duration ?? vs?.duration ?? 0);
  if (Number.isNaN(duration) || duration < minDur || duration > maxDur) {
    errors.push(`duration=${duration}s outside [${minDur}, ${maxDur}]s`);
  }

  const atoms = await readMp4TopAtoms(filePath);
  const moovIdx = atoms.findIndex((a) => a.type === 'moov');
  const mdatIdx = atoms.findIndex((a) => a.type === 'mdat');
  if (moovIdx < 0 || mdatIdx < 0 || moovIdx > mdatIdx) {
    errors.push(`faststart check failed (atoms: ${atoms.map((a) => a.type).join(',')})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: `${vs?.codec_name || '?'}/${vs?.pix_fmt || '?'} ${vs?.width || '?'}x${vs?.height || '?'} ${duration.toFixed(3)}s ${size}B faststart=${moovIdx >= 0 && moovIdx < mdatIdx}`,
  };
};

const validateVoiceMp3 = async (filePath) => {
  const errors = [];
  if (!existsSync(filePath)) {
    return { ok: false, errors: ['missing file'], summary: 'MISSING' };
  }
  const { size } = await fs.stat(filePath);
  const meta = await ffprobeJson(filePath);
  const streams = meta.streams || [];
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  const videoStreams = streams.filter((s) => s.codec_type === 'video');
  if (audioStreams.length !== 1) errors.push(`audioStreams=${audioStreams.length} (expected 1)`);
  if (videoStreams.length !== 0) errors.push(`videoStreams=${videoStreams.length} (expected 0)`);

  const as = audioStreams[0];
  if (as && as.codec_name !== 'mp3') errors.push(`codec=${as.codec_name} (expected mp3)`);
  const duration = Number(meta.format?.duration ?? as?.duration ?? 0);
  if (Number.isNaN(duration) || duration < MEDIA_SPEC.voice.minDurationSec || duration > MEDIA_SPEC.voice.maxDurationSec) {
    errors.push(`duration=${duration}s outside [${MEDIA_SPEC.voice.minDurationSec}, ${MEDIA_SPEC.voice.maxDurationSec}]s`);
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: `${as?.codec_name || '?'} ${as?.sample_rate || '?'}Hz ${duration.toFixed(3)}s ${size}B (${TTS_PROVENANCE})`,
  };
};

const checkSelection = async (roles, skills) => {
  const results = [];
  for (const roleId of roles) {
    const roleDir = path.join(PUBLIC_ROLES_DIR, roleId);
    results.push({
      file: `public/assets/roles/${roleId}/badge.svg`,
      ...(await validateSvgBadge(path.join(roleDir, 'badge.svg'))),
    });
    results.push({
      file: `public/assets/roles/${roleId}/portrait.webp`,
      ...(await validateImageWebp(path.join(roleDir, 'portrait.webp'), MEDIA_SPEC.portrait.width, MEDIA_SPEC.portrait.height)),
    });
    results.push({
      file: `public/assets/roles/${roleId}/entrance.mp4`,
      ...(await validateSilentMp4(path.join(roleDir, 'entrance.mp4'), {
        width: MEDIA_SPEC.entrance.width,
        height: MEDIA_SPEC.entrance.height,
        minDur: MEDIA_SPEC.entrance.minDurationSec,
        maxDur: MEDIA_SPEC.entrance.maxDurationSec,
        maxBytes: MEDIA_SPEC.entrance.maxBytes,
      })),
    });
    results.push({
      file: `public/assets/roles/${roleId}/voice-en.mp3`,
      ...(await validateVoiceMp3(path.join(roleDir, 'voice-en.mp3'))),
    });
    results.push({
      file: `public/assets/roles/${roleId}/voice-zh.mp3`,
      ...(await validateVoiceMp3(path.join(roleDir, 'voice-zh.mp3'))),
    });
  }

  for (const skillId of skills) {
    results.push({
      file: `public/assets/skills/${skillId}.webp`,
      ...(await validateImageWebp(path.join(PUBLIC_SKILLS_DIR, `${skillId}.webp`), MEDIA_SPEC.skill.width, MEDIA_SPEC.skill.height)),
    });
    results.push({
      file: `public/assets/skills/${skillId}.mp4`,
      ...(await validateSilentMp4(path.join(PUBLIC_SKILLS_DIR, `${skillId}.mp4`), {
        width: MEDIA_SPEC.skill.width,
        height: MEDIA_SPEC.skill.height,
        minDur: MEDIA_SPEC.skill.minDurationSec,
        maxDur: MEDIA_SPEC.skill.maxDurationSec,
        maxBytes: MEDIA_SPEC.skill.maxBytes,
      })),
    });
  }

  let failures = 0;
  for (const item of results) {
    const status = item.ok ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${item.file} -> ${item.summary}`);
    if (!item.ok) {
      failures += 1;
      for (const err of item.errors) console.error(`       - ${err}`);
    }
  }
  console.log(`Checked ${results.length} assets (${results.length - failures} passed, ${failures} failed).`);
  if (failures > 0) process.exitCode = 1;
};

// ---------------------------------------------------------------------------
// CLI Entrypoint
// ---------------------------------------------------------------------------

const parseCsvFlag = (args, flag) => {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  const raw = args[idx + 1];
  if (!raw || raw.startsWith('--')) {
    throw new Error(`${flag} requires a comma-separated value`);
  }
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

const parseCliArgs = (args) => {
  if (args.includes('--help') || args.includes('-h')) {
    return { help: true };
  }
  const all = args.includes('--all');
  const check = args.includes('--check');
  const rolesFlag = parseCsvFlag(args, '--roles');
  const skillsFlag = parseCsvFlag(args, '--skills');

  const availableRoles = Object.keys(ROLE_SPECS);
  const availableSkills = Object.keys(SKILL_SPECS);

  let roles = [];
  let skills = [];
  if (all || (rolesFlag === null && skillsFlag === null)) {
    roles = availableRoles;
    skills = availableSkills;
  } else {
    roles = rolesFlag ?? [];
    skills = skillsFlag ?? [];
  }

  for (const r of roles) {
    if (!ROLE_SPECS[r]) throw new Error(`Unknown role "${r}". Available: ${availableRoles.join(', ')}`);
  }
  for (const s of skills) {
    if (!SKILL_SPECS[s]) throw new Error(`Unknown skill "${s}". Available: ${availableSkills.join(', ')}`);
  }
  return { help: false, check, roles, skills, artworkOnly: args.includes('--artwork-only') };
};

const resolveCachedChromiumExecutable = async () => {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const cacheRoots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ];
  for (const cacheRoot of cacheRoots) {
    if (!existsSync(cacheRoot)) continue;
    const entries = await fs.readdir(cacheRoot, { withFileTypes: true });
    const shellDirs = entries
      .filter((e) => e.isDirectory() && (e.name.startsWith('chromium_headless_shell-') || e.name.startsWith('chromium-')))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const dirName of shellDirs) {
      const candidates = [
        path.join(cacheRoot, dirName, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
        path.join(cacheRoot, dirName, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
        path.join(cacheRoot, dirName, 'chrome-headless-shell-linux', 'chrome-headless-shell'),
        path.join(cacheRoot, dirName, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(cacheRoot, dirName, 'chrome-linux', 'chrome'),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
};

const launchChromium = async (chromium) => {
  try {
    return await chromium.launch({ headless: true });
  } catch (primaryErr) {
    const cachedExe = await resolveCachedChromiumExecutable();
    if (cachedExe) {
      return await chromium.launch({ headless: true, executablePath: cachedExe });
    }
    try {
      return await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      throw primaryErr;
    }
  }
};

const main = async () => {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log(
      'Usage: node scripts/build-role-media.mjs [--roles <list>] [--skills <list>] [--all] [--artwork-only] [--check]\n'
      + `Available roles: ${Object.keys(ROLE_SPECS).join(', ')}\n`
      + `Available skills: ${Object.keys(SKILL_SPECS).join(', ')}`,
    );
    return;
  }

  if (parsed.check) {
    await checkSelection(parsed.roles, parsed.skills);
    return;
  }

  const { chromium } = await import('playwright');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aiwerewolf-role-media-'));
  const browser = await launchChromium(chromium);
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1 });
    const page = await context.newPage();

    const produced = [];
    for (const roleId of parsed.roles) {
      produced.push(...(await buildRoleAssets(page, tmpDir, roleId, parsed.artworkOnly)));
    }
    for (const skillId of parsed.skills) {
      produced.push(...(await buildSkillAssets(page, tmpDir, skillId)));
    }

    console.log(`Built ${produced.length} role/skill media assets (tts=${TTS_PROVENANCE}):`);
    for (const rel of produced) console.log(`- ${rel}`);
  } finally {
    await browser.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
