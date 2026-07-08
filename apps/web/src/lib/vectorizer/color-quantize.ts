/**
 * 颜色量化 — 强力过采样 + 全像素真实平均色
 *
 * 10× Median Cut → 采样频率去重 → Top-N → 全像素分配 → 真实平均色
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

// ── 量化：体素网格密度峰值 → 色板 ────────────────

const VSHIFT = 3;
const VSIZE  = 32;

export function quantizeColors(
  imageData: ImageData,
  targetCount: number
): [number, number, number][] {
  const { data, width, height } = imageData;
  const pc = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(pc / MAX_SAMPLE)));
  const samples: [number, number, number][] = [];

  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 10) continue;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (samples.length === 0) return [[0, 0, 0]];

  const total = VSIZE * VSIZE * VSIZE;
  const cnts = new Uint32Array(total);
  const rAcc = new Uint32Array(total);
  const gAcc = new Uint32Array(total);
  const bAcc = new Uint32Array(total);

  for (const [r, g, b] of samples) {
    const vr = r >> VSHIFT, vg = g >> VSHIFT, vb = b >> VSHIFT;
    const idx = (vr * VSIZE + vg) * VSIZE + vb;
    cnts[idx]++;
    rAcc[idx] += r; gAcc[idx] += g; bAcc[idx] += b;
  }

  // 收集所有有足够样本的体素 → 直接按频率取 Top-N
  const bins: { r: number; g: number; b: number; cnt: number }[] = [];
  for (let i = 0; i < total; i++) {
    if (cnts[i] < 1) continue;
    bins.push({
      r: Math.round(rAcc[i] / cnts[i]), g: Math.round(gAcc[i] / cnts[i]),
      b: Math.round(bAcc[i] / cnts[i]), cnt: cnts[i],
    });
  }
  bins.sort((a, b) => b.cnt - a.cnt);

  const palette: [number, number, number][] = [];
  const seen = new Set<string>();
  for (const b of bins) {
    if (palette.length >= targetCount) break;
    const k = `${b.r},${b.g},${b.b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    palette.push([b.r, b.g, b.b]);
  }
  if (palette.length === 0) return [[0, 0, 0]];
  return palette;
}

// ── 颜色层构建 ────────────────────────────────────────

export function buildColorLayers(
  imageData: ImageData,
  palette: [number, number, number][]
): ColorLayer[] {
  const { data, width, height } = imageData;
  const pc = width * height;

  const layers: ColorLayer[] = palette.map(color => ({
    color,
    fill: `rgb(${color[0]},${color[1]},${color[2]})`,
    mask: new Uint8Array(pc),
    pixelCount: 0,
  }));

  for (let i = 0; i < pc; i++) {
    const qi = i << 2;
    if (data[qi + 3] < 10) continue;
    const r = data[qi], g = data[qi + 1], b = data[qi + 2];
    let md = Infinity, best = 0;
    for (let j = 0; j < palette.length; j++) {
      const d = (r - palette[j][0]) ** 2 + (g - palette[j][1]) ** 2 + (b - palette[j][2]) ** 2;
      if (d < md) { md = d; best = j; }
    }
    layers[best].mask[i] = 1;
    layers[best].pixelCount++;
  }

  const minPx = Math.max(30, pc * 0.0008);
  return layers.filter(l => l.pixelCount >= minPx);
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
  minPx: number = 50
): ComponentLayer[] {
  const result: ComponentLayer[] = [];

  for (const layer of layers) {
    const [r, g, b] = layer.color;
    if (r > 240 && g > 240 && b > 240) continue;

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
      name: colorName(r, g, b),
    });
  }

  result.sort((a, b) => b.pixelCount - a.pixelCount);
  return result;
}

function colorName(r: number, g: number, b: number): string {
  if (r > 240 && g > 240 && b > 240) return 'white';
  if (r < 15 && g < 15 && b < 15) return 'black';
  const refs: [string, number, number, number][] = [
    ['red',255,0,0],['orange',255,140,0],['yellow',255,255,0],
    ['green',0,180,0],['cyan',0,200,200],['blue',0,0,255],
    ['purple',160,0,255],['pink',255,120,180],
    ['brown',140,70,20],['gray',128,128,128],
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
