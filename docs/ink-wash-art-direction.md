# Oriental Ink-Wash Wuxia Visual Direction & Dynamic Scene Pipeline

This guide documents the unified Oriental ink-wash Wuxia art direction, reusable WebGL/Canvas dynamic scene architecture, and drop-in asset pipeline for AI Werewolf (`ai-werewolf.net`).

## 1. Unified Art Direction (Anchored to Role Portraits)

All scenes share the exact visual language of the 1440×1920 role portraits (`public/assets/roles/*/portrait.webp`):

- **Brushwork & Line Quality**: Crisp black calligraphic ink contours with flying-white (*feibai*) dry-brush frayed edges on garments, pine needles, and bamboo leaves, paired with wet-on-wet atmospheric sumi-e ink diffusion and subtle Xuan rice-paper micro-grain.
- **Core Palette**:
  - Deep Sumi Charcoal: `#080a0e` → `#1b1f27`
  - Silver Mountain Mist: `#6f7782` → `#c8cdd2`
  - Moon Ivory: `#eceae2`
  - Restrained Cinnabar Accent (lunar rim, waist sashes, plum petals): `#9b3733` / `#d47270`
  - Warm Paper-Lantern Amber (distant village windows & lanterns): `#d6a55c` / `#e5aa54`
- **Composition Discipline**: Clean negative space (*liubai*) behind forms, cards, and seat rings so typography and controls maintain high contrast on both desktop and mobile viewports.

## 2. Reusable Dynamic Scene Architecture

| File | Responsibility |
| --- | --- |
| `src/scene/inkSceneConfig.ts` | Per-scene registry (`sign-in`, `lobby`, `match-setup`, `game-night`, `game-day`, `shop`, `profile`, `village`), focal points, localized wind/cloth/water/moon/lantern uniforms, and shell route mapping. |
| `src/scene/inkSceneShader.ts` | Native Retina `highp` WebGL fragment shader driving seamless continuous domain-warped FBM cloud seas, localized foliage sway, anchored cloth/sash wind ripples, water-surface reflection shimmer, breathing crimson-rimmed moonlight, lantern flicker, anisotropic texture filtering, ink-contour contrast preservation, smooth scene crossfades, and damped cursor parallax. |
| `src/scene/InkParticlesCanvas.tsx` | Lightweight Canvas 2D living ambient particles: tumbling sumi-e bamboo leaves, rare cinnabar plum petals, rising warm lantern embers, and drifting ink motes with gentle desktop cursor wake. |
| `src/scene/InkWorldBackdrop.tsx` | Reusable full-bleed backdrop component with instant static 3K WebP first-paint, SVG `#ink-brush-edge` feibai dry-brush filter definition, idle scene prefetching, Retina DPR (`<= 2.0` desktop / `<= 1.75` mobile), visibility pause, non-WebGL CSS fallback, and `prefers-reduced-motion: reduce` static fallback. |
| `src/styles/ink-world.css` | Multi-layer composition, prime-ratio harmonic foreground foliage sway (`bamboo-foreground-right.webp`, `pine-bough-top.webp`), readability scrims, responsive framing, and reduced-motion rules. |
| `index.html`, `index.css`, `src/styles/lobby-refinement.css` | Legible Oriental ink-brush artistic typography hierarchy (`Eagle Lake` hero brush + `#ink-brush-edge` SVG feibai texture & Moonlit Xuan-paper wash, `Fondamento` calligraphic UI headings/CTAs, and `Kurale` organic brush-terminal body copy) preserving every original English UI string byte-for-byte. |

## 3. Asset Inventory & Drop-In Upgrade Workflow

### Generated Master Paintings & Retina 3K Output (Active)
- `scripts/assets/scenes/sign-in-bg-master.jpg` → `public/assets/scenes/sign-in-bg.webp` (`2880×1620`, Sign In: cliffside douli swordsman, ancient pine, crimson-rimmed full moon, sea of clouds, distant amber pavilions)
- `scripts/assets/scenes/lobby-bg-master.jpg` → `public/assets/scenes/lobby-bg.webp` (`2880×1620`, Lobby: Moonlit Wolf Village, terraced lantern cottages, reflecting mountain pond, karst peaks, bamboo & pine)
- `scripts/assets/scenes/game-night-bg-master.jpg` → `public/assets/scenes/game-night-bg.webp` (`2880×1620`, Game Room Night: calm nocturnal courtyard clearing framed by ancient pines, bamboo, stone lanterns, and rolling fog)

### Deterministic Matte-Painted Companion Plates (Ready for Optional Standalone Master Drop-In)
When standalone image-generation quota resets, drop any new 16:9 painting into `scripts/assets/scenes/<scene>-bg-master.png` (or `.jpg`/`.webp`) and run:

```bash
python3 scripts/build-scene-media.py
```

The script automatically prioritizes standalone masters when present and applies two-octave `ffmpeg` `lanczos` + AMD FidelityFX Contrast Adaptive Sharpening (`cas`) + dark-ink micro-contrast curves to output razor-sharp `2880×1620` Retina 3K WebP assets (`public/assets/scenes/*.webp`) plus alpha-feathered foreground botanical layers (`public/assets/scenes/layers/*.webp`).

### Standalone Asset Prompts (Optional Future Upgrades)

1. **`match-setup-bg-master.png`** (16:9):
   > Traditional Chinese sumi-e ink-wash Wuxia game concept art matching `seer-portrait-master.png`: high mountain stone terrace and ancient hilltop celestial armillary observatory perched above a swirling sea of silver-ink clouds under a luminous pale-silver full moon with subtle cinnabar rim halo, gnarled cliff pines, warm amber lantern eaves at the outer edges, calm dark misty negative space in the center for UI legibility. No people, no text, no watermarks.

2. **`game-day-bg-master.png`** (16:9):
   > Traditional Chinese sumi-e ink-wash Wuxia game concept art matching `villager-portrait-master.png`: misty pre-dawn mountain valley clearing over a tranquil ink village, dark-mode friendly moody slate-charcoal center (`#12151a`–`#282c32`) with soft warm golden-ochre dawn mist glowing gently along distant karst ridges, bamboo and ancient pine framing outer edges. No people, no bright white sky, no text.

3. **`shop-bg-master.png`** (16:9):
   > Traditional Chinese sumi-e ink-wash Wuxia game concept art matching `villager-portrait-master.png` and `witch-portrait-master.png`: nocturnal wooden Jianghu treasury veranda with dark curved eaves, hanging warm amber paper lanterns with muted cinnabar silk tassels, gnarled dark-ink plum blossom branches with sparse vermilion petals at upper corners, calm deep charcoal misty center for skin cards. No people, no text, no signs.

4. **`profile-bg-master.png`** (16:9):
   > Traditional Chinese sumi-e ink-wash Wuxia game concept art matching `witch-portrait-master.png`: serene moonlit bamboo courtyard beside a calm dark reflecting mountain lotus pond, graceful ink bamboo groves framing outer thirds, cool silver-jade mist drifting over distant karst peaks, calm dark negative space in the center. No people, no text.

5. **`village-bg-master.png`** (16:9):
   > Traditional Chinese sumi-e ink-wash Wuxia game concept art matching `villager-portrait-master.png` and `hunter-portrait-master.png`: misty nocturnal Jianghu mountain river town with an ancient stone arch bridge spanning dark water, stilted timber mountain houses with warm glowing amber lattice windows reflecting softly on ripples, karst peaks and pines behind, calm misty left-center for UI cards. No people, no text.
