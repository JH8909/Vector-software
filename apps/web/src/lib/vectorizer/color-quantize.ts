/**
 * 颜色量化 — 精准捕捉所有颜色
 *
 * 策略：过采样 → 色差合并 → 全像素重算 → 去噪
 *
 * 1. Median Cut 生成 2× 目标色板（确保小面积颜色也被抓到）
 * 2. 相近色合并（ΔE < 30 的颜色视为同一色）
 * 3. 全像素最近邻分配后用真实平均色替换色板
 * 4. 去噪 → 连通分析 → 同色合并
 */

const MAX_SAMPLE = 60000;

export interface ColorLayer {
  color: [number, number, number];
  fill: string;
  mask: Uint8Array;
  pixelCount: number;
}

export interface ComponentLayer {
  color: [number, number, number];
  fill: string;
  mask: Uint8Array;
  pixelCount: number;
  name: string;
}

// ── 量化：过采样 → 合并近色 ─────────────────────────

export function quantizeColors(
  imageData: ImageData,
  targetCount: number
): [number, number, number][] {
  const { data, width, height } = imageData;
  const totalPx = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(totalPx / MAX_SAMPLE)));
  const pixels: [number, number, number][] = [];

  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 10) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pixels.length === 0) return [[0, 0, 0]];

  // 过采样：生成 2× 目标数量的色板
  const oversized = medianCut(pixels, Math.min(64, targetCount * 3));
  // 合并相近色
  return mergeSimilar(oversized, targetCount);
}

function medianCut(
  pixels: [number, number, number][],
  maxColors: number
): [number, number, number][] {
  if (pixels.length === 0 || maxColors <= 1) return [avgVec(pixels)];

  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const [r, g, b] of pixels) {
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (g < minG) minG = g; if (g > maxG) maxG = g;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }
  const c: 0 | 1 | 2 = maxR - minR >= maxG - minG && maxR - minR >= maxB - minB ? 0
    : maxG - minG >= maxB - minB ? 1 : 2;

  pixels.sort((a, b) => a[c] - b[c]);
  const mid = Math.floor(pixels.length / 2);
  return [
    ...medianCut(pixels.slice(0, mid), Math.ceil(maxColors / 2)),
    ...medianCut(pixels.slice(mid), Math.floor(maxColors / 2)),
  ];
}

function avgVec(v: [number, number, number][]): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (const [pr, pg, pb] of v) { r += pr; g += pg; b += pb; }
  const n = v.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** 合并相近色：按像素数排序，依次取未被相似色覆盖的颜色加入最终色板 */
function mergeSimilar(
  palette: [number, number, number][],
  limit: number
): [number, number, number][] {
  // 去重：移除完全相同的颜色
  const seen = new Set<string>();
  const unique: [number, number, number][] = [];
  for (const c of palette) {
    const k = c.join(',');
    if (!seen.has(k)) { seen.add(k); unique.push(c); }
  }

  if (unique.length <= limit) return unique;

  // 贪心选择：选代表色，跳过与已选色 ΔE<25 的
  const selected: [number, number, number][] = [unique[0]];
  const threshold = 25;

  for (let i = 1; i < unique.length && selected.length < limit; i++) {
    let tooClose = false;
    for (const s of selected) {
      if (deltaE(unique[i], s) < threshold) { tooClose = true; break; }
    }
    if (!tooClose) selected.push(unique[i]);
  }

  return selected;
}

/** 感知色差（简单加权欧几里得，人眼敏感度加权） */
function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  const rMean = (a[0] + b[0]) / 2;
  // 红-青通道与蓝-黄通道的敏感度差异
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr +
    4 * dg * dg +
    (2 + (255 - rMean) / 256) * db * db
  );
}

// ── 颜色层构建 ────────────────────────────────────────
//
// 修复：使用感知色差 (deltaE) 代替之前的 3-6-1 加权，
// 修正浅色区域被误分到深色调色板的问题。

export function buildColorLayers(
  imageData: ImageData,
  samplePalette: [number, number, number][]
): ColorLayer[] {
  const { data, width, height } = imageData;
  const pc = width * height;

  // Step 1: 全像素最近邻（感知色差）
  const assign = new Uint8Array(pc);
  const accum = samplePalette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));

  for (let i = 0; i < pc; i++) {
    const qi = i << 2;
    if (data[qi + 3] < 10) { assign[i] = 255; continue; }
    const r = data[qi], g = data[qi + 1], b = data[qi + 2];
    const px: [number, number, number] = [r, g, b];
    let md = Infinity, best = 0;
    for (let j = 0; j < samplePalette.length; j++) {
      const d = deltaE(px, samplePalette[j]);
      if (d < md) { md = d; best = j; }
    }
    assign[i] = best;
    accum[best].r += r;
    accum[best].g += g;
    accum[best].b += b;
    accum[best].count++;
  }

  // Step 2: 全像素真实平均色
  const palette: [number, number, number][] = accum.map(a =>
    a.count > 0
      ? [Math.round(a.r / a.count), Math.round(a.g / a.count), Math.round(a.b / a.count)] as [number, number, number]
      : [0, 0, 0] as [number, number, number]
  );

  // Step 3: 再次全像素分配（用真实色板）+ 去噪
  const layers: ColorLayer[] = palette.map((color) => ({
    color,
    fill: `rgb(${color[0]},${color[1]},${color[2]})`,
    mask: new Uint8Array(pc),
    pixelCount: 0,
  }));

  for (let i = 0; i < pc; i++) {
    if (assign[i] === 255) continue;
    layers[assign[i]].mask[i] = 1;
    layers[assign[i]].pixelCount++;
  }

  for (const layer of layers) {
    const cleaned = denoiseMask(layer.mask, width, height);
    layer.mask = cleaned.mask;
    layer.pixelCount = cleaned.count;
  }

  const minPx = Math.max(10, pc * 0.0005);
  return layers.filter(l => l.pixelCount >= minPx);
}

function denoiseMask(mask: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(mask.length);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] !== 1) continue;
      let hasNb = false;
      for (let dy = -1; dy <= 1 && !hasNb; dy++) {
        for (let dx = -1; dx <= 1 && !hasNb; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const ny = Math.min(height - 1, Math.max(0, y + dy));
          if (mask[ny * width + nx] === 1) hasNb = true;
        }
      }
      if (hasNb) { out[i] = 1; count++; }
    }
  }
  return { mask: out, count };
}

// ── 连通组件分析 ──────────────────────────────────────

const DIRS_8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minPx: number
): Uint8Array[] {
  const visited = new Uint8Array(mask.length);
  const components: Uint8Array[] = [];

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1 || visited[i]) continue;
    const comp = new Uint8Array(mask.length);
    const queue = new Uint32Array(mask.length);
    let head = 0, tail = 0;
    queue[tail++] = i; visited[i] = 1;
    while (head < tail) {
      const ci = queue[head++]; comp[ci] = 1;
      const cy = Math.floor(ci / width), cx = ci % width;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS_8[d][0], ny = cy + DIRS_8[d][1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 1 && !visited[ni]) { visited[ni] = 1; queue[tail++] = ni; }
      }
    }
    if (tail >= minPx) components.push(comp);
  }
  return components;
}

export function splitAndMergeByColor(
  layers: ColorLayer[],
  width: number,
  height: number,
  minPx: number = 30
): ComponentLayer[] {
  const result: ComponentLayer[] = [];

  for (const layer of layers) {
    const [r, g, b] = layer.color;
    if (r > 245 && g > 245 && b > 245) continue;

    const comps = connectedComponents(layer.mask, width, height, minPx);
    if (comps.length === 0) continue;

    const merged = new Uint8Array(layer.mask.length);
    let totalPc = 0;
    for (const comp of comps) {
      for (let i = 0; i < comp.length; i++) {
        if (comp[i] === 1) { merged[i] = 1; totalPc++; }
      }
    }

    result.push({
      color: layer.color, fill: layer.fill,
      mask: merged, pixelCount: totalPc,
      name: approximateName(r, g, b),
    });
  }

  result.sort((a, b) => b.pixelCount - a.pixelCount);
  return result;
}

function approximateName(r: number, g: number, b: number): string {
  if (r > 240 && g > 240 && b > 240) return 'white';
  if (r < 15 && g < 15 && b < 15) return 'black';
  const refs: [string, number, number, number][] = [
    ['red',255,0,0],['green',0,180,0],['blue',0,0,255],
    ['yellow',255,255,0],['orange',255,140,0],['pink',255,120,180],
    ['purple',160,0,255],['brown',140,70,20],['gray',128,128,128],
  ];
  let md = Infinity, best = 'color';
  for (const [n,cr,cg,cb] of refs) {
    const d = (r-cr)**2+(g-cg)**2+(b-cb)**2;
    if (d < md) { md = d; best = n; }
  }
  return best;
}

export function maskToImageData(mask: Uint8Array, width: number, height: number): ImageData {
  const d = new ImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const oi = i << 2;
    const v = mask[i] === 1 ? 0 : 255;
    d.data[oi] = d.data[oi + 1] = d.data[oi + 2] = v;
    d.data[oi + 3] = 255;
  }
  return d;
}
