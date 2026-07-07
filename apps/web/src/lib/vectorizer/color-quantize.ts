/**
 * 颜色量化 — Median Cut 算法
 *
 * 修复：对大图做稀疏采样（最多 40000 像素），避免 O(n log n) 排序时内存爆炸。
 * 采样对量化精度几乎无影响（调色板提取本身就是统计操作）。
 */

const MAX_SAMPLE_PIXELS = 40000;

export interface ColorLayer {
  color: [number, number, number];
  alpha: number;
  mask: Uint8Array;
  pixelCount: number;
}

export function quantizeColors(
  imageData: ImageData,
  targetCount: number
): [number, number, number][] {
  const { data, width, height } = imageData;
  const totalPx = width * height;

  // 稀疏采样
  const step = Math.max(1, Math.floor(Math.sqrt(totalPx / MAX_SAMPLE_PIXELS)));
  const pixels: [number, number, number][] = [];

  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 10) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }

  if (pixels.length === 0) return [[0, 0, 0]];
  return medianCut(pixels, Math.max(2, targetCount));
}

function medianCut(
  pixels: [number, number, number][],
  maxColors: number
): [number, number, number][] {
  if (pixels.length === 0) return [[0, 0, 0]];
  if (maxColors <= 1) return [avg(pixels)];

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

function avg(v: [number, number, number][]): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (const [pr, pg, pb] of v) { r += pr; g += pg; b += pb; }
  const n = v.length;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

// ── 掩码构建（在完整 ImageData 上操作） ──────────────

export function buildColorLayers(
  imageData: ImageData,
  palette: [number, number, number][]
): ColorLayer[] {
  const { data, width, height } = imageData;
  const pc = width * height;

  const layers: ColorLayer[] = palette.map((color) => ({
    color, alpha: 1, mask: new Uint8Array(pc), pixelCount: 0,
  }));

  for (let i = 0; i < pc; i++) {
    const qi = i << 2;
    if (data[qi + 3] < 10) continue;
    const r = data[qi], g = data[qi + 1], b = data[qi + 2];
    let md = Infinity, best = 0;
    for (let j = 0; j < palette.length; j++) {
      const [pr, pg, pb] = palette[j];
      const dr = r - pr, dg = g - pg, db = b - pb;
      const d = 3 * dr * dr + 6 * dg * dg + db * db;
      if (d < md) { md = d; best = j; }
    }
    layers[best].mask[i] = 1;
    layers[best].pixelCount++;
  }

  // 只过滤一次：最小像素阈值 = 总面积 0.15%
  const minPx = Math.max(5, pc * 0.0015);
  return layers.filter(l => l.pixelCount >= minPx);
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
