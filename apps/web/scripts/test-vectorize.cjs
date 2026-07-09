/**
 * Node 回归测试（jimp + potrace）
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { Potrace } = require('potrace');

const IN_DIR = path.resolve('E:/Claude/矢量软件/samples/test-run');
const OUT_DIR = path.resolve('E:/Claude/矢量软件/samples/test-out');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(IN_DIR, { recursive: true });

// ensure inputs
for (const f of fs.readdirSync('D:/test')) {
  if (/\.(png|jpe?g|webp)$/i.test(f)) {
    fs.copyFileSync(path.join('D:/test', f), path.join(IN_DIR, f));
  }
}

const MIN_PX = 1500;

function deltaE(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  const rMean = (a[0] + b[0]) / 2;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}
function avgVec(v) {
  let r = 0, g = 0, b = 0;
  for (const p of v) { r += p[0]; g += p[1]; b += p[2]; }
  const n = Math.max(1, v.length);
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}
function medianCut(pixels, maxColors) {
  if (pixels.length === 0 || maxColors <= 1) return [avgVec(pixels)];
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const [r, g, b] of pixels) {
    if (r < minR) minR = r; if (r > maxR) maxR = r;
    if (g < minG) minG = g; if (g > maxG) maxG = g;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }
  const c = maxR - minR >= maxG - minG && maxR - minR >= maxB - minB ? 0
    : maxG - minG >= maxB - minB ? 1 : 2;
  pixels.sort((a, b) => a[c] - b[c]);
  const mid = Math.floor(pixels.length / 2);
  return [...medianCut(pixels.slice(0, mid), Math.ceil(maxColors / 2)), ...medianCut(pixels.slice(mid), Math.floor(maxColors / 2))];
}
function mergeSimilar(palette, limit) {
  const seen = new Set(); const unique = [];
  for (const c of palette) { const k = c.join(','); if (!seen.has(k)) { seen.add(k); unique.push(c); } }
  if (!unique.length) return [[0, 0, 0]];
  if (unique.length === 1) return unique;
  const threshold = limit <= 1 ? 40 : limit <= 2 ? 32 : limit <= 4 ? 26 : 22;
  const selected = [unique[0]];
  for (let i = 1; i < unique.length; i++) {
    let tooClose = false;
    for (const s of selected) if (deltaE(unique[i], s) < threshold) { tooClose = true; break; }
    if (!tooClose) selected.push(unique[i]);
    if (selected.length >= limit) break;
  }
  return limit <= 1 ? [selected[0]] : selected.slice(0, limit);
}
function toHex(r, g, b) {
  const h = n => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function estimateColors(data, tolerance = 12) {
  const colors = new Set();
  const step = Math.max(1, Math.floor(Math.sqrt(data.length / 4 / 15000)));
  for (let i = 0; i < data.length; i += step * 4) {
    if (data[i + 3] < 10) continue;
    colors.add(`${Math.round(data[i] / tolerance) * tolerance},${Math.round(data[i + 1] / tolerance) * tolerance},${Math.round(data[i + 2] / tolerance) * tolerance}`);
  }
  return colors.size;
}

function softFringe(data, width, height) {
  const out = Buffer.from(data);
  const samples = [[], [], []];
  const push = (i) => { if (data[i + 3] < 200) return; samples[0].push(data[i]); samples[1].push(data[i + 1]); samples[2].push(data[i + 2]); };
  for (let x = 0; x < width; x++) { push((x) << 2); push(((height - 1) * width + x) << 2); }
  for (let y = 0; y < height; y++) { push((y * width) << 2); push((y * width + width - 1) << 2); }
  const med = (arr) => { if (!arr.length) return 255; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const bg = [med(samples[0]), med(samples[1]), med(samples[2])];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a >= 245) continue;
    if (a < 10) { out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 0; continue; }
    const t = a / 255;
    const cr = Math.round(data[i] * t + bg[0] * (1 - t));
    const cg = Math.round(data[i + 1] * t + bg[1] * (1 - t));
    const cb = Math.round(data[i + 2] * t + bg[2] * (1 - t));
    if (Math.hypot(cr - bg[0], cg - bg[1], cb - bg[2]) < 18) {
      out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 0;
    } else { out[i] = cr; out[i + 1] = cg; out[i + 2] = cb; out[i + 3] = 255; }
  }
  return out;
}

function quantizeColors(data, width, height, targetCount) {
  const totalPx = width * height;
  const step = Math.max(1, Math.floor(Math.sqrt(totalPx / 60000)));
  const pixels = [];
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 10) continue;
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pixels.length) return [[0, 0, 0]];
  return mergeSimilar(medianCut(pixels, Math.min(64, targetCount * 3)), targetCount);
}

function denoiseMask(mask, width, height, minNeighbors) {
  if (minNeighbors <= 0) { let c = 0; for (const v of mask) if (v === 1) c++; return { mask, count: c }; }
  const out = new Uint8Array(mask.length); let count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x; if (mask[i] !== 1) continue;
    let nbs = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (mask[ny * width + nx] === 1) nbs++;
    }
    if (nbs >= minNeighbors) { out[i] = 1; count++; }
  }
  return { mask: out, count };
}

function absorbFringe(layers, width, height, totalPx) {
  if (layers.length <= 1) return layers;
  const result = [...layers].sort((a, b) => b.pixelCount - a.pixelCount).map(l => ({ ...l, mask: new Uint8Array(l.mask) }));
  const fringeMax = Math.max(totalPx * 0.02, 60);
  for (let i = result.length - 1; i >= 0; i--) {
    const layer = result[i];
    if (layer.pixelCount <= 0 || layer.pixelCount > fringeMax) continue;
    const dominant = result.find((l, idx) => idx !== i && l.pixelCount > totalPx * 0.12);
    const nearDominant = dominant && deltaE(layer.color, dominant.color) < 28;
    const touch = new Array(result.length).fill(0);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const pi = y * width + x; if (layer.mask[pi] !== 1) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        for (let j = 0; j < result.length; j++) {
          if (j === i || result[j].pixelCount <= 0) continue;
          if (result[j].mask[ni] === 1) touch[j]++;
        }
      }
    }
    let bestJ = -1, bestTouch = 0;
    for (let j = 0; j < result.length; j++) if (j !== i && touch[j] > bestTouch) { bestTouch = touch[j]; bestJ = j; }
    const mostlyBoundary = bestTouch >= layer.pixelCount * 0.4;
    if (!(mostlyBoundary || nearDominant)) continue;
    const target = mostlyBoundary && bestJ >= 0 ? result[bestJ] : (dominant || (bestJ >= 0 ? result[bestJ] : null));
    if (!target) continue;
    for (let p = 0; p < layer.mask.length; p++) if (layer.mask[p] === 1) { target.mask[p] = 1; layer.mask[p] = 0; }
    target.pixelCount += layer.pixelCount; layer.pixelCount = 0;
  }
  return result.filter(l => l.pixelCount > 0).map(l => ({ ...l, fill: toHex(...l.color) }));
}

function buildColorLayers(data, width, height, samplePalette, noiseReduction) {
  const pc = width * height;
  const assign = new Uint8Array(pc);
  const accum = samplePalette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
  for (let i = 0; i < pc; i++) {
    const qi = i << 2;
    if (data[qi + 3] < 10) { assign[i] = 255; continue; }
    const px = [data[qi], data[qi + 1], data[qi + 2]];
    let md = Infinity, best = 0;
    for (let j = 0; j < samplePalette.length; j++) { const d = deltaE(px, samplePalette[j]); if (d < md) { md = d; best = j; } }
    assign[i] = best; accum[best].r += px[0]; accum[best].g += px[1]; accum[best].b += px[2]; accum[best].count++;
  }
  const palette = accum.map(a => a.count > 0 ? [Math.round(a.r / a.count), Math.round(a.g / a.count), Math.round(a.b / a.count)] : [0, 0, 0]);
  const layers = palette.map(color => ({ color, fill: toHex(...color), mask: new Uint8Array(pc), pixelCount: 0 }));
  for (let i = 0; i < pc; i++) {
    if (assign[i] === 255) continue;
    const qi = i << 2; const px = [data[qi], data[qi + 1], data[qi + 2]];
    let md = Infinity, best = 0;
    for (let j = 0; j < palette.length; j++) {
      if (!accum[j].count) continue;
      const d = deltaE(px, palette[j]); if (d < md) { md = d; best = j; }
    }
    layers[best].mask[i] = 1; layers[best].pixelCount++;
  }
  const minN = noiseReduction <= 0 ? 0 : noiseReduction < 25 ? 1 : noiseReduction < 55 ? 2 : 3;
  for (const layer of layers) { const c = denoiseMask(layer.mask, width, height, minN); layer.mask = c.mask; layer.pixelCount = c.count; }
  return absorbFringe(layers.filter(l => l.pixelCount >= Math.max(10, pc * 0.0005)), width, height, pc);
}

function connectedComponents(mask, width, height, minPx) {
  const visited = new Uint8Array(mask.length); const components = [];
  const DIRS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1 || visited[i]) continue;
    const comp = new Uint8Array(mask.length); const queue = new Uint32Array(mask.length);
    let head = 0, tail = 0; queue[tail++] = i; visited[i] = 1;
    while (head < tail) {
      const ci = queue[head++]; comp[ci] = 1;
      const cy = Math.floor(ci / width), cx = ci % width;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 1 && !visited[ni]) { visited[ni] = 1; queue[tail++] = ni; }
      }
    }
    if (tail >= minPx) components.push(comp);
  }
  return components;
}

function splitAndMerge(layers, width, height, minPx) {
  const result = [];
  for (const layer of layers) {
    const [r, g, b] = layer.color;
    if (r > 245 && g > 245 && b > 245) continue;
    const comps = connectedComponents(layer.mask, width, height, minPx);
    if (!comps.length) continue;
    const merged = new Uint8Array(layer.mask.length); let totalPc = 0;
    for (const comp of comps) for (let i = 0; i < comp.length; i++) if (comp[i] === 1) { merged[i] = 1; totalPc++; }
    result.push({ color: layer.color, fill: layer.fill, mask: merged, pixelCount: totalPc });
  }
  return result.sort((a, b) => b.pixelCount - a.pixelCount);
}

function maskToRgba(mask, width, height) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    const oi = i << 2; const v = mask[i] === 1 ? 0 : 255;
    buf[oi] = buf[oi + 1] = buf[oi + 2] = v; buf[oi + 3] = 255;
  }
  return buf;
}

function dilateRgba(maskRgba, width, height) {
  const out = Buffer.from(maskRgba);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) << 2;
    if (out[i] === 0) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (maskRgba[((ny * width + nx) << 2)] === 0) { out[i] = out[i + 1] = out[i + 2] = 0; out[i + 3] = 255; dx = dy = 2; }
    }
  }
  return out;
}

function tracePotrace(rgba, width, height, opts) {
  return new Promise((resolve, reject) => {
    try {
      const p = new Potrace({
        turdSize: opts.turdSize ?? 2, alphaMax: opts.alphaMax ?? 0.8, optCurve: true,
        optTolerance: opts.optTolerance ?? 0.2, blackOnWhite: true, color: opts.color ?? '#000', background: 'transparent',
      });
      const jimpLike = {
        bitmap: { width, height, data: rgba },
        scan(x0, y0, w, h, f) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) f(x, y, (y * width + x) * 4); },
      };
      p._processLoadedImage(jimpLike);
      resolve(p.getSVG());
    } catch (e) { reject(e); }
  });
}

function extractPaths(svg, fill) {
  const ps = [];
  for (const m of svg.matchAll(/<path[^>]*\/>/g)) {
    let tag = m[0];
    if (!tag.includes('fill=')) tag = tag.replace(/<path/, `<path fill="${fill}"`);
    if (!tag.includes('fill-rule=')) tag = tag.replace(/<path/, '<path fill-rule="evenodd"');
    ps.push(tag);
  }
  return ps;
}

async function loadImage(filePath) {
  let img = await Jimp.read(filePath);
  const srcW = img.bitmap.width, srcH = img.bitmap.height;
  if (Math.max(srcW, srcH) < MIN_PX) {
    const r = MIN_PX / Math.max(srcW, srcH);
    img = img.resize(Math.round(srcW * r), Math.round(srcH * r), Jimp.RESIZE_BICUBIC);
  }
  return { data: Buffer.from(img.bitmap.data), width: img.bitmap.width, height: img.bitmap.height, srcW, srcH };
}

async function vectorizeFile(filePath, settings) {
  const { data: raw, width, height, srcW, srcH } = await loadImage(filePath);
  const data = softFringe(raw, width, height);
  const est = estimateColors(data);
  const n = Math.max(1, Math.min(settings.colorCount ?? Math.min(est, 12), 16));
  const opts = {
    turdSize: Math.round((settings.noiseReduction ?? 18) / 100 * 10),
    alphaMax: Math.max(0.2, Math.min(1.2, 0.6 + ((settings.smoothness ?? 55) / 100) * 0.85 - ((settings.cornerPreservation ?? 50) / 100) * 0.4)),
    optTolerance: Math.max(0.08, 0.52 - ((settings.pathPrecision ?? 55) / 100) * 0.38),
  };
  const palette = quantizeColors(data, width, height, n);
  let layers = buildColorLayers(data, width, height, palette, settings.noiseReduction ?? 18);
  if (n <= 1 && layers.length > 1) layers = [layers.reduce((a, b) => a.pixelCount >= b.pixelCount ? a : b)];
  const minPx = Math.max(12, (settings.minArea ?? 12) * 4);
  let comps = splitAndMerge(layers, width, height, minPx);
  if (n <= 1 && comps.length > 1) comps = [comps.reduce((a, b) => a.pixelCount >= b.pixelCount ? a : b)];

  const groups = [];
  for (const comp of comps) {
    let rgba = maskToRgba(comp.mask, width, height);
    if (comps.length >= 2) rgba = dilateRgba(rgba, width, height);
    try {
      const svg = await tracePotrace(rgba, width, height, { ...opts, color: comp.fill, turdSize: Math.max(0, opts.turdSize - 1) });
      const paths = extractPaths(svg, comp.fill);
      if (paths.length) groups.push({ fill: comp.fill, paths, pixelCount: comp.pixelCount });
    } catch (e) { console.warn(' skip', comp.fill, e.message); }
  }

  const gXml = groups.map((g, i) => {
    const ds = g.paths.map(p => (p.match(/d="([^"]*)"/) || [])[1]).filter(Boolean).join(' ');
    return `  <g id="layer_${String(i + 1).padStart(3, '0')}"><path fill="${g.fill}" fill-rule="evenodd" d="${ds}"/></g>`;
  }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${gXml}\n</svg>`;
  return { svg, width, height, srcW, srcH, est, n, layers: groups.length, fills: groups.map(g => g.fill), pathCount: (svg.match(/<path/g) || []).length, bytes: svg.length };
}

async function main() {
  const files = fs.readdirSync(IN_DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  console.log('Files:', files.length);
  const report = [];
  for (const file of files) {
    const t0 = Date.now();
    try {
      const img = await Jimp.read(path.join(IN_DIR, file));
      const est = estimateColors(img.bitmap.data);
      const settings = est <= 4
        ? { colorCount: Math.max(1, Math.min(est, 2)), noiseReduction: 18, smoothness: 55, pathPrecision: 55, cornerPreservation: 50, minArea: 10 }
        : est <= 16
          ? { colorCount: Math.min(est, 8), noiseReduction: 18, smoothness: 55, pathPrecision: 55, cornerPreservation: 50, minArea: 12 }
          : { colorCount: 12, noiseReduction: 15, smoothness: 55, pathPrecision: 60, cornerPreservation: 45, minArea: 8 };
      const result = await vectorizeFile(path.join(IN_DIR, file), settings);
      const outName = file.replace(/\.[^.]+$/, '') + '.svg';
      fs.writeFileSync(path.join(OUT_DIR, outName), result.svg);
      // also rasterize preview via jimp? skip - write metrics
      const row = { file, src: `${result.srcW}x${result.srcH}`, used: `${result.width}x${result.height}`, est: result.est, req: result.n, layers: result.layers, fills: result.fills.join('|'), paths: result.pathCount, kb: Math.round(result.bytes / 1024), ms: Date.now() - t0 };
      report.push(row);
      console.log(JSON.stringify(row));
    } catch (e) {
      console.error('FAIL', file, e && e.stack ? e.stack : e);
      report.push({ file, error: String(e && e.message || e) });
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Done', OUT_DIR);
}
main();
