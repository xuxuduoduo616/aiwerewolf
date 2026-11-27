import type { InkSceneSpec, LanternPoint, MotionZone } from './inkSceneConfig';

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform sampler2D u_tex;
uniform sampler2D u_prevTex;
uniform float u_mix;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_texResolution;
uniform vec2 u_prevTexResolution;
uniform vec2 u_focal;
uniform vec2 u_parallax;

uniform vec4 u_moon;        // x, y, radius, crimsonRim
uniform float u_moonPulse;
uniform vec4 u_mistParams;  // yStart, yEnd, speed, density
uniform vec3 u_mistTint;
uniform vec4 u_water;       // enabled, yStart, yEnd, strength
uniform float u_waterSpeed;

uniform vec4 u_foliageRect[3]; // cx, cy, rx, ry
uniform vec3 u_foliageAmp[3];  // ampX, ampY, speed

uniform vec4 u_clothRect[3];   // cx, cy, rx, ry
uniform vec3 u_clothAmp[3];    // ampX, ampY, speed

uniform vec4 u_lanterns[4];    // x, y, radius, warmth

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.54;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    value += amp * valueNoise(p);
    p = rot * p * 2.02 + vec2(17.1, 31.7);
    amp *= 0.48;
  }
  return value;
}

vec2 coverUv(vec2 uv, vec2 viewRes, vec2 texRes, vec2 focal) {
  float viewAspect = viewRes.x / max(viewRes.y, 1.0);
  float texAspect = texRes.x / max(texRes.y, 1.0);
  vec2 scale = vec2(1.0);
  if (viewAspect > texAspect) {
    scale.y = texAspect / viewAspect;
  } else {
    scale.x = viewAspect / texAspect;
  }
  return (uv - focal) * scale + focal;
}

void main() {
  // Minimal 1.2% overscan seals edges during subtle parallax while preserving Retina 1:1 sharpness.
  vec2 zoomedUv = (v_uv - 0.5) * 0.988 + 0.5;
  vec2 baseUv = coverUv(zoomedUv, u_resolution, u_texResolution, u_focal);
  vec2 uv = baseUv + u_parallax * vec2(0.006, 0.004);

  // 1. Organic wind sway in painted foliage canopies (multi-frequency harmonic gust).
  vec2 swayOffset = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 rect = u_foliageRect[i];
    vec3 amp = u_foliageAmp[i];
    if (rect.z > 0.001 && rect.w > 0.001) {
      vec2 d = (uv - rect.xy) / rect.zw;
      float dist2 = dot(d, d);
      float mask = smoothstep(1.0, 0.12, dist2);
      if (mask > 0.001) {
        float gust = 0.72 + 0.28 * sin(u_time * 0.37 + float(i) * 1.9);
        float phase = u_time * amp.z + uv.y * 11.0 + uv.x * 6.0 + float(i) * 2.3;
        float waveX = sin(phase) * 0.65 + cos(phase * 1.63 - uv.x * 4.0) * 0.35;
        float waveY = cos(phase * 0.87 + uv.y * 5.0) * 0.6 + sin(phase * 1.41) * 0.4;
        swayOffset += vec2(waveX * amp.x, waveY * amp.y) * mask * gust;
      }
    }
  }

  // 2. Directional silk / cloak / sash wind ripple (anchored strictly to cloth regions).
  for (int i = 0; i < 3; i++) {
    vec4 rect = u_clothRect[i];
    vec3 amp = u_clothAmp[i];
    if (rect.z > 0.001 && rect.w > 0.001) {
      vec2 d = (uv - rect.xy) / rect.zw;
      float dist2 = dot(d, d);
      float mask = smoothstep(1.0, 0.08, dist2);
      if (mask > 0.001) {
        float gust = 0.68 + 0.32 * sin(u_time * 0.58 + float(i) * 2.1);
        float ripple = sin(u_time * amp.z - uv.x * 26.0 + uv.y * 14.0 + float(i));
        float secondary = cos(u_time * (amp.z * 1.47) - uv.x * 38.0 - uv.y * 9.0);
        swayOffset += vec2((ripple * 0.7 + secondary * 0.3) * amp.x, ripple * amp.y) * mask * gust;
      }
    }
  }

  // 3. Subtle horizontal water surface ripples below shoreline.
  float waterMask = 0.0;
  float shimmer = 0.0;
  if (u_water.x > 0.5) {
    waterMask = smoothstep(u_water.y, u_water.y + 0.055, uv.y) * (1.0 - smoothstep(u_water.z - 0.02, u_water.z + 0.02, uv.y));
    if (waterMask > 0.001) {
      float depthFactor = clamp((uv.y - u_water.y) / max(u_water.z - u_water.y, 0.01), 0.0, 1.0);
      float w1 = sin(uv.y * 125.0 - u_time * u_waterSpeed * 2.1 + uv.x * 16.0);
      float w2 = cos(uv.y * 210.0 + u_time * u_waterSpeed * 1.4 - uv.x * 28.0);
      float rip = (w1 * 0.62 + w2 * 0.38) * u_water.w * (0.45 + 0.55 * depthFactor) * waterMask;
      swayOffset.x += rip;
      swayOffset.y += rip * 0.25;
      shimmer = max(0.0, w1 * w2) * waterMask * 0.085;
    }
  }

  vec2 sampleUv = clamp(uv + swayOffset, vec2(0.002), vec2(0.998));
  vec3 color = texture2D(u_tex, sampleUv).rgb;

  // Crossfade seamlessly from the previous scene during view transitions.
  if (u_mix < 0.999) {
    vec2 prevUv = clamp(coverUv(zoomedUv, u_resolution, u_prevTexResolution, u_focal) + u_parallax * vec2(0.008, 0.005), vec2(0.002), vec2(0.998));
    vec3 prevColor = texture2D(u_prevTex, prevUv).rgb;
    color = mix(prevColor, color, smoothstep(0.0, 1.0, u_mix));
  }

  // 4. Continuous dual-layer domain-warped FBM ink cloud sea & drifting valley mist.
  float mistBand = smoothstep(u_mistParams.x - 0.14, u_mistParams.x + 0.10, uv.y)
                 * (1.0 - smoothstep(u_mistParams.y - 0.12, u_mistParams.y + 0.10, uv.y));
  if (mistBand > 0.001 && u_mistParams.w > 0.001) {
    float t1 = u_time * u_mistParams.z;
    vec2 mUv1 = vec2(uv.x * 2.8 - t1 * 1.15, uv.y * 4.2 + sin(u_time * 0.12 + uv.x * 2.0) * 0.08);
    vec2 warp = vec2(fbm(mUv1 + vec2(3.1, 1.7)), fbm(mUv1 + vec2(8.3, 5.2)));
    float cloudFar = fbm(mUv1 + warp * 0.65);

    vec2 mUv2 = vec2(uv.x * 4.6 - t1 * 2.15 + 4.0, uv.y * 5.8 - t1 * 0.18);
    float cloudNear = fbm(mUv2 + warp * 0.45);

    float mistShape = smoothstep(0.38, 0.84, cloudFar * 0.58 + cloudNear * 0.42);
    float mistAlpha = mistShape * mistBand * u_mistParams.w;

    // Protect dark sumi-e brushwork from mist washout so ink contours stay razor-sharp.
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    float inkProtect = smoothstep(0.14, 0.48, lum);
    color = mix(color, u_mistTint * (0.58 + 0.42 * cloudNear), mistAlpha * inkProtect * 0.20);
    color += u_mistTint * mistAlpha * inkProtect * 0.035;
  }

  // 5. Breathing moonlight & subtle cinnabar lunar rim glow.
  if (u_moon.z > 0.01) {
    float aspect = u_texResolution.x / max(u_texResolution.y, 1.0);
    vec2 moonDelta = (uv - u_moon.xy) * vec2(aspect, 1.0);
    float moonDist = length(moonDelta);
    float breathe = 0.5 + 0.5 * sin(u_time * 0.48);
    float moonHalo = exp(-pow(moonDist / (u_moon.z * 1.45), 2.0));
    color += vec3(0.84, 0.88, 0.94) * moonHalo * u_moonPulse * (0.55 + 0.45 * breathe);
    if (u_moon.w > 0.01) {
      float rimRing = exp(-pow((moonDist - u_moon.z * 0.92) / (u_moon.z * 0.24), 2.0));
      color += vec3(0.76, 0.20, 0.18) * rimRing * u_moon.w * (0.14 + 0.09 * breathe);
    }
  }

  // 6. Gentle warm candle flicker on distant village lanterns.
  for (int i = 0; i < 4; i++) {
    vec4 l = u_lanterns[i];
    if (l.z > 0.001 && l.w > 0.001) {
      float aspect = u_texResolution.x / max(u_texResolution.y, 1.0);
      float d = length((uv - l.xy) * vec2(aspect, 1.0));
      float glow = exp(-pow(d / l.z, 2.0));
      float flicker = 0.78
        + 0.14 * sin(u_time * (2.6 + float(i) * 0.7) + float(i) * 3.1)
        + 0.08 * cos(u_time * (4.9 + float(i) * 1.1));
      color += vec3(0.95, 0.64, 0.26) * glow * l.w * flicker * 0.24;
    }
  }

  // 7. Subtle water moonlight shimmer.
  if (shimmer > 0.0001) {
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    color += vec3(0.82, 0.86, 0.90) * shimmer * smoothstep(0.08, 0.52, lum);
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

interface LoadedTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

const compileShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createProgram = (gl: WebGLRenderingContext): WebGLProgram | null => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
};

const padZones = (zones: readonly MotionZone[], maxCount: number): { rects: Float32Array; amps: Float32Array } => {
  const rects = new Float32Array(maxCount * 4);
  const amps = new Float32Array(maxCount * 3);
  for (let i = 0; i < Math.min(zones.length, maxCount); i += 1) {
    const [cx, cy, rx, ry, ax, ay, spd] = zones[i];
    rects[i * 4] = cx;
    rects[i * 4 + 1] = cy;
    rects[i * 4 + 2] = rx;
    rects[i * 4 + 3] = ry;
    amps[i * 3] = ax;
    amps[i * 3 + 1] = ay;
    amps[i * 3 + 2] = spd;
  }
  return { rects, amps };
};

const padLanterns = (lanterns: readonly LanternPoint[], maxCount: number): Float32Array => {
  const data = new Float32Array(maxCount * 4);
  for (let i = 0; i < Math.min(lanterns.length, maxCount); i += 1) {
    const [x, y, r, w] = lanterns[i];
    data[i * 4] = x;
    data[i * 4 + 1] = y;
    data[i * 4 + 2] = r;
    data[i * 4 + 3] = w;
  }
  return data;
};

export class InkWebGLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly textures = new Map<string, LoadedTexture>();
  private readonly fallbackTexture: LoadedTexture;
  private currentTex: LoadedTexture;
  private prevTex: LoadedTexture;
  private scene: InkSceneSpec;
  private mixProgress = 1;
  private rafId: number | null = null;
  private lastTimestamp = 0;
  private elapsed = 0;
  private disposed = false;
  private targetParallaxX = 0;
  private targetParallaxY = 0;
  private currentParallaxX = 0;
  private currentParallaxY = 0;
  private isCompact = false;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;

  private constructor(canvas: HTMLCanvasElement, gl: WebGLRenderingContext, program: WebGLProgram, initialScene: InkSceneSpec) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.scene = initialScene;

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to create WebGL buffer');
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uniformNames = [
      'u_tex', 'u_prevTex', 'u_mix', 'u_time', 'u_resolution', 'u_texResolution',
      'u_prevTexResolution', 'u_focal', 'u_parallax', 'u_moon', 'u_moonPulse',
      'u_mistParams', 'u_mistTint', 'u_water', 'u_waterSpeed',
      'u_foliageRect[0]', 'u_foliageAmp[0]', 'u_clothRect[0]', 'u_clothAmp[0]', 'u_lanterns[0]',
    ];
    this.uniforms = {};
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    this.fallbackTexture = this.createSolidTexture(10, 12, 16);
    this.currentTex = this.fallbackTexture;
    this.prevTex = this.fallbackTexture;
  }

  static create(canvas: HTMLCanvasElement, initialScene: InkSceneSpec): InkWebGLRenderer | null {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: true,
      powerPreference: 'low-power',
    });
    if (!gl) return null;

    // Gracefully degrade software rasterizers (e.g., SwiftShader/llvmpipe) to CSS + Canvas2D layers
    // so CPU-bound environments stay snappy with zero UI lag.
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererInfo = String(
      (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '',
    );
    if (/swiftshader|llvmpipe|software|basic render|mesa offscreen/i.test(rendererInfo)) {
      return null;
    }

    const program = createProgram(gl);
    if (!program) return null;
    try {
      return new InkWebGLRenderer(canvas, gl, program, initialScene);
    } catch {
      return null;
    }
  }

  private createSolidTexture(r: number, g: number, b: number): LoadedTexture {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, width: 16, height: 9 };
  }

  private uploadImage(src: string, image: HTMLImageElement): LoadedTexture {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso =
      gl.getExtension('EXT_texture_filter_anisotropic')
      || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic')
      || gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    if (aniso) {
      const maxAniso = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, maxAniso));
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const loaded: LoadedTexture = {
      texture,
      width: image.naturalWidth || 2880,
      height: image.naturalHeight || 1620,
    };
    this.textures.set(src, loaded);
    return loaded;
  }

  setScene(nextScene: InkSceneSpec, onReady?: () => void): void {
    this.scene = nextScene;
    const cached = this.textures.get(nextScene.imageSrc);
    if (cached) {
      if (this.currentTex !== cached) {
        this.prevTex = this.currentTex;
        this.currentTex = cached;
        this.mixProgress = this.prevTex === this.fallbackTexture ? 1 : 0;
      }
      onReady?.();
      return;
    }

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (this.disposed) return;
      const loaded = this.uploadImage(nextScene.imageSrc, img);
      if (this.scene.imageSrc === nextScene.imageSrc) {
        this.prevTex = this.currentTex;
        this.currentTex = loaded;
        this.mixProgress = this.prevTex === this.fallbackTexture ? 1 : 0;
        onReady?.();
      }
    };
    img.src = nextScene.imageSrc;
  }

  setParallax(nx: number, ny: number): void {
    this.targetParallaxX = Math.max(-1, Math.min(1, nx));
    this.targetParallaxY = Math.max(-1, Math.min(1, ny));
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.isCompact = width < 768;
    // Render natively at up to 2.0x Retina DPR (up to 3200px wide) so 3K WebP brushwork stays tack-sharp.
    const maxW = this.isCompact ? 1440 : 3200;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
    const scale = Math.min(dpr, maxW / width);
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.gl.viewport(0, 0, targetW, targetH);
    }
  }

  start(): void {
    if (this.rafId !== null || this.disposed) return;
    this.lastTimestamp = performance.now();
    let frameAcc = 0;
    const minFrameInterval = 1 / 36;
    const loop = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTimestamp) / 1000));
      this.lastTimestamp = now;
      if (!document.hidden) {
        this.elapsed += dt;
        frameAcc += dt;
        if (this.mixProgress < 1) {
          this.mixProgress = Math.min(1, this.mixProgress + dt * 1.9);
        }
        const damp = 1 - Math.exp(-dt * 3.5);
        this.currentParallaxX += (this.targetParallaxX - this.currentParallaxX) * damp;
        this.currentParallaxY += (this.targetParallaxY - this.currentParallaxY) * damp;
        if (frameAcc >= minFrameInterval || this.mixProgress < 1) {
          frameAcc = 0;
          this.render();
        }
      }
      this.rafId = window.requestAnimationFrame(loop);
    };
    this.rafId = window.requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private render(): void {
    const { gl, program, scene, uniforms } = this;
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentTex.texture);
    gl.uniform1i(uniforms['u_tex'], 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prevTex.texture);
    gl.uniform1i(uniforms['u_prevTex'], 1);

    gl.uniform1f(uniforms['u_mix'], this.mixProgress);
    gl.uniform1f(uniforms['u_time'], this.elapsed);
    gl.uniform2f(uniforms['u_resolution'], this.canvas.width, this.canvas.height);
    gl.uniform2f(uniforms['u_texResolution'], this.currentTex.width, this.currentTex.height);
    gl.uniform2f(uniforms['u_prevTexResolution'], this.prevTex.width, this.prevTex.height);

    const focal = this.isCompact ? scene.mobileFocal : scene.desktopFocal;
    gl.uniform2f(uniforms['u_focal'], focal[0], focal[1]);
    gl.uniform2f(uniforms['u_parallax'], this.currentParallaxX, this.currentParallaxY);

    gl.uniform4f(uniforms['u_moon'], scene.moon.x, scene.moon.y, scene.moon.radius, scene.moon.crimsonRim);
    gl.uniform1f(uniforms['u_moonPulse'], scene.moon.pulse);

    gl.uniform4f(uniforms['u_mistParams'], scene.mist.yStart, scene.mist.yEnd, scene.mist.speed, scene.mist.density);
    gl.uniform3f(uniforms['u_mistTint'], scene.mist.tint[0], scene.mist.tint[1], scene.mist.tint[2]);

    gl.uniform4f(
      uniforms['u_water'],
      scene.water.enabled ? 1 : 0,
      scene.water.yStart,
      scene.water.yEnd,
      scene.water.strength,
    );
    gl.uniform1f(uniforms['u_waterSpeed'], scene.water.speed);

    const foliage = padZones(scene.foliageZones, 3);
    gl.uniform4fv(uniforms['u_foliageRect[0]'], foliage.rects);
    gl.uniform3fv(uniforms['u_foliageAmp[0]'], foliage.amps);

    const cloth = padZones(scene.clothZones, 3);
    gl.uniform4fv(uniforms['u_clothRect[0]'], cloth.rects);
    gl.uniform3fv(uniforms['u_clothAmp[0]'], cloth.amps);

    gl.uniform4fv(uniforms['u_lanterns[0]'], padLanterns(scene.lanterns, 4));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    const { gl } = this;
    for (const item of this.textures.values()) {
      gl.deleteTexture(item.texture);
    }
    this.textures.clear();
    gl.deleteTexture(this.fallbackTexture.texture);
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
  }
}
