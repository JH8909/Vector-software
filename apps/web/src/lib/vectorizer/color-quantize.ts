/**
 * 颜色量化 — 精准捕捉所有颜色
 *
 * 策略：背景连通域移除 → 过采样 → Oklab k-means 精炼 → 重分配 → 去噪
 *
 * 1. 从图像边界 flood 出「背景连通域」，只移除真正的背景（白色主体保留）
 * 2. Median Cut 生成 3× 目标色板做种子
 * 3. Oklab 感知空间 k-means 精炼聚类中心（替代手工色相规则）
 * 4. 全像素最近邻分配 → 形态学去噪 → 连通分析 → 同色合并
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

// ── Oklab 感知色彩空间 ────────────────────────────────

type Okl = [number, number, number];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** sRGB → Oklab（感知均匀，聚类/合并判断用） */
function srgbToOklab(r: number, g: number, b: number): Okl {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabDistSq(a: Okl, b: Okl): number {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

function oklabChroma(c: Okl): number {
  return Math.hypot(c[1], c[2]);
}

interface Cluster {
  rgb: [number, number, number];
  okl: Okl;
  count: number;
}

/**
 * Oklab 空间 k-means：以 median-cut 结果为种子迭代精炼。
 * 中心的 RGB 取簇内真实平均色（避免往返转换误差）。
 */
function kmeansOklab(
  pixels: [number, number, number][],
  seeds: [number, number, number][],
  iterations: number
): Cluster[] {
  const n = pixels.length;
  const pts = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const ok = srgbToOklab(pixels[i][0], pixels[i][1], pixels[i][2]);
    pts[i * 3] = ok[0]; pts[i * 3 + 1] = ok[1]; pts[i * 3 + 2] = ok[2];
  }

  let centers: Okl[] = seeds.map(s => srgbToOklab(s[0], s[1], s[2]));
  let sumRgb: number[][] = [];
  let sumOkl: number[][] = [];
  let counts: number[] = [];

  for (let it = 0; it < iterations; it++) {
    const k = centers.length;
    sumRgb = Array.from({ length: k }, () => [0, 0, 0]);
    sumOkl = Array.from({ length: k }, () => [0, 0, 0]);
    counts = new Array(k).fill(0);

    for (let i = 0; i < n; i++) {
      const L = pts[i * 3], A = pts[i * 3 + 1], B = pts[i * 3 + 2];
      let md = Infinity, best = 0;
      for (let j = 0; j < k; j++) {
        const dl = L - centers[j][0], da = A - centers[j][1], db = B - centers[j][2];
        const d = dl * dl + da * da + db * db;
        if (d < md) { md = d; best = j; }
      }
      counts[best]++;
      sumRgb[best][0] += pixels[i][0]; sumRgb[best][1] += pixels[i][1]; sumRgb[best][2] += pixels[i][2];
      sumOkl[best][0] += L; sumOkl[best][1] += A; sumOkl[best][2] += B;
    }

    const next: Okl[] = [];
    for (let j = 0; j < k; j++) {
      if (counts[j] === 0) continue;
      next.push([sumOkl[j][0] / counts[j], sumOkl[j][1] / counts[j], sumOkl[j][2] / counts[j]]);
    }
    if (next.length === 0) break;
    centers = next;
  }

  const clusters: Cluster[] = [];
  for (let j = 0, out = 0; j < counts.length; j++) {
    if (counts[j] === 0) continue;
    clusters.push({
      rgb: [
        Math.round(sumRgb[j][0] / counts[j]),
        Math.round(sumRgb[j][1] / counts[j]),
        Math.round(sumRgb[j][2] / counts[j]),
      ],
      okl: centers[out++],
      count: counts[j],
    });
  }
  return clusters;
}

/**
 * 从 k-means 簇中选出最终色板：
 * - 按像素数排序，合并 Oklab 距离过近的簇
 * - 强制保留高饱和强调色（数量达标时可替换低饱和浅色槽位）
 */
function selectPalette(
  clusters: Cluster[],
  limit: number,
  sampleCount: number
): [number, number, number][] {
  const mergeThr = limit <= 2 ? 0.10 : limit <= 4 ? 0.075 : 0.055;
  const thrSq = mergeThr * mergeThr;
  const ranked = [...clusters].sort((a, b) => b.count - a.count);

  const selected: Cluster[] = [];
  for (const c of ranked) {
    if (selected.length >= limit) break;
    if (selected.some(s => oklabDistSq(s.okl, c.okl) < thrSq)) continue;
    selected.push(c);
  }

  // 强调色兜底：高饱和且样本量达标的簇必须入选
  const minVividCount = Math.max(2, sampleCount * 0.0002);
  const vivid = ranked
    .filter(c => oklabChroma(c.okl) >= 0.09 && c.count >= minVividCount)
    .sort((a, b) => oklabChroma(b.okl) - oklabChroma(a.okl));
  for (const c of vivid) {
    const nearSq = thrSq * 0.56; // (0.75×thr)²
    if (selected.some(s => oklabDistSq(s.okl, c.okl) < nearSq)) continue;
    if (selected.length < limit) {
      selected.push(c);
      continue;
    }
    // 只替换「低饱和浅色」槽位，绝不挤掉深色/实色
    const idx = selected.findIndex(s => oklabChroma(s.okl) < 0.04 && s.okl[0] > 0.75);
    if (idx < 0) break;
    selected[idx] = c;
  }

  return selected.length
    ? selected.map(c => c.rgb)
    : [ranked[0]?.rgb ?? [0, 0, 0]];
}

// ── 量化入口 ──────────────────────────────────────────

export function quantizeColors(
  imageData: ImageData,
  targetCount: number,
  excludeMask?: Uint8Array
): [number, number, number][] {
  const { data, width, height } = imageData;
  const totalPx = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(totalPx / MAX_SAMPLE)));
  const pixels: [number, number, number][] = [];

  for (let p = 0; p < totalPx; p += step) {
    const i = p << 2;
    if (data[i + 3] < 10) continue;
    if (excludeMask && excludeMask[p] === 1) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (pixels.length === 0) return [[0, 0, 0]];

  if (targetCount <= 1) {
    // 单色：取非背景主色（最饱和的众数近似）
    return [pickDominantForeground(pixels)];
  }

  const seedCount = Math.min(48, Math.max(targetCount * 3, targetCount + 4));
  const seeds = medianCut([...pixels], seedCount);
  const clusters = kmeansOklab(pixels, seeds, 10);
  return selectPalette(clusters, targetCount, pixels.length);
}

/**
 * 背景掩码：从图像边界 flood 与边界中位色相近的连通像素。
 * 只有「连着图像边缘」的色块才算背景 —— 主体内部的白色/浅色区域不受影响。
 * 背景占比过小（<2%）视为无背景，返回 null。
 */
export function computeBackgroundMask(imageData: ImageData): Uint8Array | null {
  const { data, width, height } = imageData;
  const totalPx = width * height;
  const bg = guessBackgroundFromBorders(data, width, height);
  const FLOOD_THR = 26;

  const mask = new Uint8Array(totalPx);
  const queue = new Uint32Array(totalPx);
  let head = 0, tail = 0, count = 0;

  const tryPush = (p: number) => {
    if (mask[p]) return;
    const i = p << 2;
    if (data[i + 3] < 10) return; // 透明像素本来就不参与，无需标记
    const px: [number, number, number] = [data[i], data[i + 1], data[i + 2]];
    if (deltaE(px, bg) >= FLOOD_THR) return;
    mask[p] = 1;
    queue[tail++] = p;
    count++;
  };

  for (let x = 0; x < width; x++) {
    tryPush(x);
    tryPush((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    tryPush(y * width);
    tryPush(y * width + width - 1);
  }

  // 4-连通生长：避免经对角针孔漏进主体内部
  while (head < tail) {
    const p = queue[head++];
    const x = p % width, y = (p / width) | 0;
    if (x > 0) tryPush(p - 1);
    if (x < width - 1) tryPush(p + 1);
    if (y > 0) tryPush(p - width);
    if (y < height - 1) tryPush(p + width);
  }

  return count >= totalPx * 0.02 ? mask : null;
}

function chroma(c: [number, number, number]): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

function pickDominantForeground(pixels: [number, number, number][]): [number, number, number] {
  // 粗桶统计：优先「相对背景对比度高」的色，避免单色线稿误选白色
  const buckets = new Map<string, { c: [number, number, number]; n: number }>();
  for (const p of pixels) {
    const key = `${p[0] >> 3},${p[1] >> 3},${p[2] >> 3}`;
    const b = buckets.get(key);
    if (b) b.n++;
    else buckets.set(key, { c: [...p] as [number, number, number], n: 1 });
  }

  // 估计背景：最常见的浅色桶
  let bg: [number, number, number] = [255, 255, 255];
  let bgN = 0;
  for (const { c, n } of buckets.values()) {
    const lum = (c[0] + c[1] + c[2]) / 3;
    if (lum > 200 && n > bgN) { bgN = n; bg = c; }
  }

  let best: [number, number, number] = pixels[0];
  let bestScore = -1;
  for (const { c, n } of buckets.values()) {
    const dist = deltaE(c, bg);
    // 跳过接近背景的色
    if (dist < 25) continue;
    const score = n * (1 + dist / 40) * (1 + chroma(c) / 80);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  // 若全是浅色，退回最深色
  if (bestScore < 0) {
    let darkest = pixels[0];
    let minLum = 999;
    for (const p of pixels) {
      const lum = p[0] + p[1] + p[2];
      if (lum < minLum) { minLum = lum; darkest = p; }
    }
    return darkest;
  }
  return best;
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

/**
 * 合并色差极小的同类色层。
 *
 * 解决「同一片颜色被量化拆成多个几乎相同的色层」导致的：
 * - 边界像素在各近似色之间抖动 → 每层 mask 边缘破碎、互相穿插（毛边）
 * - 大量残留小色块
 *
 * 迭代合并 deltaE < threshold 的最近一对，小层并入大层，颜色按像素加权。
 * 明显不同的色（如深色阴影、强调色）因色差大而保留。
 */
function mergeNearIdenticalLayers(
  layers: ColorLayer[],
  threshold: number
): ColorLayer[] {
  if (layers.length <= 1 || threshold <= 0) return layers;
  const work = layers.map(l => ({
    color: [...l.color] as [number, number, number],
    mask: new Uint8Array(l.mask),
    pixelCount: l.pixelCount,
  }));

  let changed = true;
  while (changed && work.length > 1) {
    changed = false;
    let bi = -1, bj = -1, bd = threshold;
    for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const d = deltaE(work[i].color, work[j].color);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;

    const a = work[bi], b = work[bj];
    const tot = a.pixelCount + b.pixelCount;
    const big = a.pixelCount >= b.pixelCount ? a : b;
    const small = a.pixelCount >= b.pixelCount ? b : a;
    const color: [number, number, number] = tot > 0
      ? [
          Math.round((a.color[0] * a.pixelCount + b.color[0] * b.pixelCount) / tot),
          Math.round((a.color[1] * a.pixelCount + b.color[1] * b.pixelCount) / tot),
          Math.round((a.color[2] * a.pixelCount + b.color[2] * b.pixelCount) / tot),
        ]
      : big.color;
    for (let p = 0; p < big.mask.length; p++) if (small.mask[p] === 1) big.mask[p] = 1;
    big.color = color;
    big.pixelCount = tot;
    work.splice(work.indexOf(small), 1);
    changed = true;
  }

  return work.map(w => ({
    color: w.color,
    fill: toHex(w.color[0], w.color[1], w.color[2]),
    mask: w.mask,
    pixelCount: w.pixelCount,
  }));
}

export function buildColorLayers(
  imageData: ImageData,
  samplePalette: [number, number, number][],
  noiseReduction: number = 15,
  mergeThreshold: number = 0,
  excludeMask?: Uint8Array | null
): ColorLayer[] {
  const { data, width, height } = imageData;
  const pc = width * height;

  // Step 1: 全像素最近邻（感知色差）→ 累积真实色
  const assign = new Uint8Array(pc);
  const accum = samplePalette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
  const bgGuessEarly = guessBackgroundFromBorders(data, width, height);
  const singleEarly = samplePalette.length <= 1;

  for (let i = 0; i < pc; i++) {
    const qi = i << 2;
    if (data[qi + 3] < 10 || (excludeMask && excludeMask[i] === 1)) { assign[i] = 255; continue; }
    const r = data[qi], g = data[qi + 1], b = data[qi + 2];
    const px: [number, number, number] = [r, g, b];

    if (singleEarly) {
      // 单色：背景像素不参与平均，避免前景色被洗白
      if (!excludeMask && deltaE(px, bgGuessEarly) < 28) { assign[i] = 255; continue; }
      if (deltaE(px, samplePalette[0]) > 55) { assign[i] = 255; continue; }
      assign[i] = 0;
      accum[0].r += r; accum[0].g += g; accum[0].b += b; accum[0].count++;
      continue;
    }

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

  // Step 3: 用精炼色板重新分配（修正边界/渐变错色斑点）
  // 单色时：排除接近背景的像素，避免整图被填进唯一色层
  const bgGuess = guessBackgroundFromBorders(data, width, height);
  const singleColor = samplePalette.length <= 1;

  const layers: ColorLayer[] = palette.map((color) => ({
    color,
    fill: toHex(color[0], color[1], color[2]),
    mask: new Uint8Array(pc),
    pixelCount: 0,
  }));

  for (let i = 0; i < pc; i++) {
    if (assign[i] === 255) continue;
    const qi = i << 2;
    const px: [number, number, number] = [data[qi], data[qi + 1], data[qi + 2]];

    if (singleColor) {
      // 接近背景的像素不进前景 mask（有背景掩码时已在 Step 1 排除）
      if (!excludeMask && deltaE(px, bgGuess) < 28) continue;
      // 与前景主色差太大也不进（抗锯齿中间色交给透明）
      if (deltaE(px, palette[0]) > 55) continue;
      layers[0].mask[i] = 1;
      layers[0].pixelCount++;
      continue;
    }

    let md = Infinity, best = 0;
    for (let j = 0; j < palette.length; j++) {
      if (accum[j].count === 0) continue;
      const d = deltaE(px, palette[j]);
      if (d < md) { md = d; best = j; }
    }
    layers[best].mask[i] = 1;
    layers[best].pixelCount++;
  }

  // Step 4: 形态学去噪（强度由 noiseReduction 控制）
  const minNeighbors = noiseToMinNeighbors(noiseReduction);
  for (const layer of layers) {
    const cleaned = denoiseMask(layer.mask, width, height, minNeighbors);
    layer.mask = cleaned.mask;
    layer.pixelCount = cleaned.count;
  }

  const minPx = Math.max(10, pc * 0.0005);
  const kept = layers.filter(l => l.pixelCount >= minPx);
  // 先合并近似色层（消除同色多层导致的毛边/碎块），再吸收边缘杂色。
  // 有背景掩码时浅色/白色是真实主体内容，吸边转保守模式
  const mergedLayers = mergeNearIdenticalLayers(kept, mergeThreshold);
  return absorbFringeLayers(mergedLayers, width, height, pc, Boolean(excludeMask));
}

/**
 * 吸收边缘杂色层 + 内部碎斑：
 * - 低饱和贴边灰边 → 并入邻色
 * - 被主色包围的浅色碎斑（布丁表面白点）→ 并入包围色
 * 高饱和强调色（樱桃/叶/舌）保留。
 *
 * conservative：背景已被掩码移除时，浅色/白色层是真实主体
 * （白色贴纸描边、白色衣服等），只吸收极小的碎斑。
 */
function absorbFringeLayers(
  layers: ColorLayer[],
  width: number,
  height: number,
  totalPx: number,
  conservative: boolean = false
): ColorLayer[] {
  if (layers.length <= 1) return layers;

  const sorted = [...layers].sort((a, b) => b.pixelCount - a.pixelCount);
  const fringeMax = conservative
    ? Math.max(totalPx * 0.004, 60)
    : Math.max(totalPx * 0.025, 80);
  // 浅色薄壳（抗锯齿描边）允许更大面积也被吸收；保守模式下白壳是主体，不放宽
  const shellMax = conservative ? fringeMax : Math.max(totalPx * 0.09, 120);
  const result: ColorLayer[] = sorted.map(l => ({
    ...l,
    mask: new Uint8Array(l.mask),
  }));

  for (let i = result.length - 1; i >= 0; i--) {
    const layer = result[i];
    if (layer.pixelCount <= 0) continue;
    if (layer.pixelCount > shellMax) continue;

    const lum = (layer.color[0] + layer.color[1] + layer.color[2]) / 3;
    const isVivid = chroma(layer.color) >= 40;
    const isLight = lum > 185;
    // 大面积的非浅色层：正经色块，保留
    if (layer.pixelCount > fringeMax && !isLight) continue;
    // 饱和实色（非浅）：强调色，保留
    if (isVivid && !isLight) continue;

    const touch = new Array(result.length).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pi = y * width + x;
        if (layer.mask[pi] !== 1) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            for (let j = 0; j < result.length; j++) {
              if (j === i || result[j].pixelCount <= 0) continue;
              if (result[j].mask[ni] === 1) touch[j]++;
            }
          }
        }
      }
    }

    let bestJ = -1, bestTouch = 0;
    for (let j = 0; j < result.length; j++) {
      if (j === i) continue;
      if (touch[j] > bestTouch) { bestTouch = touch[j]; bestJ = j; }
    }

    const dominant = result.find((l, idx) => idx !== i && l.pixelCount > totalPx * 0.12);
    const nearDominant = dominant && deltaE(layer.color, dominant.color) < 22;
    const mostlyBoundary = bestTouch >= layer.pixelCount * 0.45;
    // 薄壳：绝大多数像素都贴在别的色边界上（沿轮廓的一圈）
    const thinShell = bestJ >= 0 && bestTouch >= layer.pixelCount * 0.6;
    // 浅色抗锯齿描边：浅色 + 薄壳 → 吸收进它包裹的邻色（即便饱和度高）
    const lightShell = isLight && thinShell;
    // 浅色碎斑：几乎全被某一色包围
    const enclosedSpeck =
      lum > 200 &&
      chroma(layer.color) < 30 &&
      bestJ >= 0 &&
      bestTouch >= layer.pixelCount * 0.7 &&
      result[bestJ].pixelCount > layer.pixelCount * 3;

    if (!(mostlyBoundary || nearDominant || enclosedSpeck || lightShell)) continue;

    const target =
      (lightShell || enclosedSpeck || mostlyBoundary) && bestJ >= 0
        ? result[bestJ]
        : (dominant || (bestJ >= 0 ? result[bestJ] : null));
    if (!target) continue;

    for (let p = 0; p < layer.mask.length; p++) {
      if (layer.mask[p] === 1) {
        target.mask[p] = 1;
        layer.mask[p] = 0;
      }
    }
    target.pixelCount += layer.pixelCount;
    layer.pixelCount = 0;
  }

  // 填补各层内部小孔（残缺白点）
  for (const layer of result) {
    if (layer.pixelCount <= 0) continue;
    const filled = fillMaskHoles(layer.mask, width, height, Math.max(40, Math.floor(totalPx * 0.0004)));
    layer.mask = filled.mask;
    layer.pixelCount = filled.count;
  }

  return result
    .filter(l => l.pixelCount > 0)
    .map(l => ({
      ...l,
      fill: toHex(l.color[0], l.color[1], l.color[2]),
    }));
}

const DIRS_8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

/**
 * 填充 mask 内部小孔：从图像边界 flood 外部，剩余未访问的 0 区域若面积小则填为 1。
 */
function fillMaskHoles(
  mask: Uint8Array,
  width: number,
  height: number,
  maxHolePx: number
): { mask: Uint8Array; count: number } {
  const outside = new Uint8Array(mask.length);
  const queue = new Uint32Array(mask.length);
  let head = 0, tail = 0;
  const push = (i: number) => {
    if (outside[i] || mask[i] === 1) return;
    outside[i] = 1;
    queue[tail++] = i;
  };

  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + (width - 1));
  }

  while (head < tail) {
    const ci = queue[head++];
    const cy = Math.floor(ci / width), cx = ci % width;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DIRS_8[d][0], ny = cy + DIRS_8[d][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      push(ny * width + nx);
    }
  }

  const out = new Uint8Array(mask);
  let count = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) count++;

  // 收集内部孔洞连通域
  const visited = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1 || outside[i] || visited[i]) continue;
    const hole: number[] = [];
    let h = 0;
    const q2 = new Uint32Array(mask.length);
    let qh = 0, qt = 0;
    q2[qt++] = i; visited[i] = 1;
    while (qh < qt) {
      const ci = q2[qh++];
      hole.push(ci);
      const cy = Math.floor(ci / width), cx = ci % width;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS_8[d][0], ny = cy + DIRS_8[d][1];
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 1 || outside[ni] || visited[ni]) continue;
        visited[ni] = 1;
        q2[qt++] = ni;
      }
    }
    if (hole.length > 0 && hole.length <= maxHolePx) {
      for (const hi of hole) { out[hi] = 1; count++; }
    }
  }
  return { mask: out, count };
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function guessBackgroundFromBorders(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): [number, number, number] {
  const samples: number[][] = [[], [], []];
  const push = (i: number) => {
    if (data[i + 3] < 200) return;
    samples[0].push(data[i]);
    samples[1].push(data[i + 1]);
    samples[2].push(data[i + 2]);
  };
  for (let x = 0; x < width; x++) {
    push((0 * width + x) << 2);
    push(((height - 1) * width + x) << 2);
  }
  for (let y = 0; y < height; y++) {
    push((y * width + 0) << 2);
    push((y * width + (width - 1)) << 2);
  }
  if (samples[0].length === 0) return [255, 255, 255];
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return [med(samples[0]), med(samples[1]), med(samples[2])];
}

/** noiseReduction 0-100 → 最少同色邻居数（上限 3，避免吃掉细线） */
function noiseToMinNeighbors(noiseReduction: number): number {
  if (noiseReduction <= 0) return 0;
  if (noiseReduction < 25) return 1;
  if (noiseReduction < 55) return 2;
  return 3;
}

/**
 * 掩码去噪：删除同色 8-邻域不足 minNeighbors 的像素。
 * minNeighbors=0 保留全部；=1 删孤立点；更高则做更强形态学开运算效果。
 */
function denoiseMask(
  mask: Uint8Array,
  width: number,
  height: number,
  minNeighbors: number = 1
): { mask: Uint8Array; count: number } {
  if (minNeighbors <= 0) {
    let count = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) count++;
    return { mask, count };
  }

  const out = new Uint8Array(mask.length);
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] !== 1) continue;
      let nbs = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (mask[ny * width + nx] === 1) nbs++;
        }
      }
      if (nbs >= minNeighbors) { out[i] = 1; count++; }
    }
  }
  return { mask: out, count };
}

// ── 连通组件分析 ──────────────────────────────────────

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
  minPx: number = 30,
  keepWhite: boolean = false
): ComponentLayer[] {
  const result: ComponentLayer[] = [];
  const totalPx = width * height;

  for (const layer of layers) {
    const [r, g, b] = layer.color;
    // 纯白跳过 —— 仅当没有背景掩码时（此时白色大概率是底色）；
    // 背景已被 flood 掩码移除的图，剩余白色是主体内容，必须保留
    if (!keepWhite && r > 250 && g > 250 && b > 250) continue;

    const isNearGray = Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && Math.abs(r - b) < 14;
    const lum = (r + g + b) / 3;
    // 只跳过「大面积浅灰底」，保留浅米色描边/贴纸外框（面积通常 < 12%）
    if (!keepWhite && isNearGray && lum > 200 && chroma(layer.color) < 18 && layer.pixelCount > totalPx * 0.12) {
      continue;
    }

    // 高饱和小色 / 浅色描边：降低连通域门槛
    const isLightAccent = lum > 185 && layer.pixelCount < totalPx * 0.1;
    const layerMin = chroma(layer.color) >= 40 || isLightAccent
      ? Math.max(4, Math.floor(minPx * 0.3))
      : minPx;

    const comps = connectedComponents(layer.mask, width, height, layerMin);
    if (comps.length === 0) continue;

    // 浅色描边：合并所有连通域；碎斑层：丢弃过小碎片
    const merged = new Uint8Array(layer.mask.length);
    let totalPc = 0;
    const keepTiny = chroma(layer.color) >= 35 || isLightAccent;
    for (const comp of comps) {
      let size = 0;
      for (let i = 0; i < comp.length; i++) if (comp[i] === 1) size++;
      // 非强调色的超碎连通域丢掉，减少残缺小色块
      if (!keepTiny && size < Math.max(layerMin, 20)) continue;
      for (let i = 0; i < comp.length; i++) {
        if (comp[i] === 1) { merged[i] = 1; totalPc++; }
      }
    }
    if (totalPc === 0) continue;

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
