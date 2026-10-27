/**
 * Drawing for backgrounds and each element type. All coordinates are project pixels; the
 * caller has already applied the pixel-ratio transform.
 *
 * To add an element type: add its schema in project/schema.ts, then a drawer in `drawers`
 * below (TypeScript enforces exhaustiveness), then optional editor controls.
 */
import { mix, resolveColor, rgba } from '../project/colors';
import type {
  Background,
  Brand,
  DeviceElement,
  Element,
  ElementType,
  ImageElement,
  LogoElement,
  ParticlesElement,
  ShapeElement,
  TextElement,
} from '../project/schema';
import type { ElementState } from './animation';
import { cssFont, resolveFamily } from './fonts';
import { mulberry32 } from './random';
import { fillSpaced, wrapText } from './text';
import type { Ctx2D, Drawable, RenderEnv } from './types';

export interface DrawContext {
  ctx: Ctx2D;
  width: number;
  height: number;
  brand: Brand;
  env: RenderEnv;
  /** Seconds since the element appeared. */
  elementTime: number;
}

/** Local box of the drawn element relative to its anchor, before rotation/scale. */
export interface LocalBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Drawer<T extends Element> = (dc: DrawContext, el: T, state: ElementState) => LocalBox;

const color = (dc: DrawContext, value: string) => resolveColor(value, dc.brand);

export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * Canvas shadows are specified in device pixels and ignore the current transform, so blur
 * radii must be scaled by the pixel ratio and element scale to look the same at every size.
 */
function setGlow(dc: DrawContext, glowColor: string, blurPx: number, scale: number): void {
  dc.ctx.shadowColor = glowColor;
  dc.ctx.shadowBlur = blurPx * dc.env.pixelRatio * scale;
  dc.ctx.shadowOffsetX = 0;
  dc.ctx.shadowOffsetY = 0;
}

function clearShadow(ctx: Ctx2D): void {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function setDropShadow(dc: DrawContext, size: number, scale: number): void {
  const k = dc.env.pixelRatio * scale;
  dc.ctx.shadowColor = 'rgba(0,0,0,0.45)';
  dc.ctx.shadowBlur = size * 0.08 * k;
  dc.ctx.shadowOffsetX = 0;
  dc.ctx.shadowOffsetY = size * 0.03 * k;
}

function drawMissing(dc: DrawContext, w: number, h: number, label: string): void {
  const { ctx } = dc;
  ctx.fillStyle = 'rgba(255,80,80,0.15)';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = 'rgba(255,80,80,0.9)';
  ctx.lineWidth = Math.max(2, dc.height * 0.003);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = cssFont('Inter', 600, Math.max(10, dc.height * 0.025));
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, dc.height * 0.01);
  ctx.textAlign = 'left';
}

const drawText: Drawer<TextElement> = (dc, el, state) => {
  const { ctx, width: W, height: H } = dc;
  const size = el.size * H;
  const family = resolveFamily(el.font, dc.brand);
  ctx.font = cssFont(family, el.weight, size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const text = el.uppercase ? el.text.toUpperCase() : el.text;
  const baseSpacing = el.letterSpacing * size;
  const spacing = (el.letterSpacing + state.tracking) * size;
  // Wrap with the element's own spacing so animated tracking never reflows lines.
  const lines = wrapText(ctx, text, el.maxWidth * W, baseSpacing);
  const lineHeight = size * el.lineHeight;
  const blockHeight = lines.length * lineHeight;
  const animatedWidth = (l: { text: string; width: number }) =>
    l.width + (spacing - baseSpacing) * Math.max(0, Array.from(l.text).length - 1);
  const blockWidth = Math.max(0, ...lines.map(animatedWidth));

  const totalChars = lines.reduce((n, l) => n + Array.from(l.text).length, 0);
  let remaining = state.reveal >= 1 ? Infinity : Math.floor(state.reveal * totalChars + 1e-9);

  ctx.fillStyle = color(dc, el.color);
  if (el.glow) setGlow(dc, rgba(color(dc, el.glow.color), 0.9), size * 0.5 * el.glow.strength, state.scale);

  lines.forEach((line, i) => {
    if (remaining <= 0) return;
    const lineWidth = animatedWidth(line);
    const left = el.align === 'left' ? 0 : el.align === 'center' ? -lineWidth / 2 : -lineWidth;
    const baseline = -blockHeight / 2 + lineHeight * (i + 0.5) + size * 0.35;
    const chars = Array.from(line.text);
    const visible = remaining === Infinity ? line.text : chars.slice(0, remaining).join('');
    remaining -= chars.length;
    fillSpaced(ctx, visible, left, baseline, spacing);
    if (el.glow && el.glow.strength > 0.5) fillSpaced(ctx, visible, left, baseline, spacing);
  });
  clearShadow(ctx);

  const left = el.align === 'left' ? 0 : el.align === 'center' ? -blockWidth / 2 : -blockWidth;
  return { x: left, y: -blockHeight / 2, width: blockWidth, height: blockHeight };
};

const drawShape: Drawer<ShapeElement> = (dc, el, state) => {
  const { ctx, width: W, height: H } = dc;
  const w = el.width * W;
  const h = el.height * H;
  ctx.beginPath();
  if (el.shape === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else roundRectPath(ctx, -w / 2, -h / 2, w, h, el.cornerRadius * H);
  if (el.glow) setGlow(dc, rgba(color(dc, el.glow.color), 0.9), H * 0.04 * el.glow.strength, state.scale);
  if (el.fill) {
    ctx.fillStyle = color(dc, el.fill);
    ctx.fill();
  }
  if (el.stroke && el.strokeWidth > 0) {
    ctx.strokeStyle = color(dc, el.stroke);
    ctx.lineWidth = el.strokeWidth * H;
    ctx.stroke();
  }
  clearShadow(ctx);
  return { x: -w / 2, y: -h / 2, width: w, height: h };
};

function drawImageCover(ctx: Ctx2D, img: Drawable, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.width - sw) / 2;
  const sy = 0; // top-aligned: screenshots usually matter most at the top
  ctx.drawImage(img as CanvasImageSource, sx, sy, sw, Math.min(sh, img.height), x, y, w, h);
}

const drawImageEl: Drawer<ImageElement> = (dc, el, state) => {
  const { ctx, width: W, height: H } = dc;
  const img = dc.env.assets.get(el.assetId);
  const w = el.width * W;
  const h = img ? (w * img.height) / img.width : w * 0.5625;
  if (!img) {
    if (dc.env.showMissingAssets) drawMissing(dc, w, h, 'Missing image');
    return { x: -w / 2, y: -h / 2, width: w, height: h };
  }
  const r = el.cornerRadius * H;
  if (el.shadow) {
    ctx.save();
    setDropShadow(dc, H, state.scale);
    roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
  ctx.clip();
  ctx.drawImage(img as CanvasImageSource, -w / 2, -h / 2, w, h);
  ctx.restore();
  return { x: -w / 2, y: -h / 2, width: w, height: h };
};

const drawLogo: Drawer<LogoElement> = (dc, el, state) => {
  const { ctx, height: H } = dc;
  const markSize = el.size * H;
  const img = el.assetId ? dc.env.assets.get(el.assetId) : undefined;

  if (el.assetId) {
    const w = img ? (markSize * img.width) / img.height : markSize;
    if (!img) {
      if (dc.env.showMissingAssets) drawMissing(dc, w, markSize, 'Missing logo');
    } else {
      if (el.glow) setGlow(dc, rgba(color(dc, el.glow.color), 0.9), markSize * 0.25 * el.glow.strength, state.scale);
      ctx.drawImage(img as CanvasImageSource, -w / 2, -markSize / 2, w, markSize);
      clearShadow(ctx);
    }
    return { x: -w / 2, y: -markSize / 2, width: w, height: markSize };
  }

  // Generated mark: rounded square with the wordmark's initial, plus the wordmark text.
  const family = resolveFamily(el.font, dc.brand);
  const textSize = markSize * 0.62;
  ctx.font = cssFont(family, 700, textSize);
  const word = el.wordmark.trim();
  const gap = word ? markSize * 0.32 : 0;
  const textWidth = word ? ctx.measureText(word).width : 0;
  const total = markSize + gap + textWidth;
  const left = -total / 2;
  const markColor = color(dc, el.markColor);

  if (el.glow) setGlow(dc, rgba(color(dc, el.glow.color), 0.9), markSize * 0.35 * el.glow.strength, state.scale);
  const grad = ctx.createLinearGradient(left, -markSize / 2, left + markSize, markSize / 2);
  grad.addColorStop(0, mix(markColor, '#ffffff', 0.25));
  grad.addColorStop(1, markColor);
  roundRectPath(ctx, left, -markSize / 2, markSize, markSize, markSize * 0.26);
  ctx.fillStyle = grad;
  ctx.fill();
  clearShadow(ctx);

  const initial = (word[0] ?? '•').toUpperCase();
  ctx.font = cssFont(family, 800, markSize * 0.56);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(initial, left + markSize / 2, markSize * 0.2);

  if (word) {
    ctx.font = cssFont(family, 700, textSize);
    ctx.textAlign = 'left';
    ctx.fillStyle = color(dc, el.color);
    ctx.fillText(word, left + markSize + gap, textSize * 0.35);
  }
  ctx.textAlign = 'left';
  return { x: left, y: -markSize / 2, width: total, height: markSize };
};

/** Neutral dashboard mock-up drawn when a device element has no screenshot asset. */
function drawPlaceholderUI(dc: DrawContext, x: number, y: number, w: number, h: number, accent: string): void {
  const { ctx } = dc;
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(x, y, w, h);
  const pad = w * 0.03;
  const sidebar = w * 0.18;
  ctx.fillStyle = '#161922';
  ctx.fillRect(x, y, sidebar, h);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i === 1 ? rgba(accent, 0.85) : 'rgba(255,255,255,0.10)';
    roundRectPath(ctx, x + pad, y + pad + i * h * 0.09, sidebar - pad * 2, h * 0.045, h * 0.012);
    ctx.fill();
  }
  const cx = x + sidebar + pad;
  const cw = w - sidebar - pad * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  roundRectPath(ctx, cx, y + pad, cw * 0.35, h * 0.05, h * 0.012);
  ctx.fill();
  const cardW = (cw - pad * 2) / 3;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = '#1b1f2a';
    roundRectPath(ctx, cx + i * (cardW + pad), y + h * 0.14, cardW, h * 0.2, h * 0.02);
    ctx.fill();
    ctx.fillStyle = i === 0 ? accent : 'rgba(255,255,255,0.55)';
    roundRectPath(ctx, cx + i * (cardW + pad) + pad * 0.6, y + h * 0.2, cardW * 0.45, h * 0.05, h * 0.01);
    ctx.fill();
  }
  const chartY = y + h * 0.4;
  const chartH = h * 0.52;
  ctx.fillStyle = '#1b1f2a';
  roundRectPath(ctx, cx, chartY, cw, chartH, h * 0.02);
  ctx.fill();
  ctx.beginPath();
  const pts = [0.75, 0.62, 0.68, 0.48, 0.52, 0.34, 0.4, 0.22, 0.28, 0.12];
  pts.forEach((p, i) => {
    const px = cx + pad + (i / (pts.length - 1)) * (cw - pad * 2);
    const py = chartY + chartH * p;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = h * 0.012;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

const drawDevice: Drawer<DeviceElement> = (dc, el, state) => {
  const { ctx, width: W, height: H } = dc;
  const accent = color(dc, el.accent);
  const img = el.assetId ? dc.env.assets.get(el.assetId) : undefined;
  const w = el.width * W;

  if (el.frame === 'phone') {
    const h = w * 2.05;
    const r = w * 0.16;
    const bezel = w * 0.045;
    if (el.shadow) setDropShadow(dc, h, state.scale);
    roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
    ctx.fillStyle = '#0b0c10';
    ctx.fill();
    clearShadow(ctx);
    ctx.save();
    roundRectPath(ctx, -w / 2 + bezel, -h / 2 + bezel, w - bezel * 2, h - bezel * 2, r - bezel);
    ctx.clip();
    if (img) drawImageCover(ctx, img, -w / 2 + bezel, -h / 2 + bezel, w - bezel * 2, h - bezel * 2);
    else drawPlaceholderUI(dc, -w / 2 + bezel, -h / 2 + bezel, w - bezel * 2, h - bezel * 2, accent);
    ctx.restore();
    ctx.fillStyle = '#0b0c10';
    roundRectPath(ctx, -w * 0.15, -h / 2 + bezel * 1.4, w * 0.3, w * 0.07, w * 0.035);
    ctx.fill();
    if (el.assetId && !img && dc.env.showMissingAssets) drawMissing(dc, w * 0.8, w * 0.4, 'Missing screenshot');
    return { x: -w / 2, y: -h / 2, width: w, height: h };
  }

  const bar = el.frame === 'browser' ? w * 0.045 : 0;
  const screenH = img ? Math.min((w * img.height) / img.width, w * 0.75) : w * 0.625;
  const h = screenH + bar;
  const r = el.frame === 'none' ? 0 : w * 0.014;
  if (el.shadow) setDropShadow(dc, h, state.scale);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, r);
  ctx.fillStyle = '#1c1f26';
  ctx.fill();
  clearShadow(ctx);
  if (bar > 0) {
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(-w / 2 + bar * (0.7 + i * 0.55), -h / 2 + bar / 2, bar * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRectPath(ctx, -w * 0.2, -h / 2 + bar * 0.22, w * 0.4, bar * 0.56, bar * 0.2);
    ctx.fill();
  }
  ctx.save();
  roundRectPath(ctx, -w / 2, -h / 2 + bar, w, screenH, el.frame === 'none' ? 0 : r * 0.6);
  ctx.clip();
  if (img) drawImageCover(ctx, img, -w / 2, -h / 2 + bar, w, screenH);
  else drawPlaceholderUI(dc, -w / 2, -h / 2 + bar, w, screenH, accent);
  ctx.restore();
  if (el.assetId && !img && dc.env.showMissingAssets) drawMissing(dc, w * 0.6, screenH * 0.4, 'Missing screenshot');
  return { x: -w / 2, y: -h / 2, width: w, height: h };
};

const drawParticles: Drawer<ParticlesElement> = (dc, el) => {
  const { ctx, width: W, height: H } = dc;
  const rnd = mulberry32(el.seed);
  const t = dc.elementTime;
  ctx.fillStyle = color(dc, el.color);
  const baseAlpha = ctx.globalAlpha;
  for (let i = 0; i < el.count; i++) {
    const x0 = rnd();
    const y0 = rnd();
    const speedFactor = 0.4 + rnd() * 1.2;
    const phase = rnd() * Math.PI * 2;
    const radius = el.size * H * (0.5 + rnd());
    // Drift upwards and wrap around; speed is in frame-heights per second.
    const y = ((((y0 - el.speed * speedFactor * t) % 1) + 1) % 1) * H * 1.1 - H * 0.05;
    const x = (x0 + Math.sin(t * 0.6 + phase) * 0.01) * W;
    ctx.globalAlpha = baseAlpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.7 + phase)));
    ctx.beginPath();
    // Particles are positioned in frame space; undo the element's anchor offset.
    ctx.arc(x - W / 2, y - H / 2, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = baseAlpha;
  return { x: -W / 2, y: -H / 2, width: W, height: H };
};

export const drawers: { [T in ElementType]: Drawer<Extract<Element, { type: T }>> } = {
  text: drawText,
  shape: drawShape,
  image: drawImageEl,
  logo: drawLogo,
  device: drawDevice,
  particles: drawParticles,
};

export function drawBackground(ctx: Ctx2D, bg: Background, brand: Brand, W: number, H: number, time: number): void {
  const c = (v: string) => resolveColor(v, brand);
  if (bg.type === 'solid') {
    ctx.fillStyle = c(bg.color);
    ctx.fillRect(0, 0, W, H);
    return;
  }
  let gradient: CanvasGradient;
  if (bg.type === 'linear-gradient') {
    const angle = ((bg.angle + bg.rotateSpeed * time) * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
    gradient = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
  } else {
    const cx = bg.cx * W;
    const cy = bg.cy * H;
    const r = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  }
  [...bg.stops].sort((a, b) => a.offset - b.offset).forEach((s) => gradient.addColorStop(s.offset, rgba(c(s.color))));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  if (bg.vignette > 0) {
    const r = Math.hypot(W, H) / 2;
    const v = ctx.createRadialGradient(W / 2, H / 2, r * 0.35, W / 2, H / 2, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${bg.vignette})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }
}
