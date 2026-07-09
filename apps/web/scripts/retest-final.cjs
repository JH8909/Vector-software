const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { Potrace } = require('potrace');

const IN = 'D:/test';
const OUT = path.join(process.cwd(), '../../samples/test-out');
fs.mkdirSync(OUT, { recursive: true });

function deltaE(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2], rMean = (a[0] + b[0]) / 2;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}
function chroma(c) { return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]); }
function toHex(r, g, b) { const h = n => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0'); return `#${h(r)}${h(g)}${h(b)}`; }
function avgVec(v) { let r = 0, g = 0, b = 0; for (const p of v) { r += p[0]; g += p[1]; b += p[2]; } const n = Math.max(1, v.length); return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]; }
function medianCut(pixels, maxColors) {
  if (!pixels.length || maxColors <= 1) return [avgVec(pixels)];
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (const [r, g, b] of pixels) { if (r < minR) minR = r; if (r > maxR) maxR = r; if (g < minG) minG = g; if (g > maxG) maxG = g; if (b < minB) minB = b; if (b > maxB) maxB = b; }
  const c = maxR - minR >= maxG - minG && maxR - minR >= maxB - minB ? 0 : maxG - minG >= maxB - minB ? 1 : 2;
  pixels.sort((a, b) => a[c] - b[c]); const mid = Math.floor(pixels.length / 2);
  return [...medianCut(pixels.slice(0, mid), Math.ceil(maxColors / 2)), ...medianCut(pixels.slice(mid), Math.floor(maxColors / 2))];
}
function extractVividSeeds(pixels, maxSeeds) {
  const buckets = new Map();
  for (const p of pixels) {
    if (chroma(p) < 24) continue;
    const key = `${p[0] >> 4},${p[1] >> 4},${p[2] >> 4}`;
    const b = buckets.get(key);
    if (b) { b.n++; b.c[0] += p[0]; b.c[1] += p[1]; b.c[2] += p[2]; }
    else buckets.set(key, { c: [p[0], p[1], p[2]], n: 1 });
  }
  const list = [...buckets.values()].map(b => {
    const c = [Math.round(b.c[0] / b.n), Math.round(b.c[1] / b.n), Math.round(b.c[2] / b.n)];
    let hueBias = 0; const [r,g,bl] = c; if (g > r + 20 && g > bl + 15) hueBias = 18; else if (r > g + 25 && r > bl + 10 && bl > g) hueBias = 16; else if (r > g + 30 && r > bl + 30) hueBias = 12;
    return { c, n: b.n, ch: chroma(c), hueBias };
  }).filter(x => x.n >= 1 && x.ch >= 24).sort((a, b) => (b.ch + b.hueBias) - (a.ch + a.hueBias) || b.n - a.n);
  const seeds = [];
  for (const item of list) { if (seeds.length >= maxSeeds) break; if (seeds.some(s => deltaE(s, item.c) < 20)) continue; seeds.push(item.c); }
  return seeds;
}
function pickPalette(candidates, pixels, limit) {
  const counts = candidates.map(() => 0);
  for (const px of pixels) { let md = Infinity, best = 0; for (let j = 0; j < candidates.length; j++) { const d = deltaE(px, candidates[j]); if (d < md) { md = d; best = j; } } counts[best]++; }
  const ranked = candidates.map((c, i) => ({ c, n: counts[i], ch: chroma(c) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n || b.ch - a.ch);
  const threshold = limit <= 2 ? 30 : limit <= 4 ? 24 : 20; const selected = [];
  for (const item of ranked) { if (selected.length >= limit) break; if (selected.some(s => deltaE(item.c, s) < threshold)) continue; selected.push(item.c); }
  const vivid = [...ranked].filter(x => x.ch >= 28).sort((a, b) => b.ch - a.ch || b.n - a.n);
  for (const item of vivid) {
    if (selected.length >= limit) { const replaceIdx = selected.findIndex(s => chroma(s) < 18 && (s[0]+s[1]+s[2])/3 > 180); if (replaceIdx < 0) break; if (selected.some(s => deltaE(item.c, s) < threshold * 0.75)) continue; if (item.n < Math.max(2, pixels.length * 0.00015)) continue; selected[replaceIdx] = item.c; continue; }
    if (selected.some(s => deltaE(item.c, s) < threshold * 0.75)) continue; if (item.n < Math.max(2, pixels.length * 0.00015)) continue; selected.push(item.c);
  }
  return selected.length ? selected.slice(0, limit) : [ranked[0]?.c || [0, 0, 0]];
}
function pickDom(pxs) {
  const buckets = new Map();
  for (const p of pxs) { const key = `${p[0] >> 3},${p[1] >> 3},${p[2] >> 3}`; const b = buckets.get(key); if (b) b.n++; else buckets.set(key, { c: p, n: 1 }); }
  let bg = [255, 255, 255], bgN = 0;
  for (const { c, n } of buckets.values()) { const lum = (c[0] + c[1] + c[2]) / 3; if (lum > 200 && n > bgN) { bgN = n; bg = c; } }
  let best = pxs[0], bestScore = -1;
  for (const { c, n } of buckets.values()) { const dist = deltaE(c, bg); if (dist < 25) continue; const score = n * (1 + dist / 40) * (1 + chroma(c) / 80); if (score > bestScore) { bestScore = score; best = c; } }
  if (bestScore < 0) { let darkest = pxs[0], minLum = 999; for (const p of pxs) { const lum = p[0] + p[1] + p[2]; if (lum < minLum) { minLum = lum; darkest = p; } } return darkest; }
  return best;
}
function guessBg(data, w, h) {
  const samples = [[], [], []];
  const push = i => { if (data[i + 3] < 200) return; samples[0].push(data[i]); samples[1].push(data[i + 1]); samples[2].push(data[i + 2]); };
  for (let x = 0; x < w; x++) { push(x << 2); push(((h - 1) * w + x) << 2); }
  for (let y = 0; y < h; y++) { push((y * w) << 2); push((y * w + w - 1) << 2); }
  const med = a => { if (!a.length) return 255; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return [med(samples[0]), med(samples[1]), med(samples[2])];
}
function softFringe(data, w, h) {
  const out = Buffer.from(data); const bg = guessBg(data, w, h);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]; if (a >= 245) continue;
    if (a < 10) { out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 0; continue; }
    const t = a / 255; const cr = Math.round(data[i] * t + bg[0] * (1 - t)), cg = Math.round(data[i + 1] * t + bg[1] * (1 - t)), cb = Math.round(data[i + 2] * t + bg[2] * (1 - t));
    if (Math.hypot(cr - bg[0], cg - bg[1], cb - bg[2]) < 18) { out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 0; } else { out[i] = cr; out[i + 1] = cg; out[i + 2] = cb; out[i + 3] = 255; }
  }
  return out;
}
function denoise(mask, w, h, minN) {
  if (minN <= 0) { let c = 0; for (const v of mask) if (v === 1) c++; return { mask, count: c }; }
  const out = new Uint8Array(mask.length); let count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (mask[i] !== 1) continue; let nbs = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; if (mask[ny * w + nx] === 1) nbs++; }
    if (nbs >= minN) { out[i] = 1; count++; }
  }
  return { mask: out, count };
}
function absorb(layers, w, h, totalPx) {
  if (layers.length <= 1) return layers;
  const result = [...layers].sort((a, b) => b.pixelCount - a.pixelCount).map(l => ({ ...l, mask: new Uint8Array(l.mask) }));
  const fringeMax = Math.max(totalPx * 0.015, 40);
  for (let i = result.length - 1; i >= 0; i--) {
    const layer = result[i]; if (layer.pixelCount <= 0 || layer.pixelCount > fringeMax) continue; if (chroma(layer.color) >= 35) continue;
    const dominant = result.find((l, idx) => idx !== i && l.pixelCount > totalPx * 0.12);
    const nearDominant = dominant && deltaE(layer.color, dominant.color) < 22;
    const touch = new Array(result.length).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const pi = y * w + x; if (layer.mask[pi] !== 1) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; const ni = ny * w + nx;
        for (let j = 0; j < result.length; j++) { if (j === i || result[j].pixelCount <= 0) continue; if (result[j].mask[ni] === 1) touch[j]++; }
      }
    }
    let bestJ = -1, bestTouch = 0; for (let j = 0; j < result.length; j++) if (j !== i && touch[j] > bestTouch) { bestTouch = touch[j]; bestJ = j; }
    const mostlyBoundary = bestTouch >= layer.pixelCount * 0.55; if (!(mostlyBoundary || nearDominant)) continue;
    const target = mostlyBoundary && bestJ >= 0 ? result[bestJ] : (dominant || (bestJ >= 0 ? result[bestJ] : null)); if (!target) continue;
    for (let p = 0; p < layer.mask.length; p++) if (layer.mask[p] === 1) { target.mask[p] = 1; layer.mask[p] = 0; }
    target.pixelCount += layer.pixelCount; layer.pixelCount = 0;
  }
  return result.filter(l => l.pixelCount > 0).map(l => ({ ...l, fill: toHex(...l.color) }));
}
function buildLayers(data, w, h, palette, noise) {
  const pc = w * h; const assign = new Uint8Array(pc); const accum = palette.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
  const bg = guessBg(data, w, h); const single = palette.length <= 1;
  for (let i = 0; i < pc; i++) {
    const qi = i << 2; if (data[qi + 3] < 10) { assign[i] = 255; continue; }
    const px = [data[qi], data[qi + 1], data[qi + 2]];
    if (single) { if (deltaE(px, bg) < 28) { assign[i] = 255; continue; } if (deltaE(px, palette[0]) > 55) { assign[i] = 255; continue; } assign[i] = 0; accum[0].r += px[0]; accum[0].g += px[1]; accum[0].b += px[2]; accum[0].count++; continue; }
    let md = Infinity, best = 0; for (let j = 0; j < palette.length; j++) { const d = deltaE(px, palette[j]); if (d < md) { md = d; best = j; } }
    assign[i] = best; accum[best].r += px[0]; accum[best].g += px[1]; accum[best].b += px[2]; accum[best].count++;
  }
  const pal = accum.map(a => a.count > 0 ? [Math.round(a.r / a.count), Math.round(a.g / a.count), Math.round(a.b / a.count)] : [0, 0, 0]);
  const layers = pal.map(color => ({ color, fill: toHex(...color), mask: new Uint8Array(pc), pixelCount: 0 }));
  for (let i = 0; i < pc; i++) {
    if (assign[i] === 255) continue; const qi = i << 2; const px = [data[qi], data[qi + 1], data[qi + 2]];
    if (single) { if (deltaE(px, bg) < 28) continue; if (deltaE(px, pal[0]) > 55) continue; layers[0].mask[i] = 1; layers[0].pixelCount++; continue; }
    let md = Infinity, best = 0; for (let j = 0; j < pal.length; j++) { if (!accum[j].count) continue; const d = deltaE(px, pal[j]); if (d < md) { md = d; best = j; } }
    layers[best].mask[i] = 1; layers[best].pixelCount++;
  }
  const minN = noise <= 0 ? 0 : noise < 25 ? 1 : noise < 55 ? 2 : 3;
  for (const l of layers) { const c = denoise(l.mask, w, h, minN); l.mask = c.mask; l.pixelCount = c.count; }
  return absorb(layers.filter(l => l.pixelCount >= Math.max(10, pc * 0.0005)), w, h, pc);
}
function cc(mask, w, h, minPx) {
  const visited = new Uint8Array(mask.length); const comps = []; const D = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1 || visited[i]) continue;
    const comp = new Uint8Array(mask.length); const q = new Uint32Array(mask.length); let head = 0, tail = 0; q[tail++] = i; visited[i] = 1;
    while (head < tail) { const ci = q[head++]; comp[ci] = 1; const cy = Math.floor(ci / w), cx = ci % w; for (const [dx, dy] of D) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; const ni = ny * w + nx; if (mask[ni] === 1 && !visited[ni]) { visited[ni] = 1; q[tail++] = ni; } } }
    if (tail >= minPx) comps.push(comp);
  }
  return comps;
}
function split(layers, w, h, minPx) {
  const result = []; const total = w * h;
  for (const layer of layers) {
    const [r, g, b] = layer.color; if (r > 245 && g > 245 && b > 245) continue;
    const isNearGray = Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && Math.abs(r - b) < 14;
    const isLight = (r + g + b) / 3 > 190;
    if (isNearGray && (r+g+b)/3 > 200 && chroma(layer.color) < 18 && layer.pixelCount > total * 0.12) continue;
    const layerMin = chroma(layer.color) >= 40 ? Math.max(6, Math.floor(minPx * 0.35)) : minPx;
    const comps = cc(layer.mask, w, h, layerMin); if (!comps.length) continue;
    const merged = new Uint8Array(layer.mask.length); let totalPc = 0;
    for (const c of comps) for (let i = 0; i < c.length; i++) if (c[i] === 1) { merged[i] = 1; totalPc++; }
    result.push({ color: layer.color, fill: layer.fill, mask: merged, pixelCount: totalPc });
  }
  return result.sort((a, b) => b.pixelCount - a.pixelCount);
}
function maskRgba(mask, w, h) { const buf = Buffer.alloc(w * h * 4); for (let i = 0; i < mask.length; i++) { const oi = i << 2; const v = mask[i] === 1 ? 0 : 255; buf[oi] = buf[oi + 1] = buf[oi + 2] = v; buf[oi + 3] = 255; } return buf; }
function dilate(rgba, w, h) {
  const out = Buffer.from(rgba);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) << 2; if (out[i] === 0) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (rgba[((ny * w + nx) << 2)] === 0) { out[i] = out[i + 1] = out[i + 2] = 0; out[i + 3] = 255; dx = dy = 2; }
    }
  }
  return out;
}
function trace(rgba, w, h, opts) {
  return new Promise((resolve, reject) => {
    try {
      const p = new Potrace({ turdSize: opts.turdSize ?? 2, alphaMax: opts.alphaMax ?? 0.8, optCurve: true, optTolerance: opts.optTolerance ?? 0.2, blackOnWhite: true, color: opts.color ?? '#000', background: 'transparent' });
      p._processLoadedImage({ bitmap: { width: w, height: h, data: rgba }, scan(x0, y0, ww, hh, f) { for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) f(x, y, (y * w + x) * 4); } });
      resolve(p.getSVG());
    } catch (e) { reject(e); }
  });
}
async function run(file, settings) {
  let img = await Jimp.read(path.join(IN, file));
  const srcW = img.bitmap.width, srcH = img.bitmap.height;
  if (Math.max(srcW, srcH) < 1500) { const r = 1500 / Math.max(srcW, srcH); img = img.resize(Math.round(srcW * r), Math.round(srcH * r), Jimp.RESIZE_BICUBIC); }
  const w = img.bitmap.width, h = img.bitmap.height; const data = softFringe(Buffer.from(img.bitmap.data), w, h);
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 60000))); const pixels = [];
  for (let i = 0; i < data.length; i += 4 * step) { if (data[i + 3] < 10) continue; pixels.push([data[i], data[i + 1], data[i + 2]]); }
  const n = Math.max(1, settings.colorCount);
  const oversized = medianCut(pixels.slice(), Math.min(64, Math.max(n * 3, n + 4)));
  const seeds = extractVividSeeds(pixels, 8);
  const palette = n <= 1 ? [pickDom(pixels)] : pickPalette([...oversized, ...seeds], pixels, n);
  let layers = buildLayers(data, w, h, palette, settings.noiseReduction ?? 18);
  if (n <= 1 && layers.length > 1) layers = [layers.reduce((a, b) => a.pixelCount >= b.pixelCount ? a : b)];
  let comps = split(layers, w, h, Math.max(12, (settings.minArea ?? 12) * 4));
  if (n <= 1 && comps.length > 1) comps = [comps.reduce((a, b) => a.pixelCount >= b.pixelCount ? a : b)];
  const groups = [];
  for (const comp of comps) {
    let rgba = maskRgba(comp.mask, w, h); if (comps.length >= 2) rgba = dilate(rgba, w, h);
    try {
      const svg = await trace(rgba, w, h, { turdSize: 1, alphaMax: 0.85, optTolerance: 0.22, color: comp.fill });
      const paths = [...svg.matchAll(/<path[^>]*\/>/g)].map(m => m[0]);
      if (paths.length) groups.push({ fill: comp.fill, paths, pixelCount: comp.pixelCount });
    } catch {}
  }
  const gXml = groups.map((g, i) => { const ds = g.paths.map(p => (p.match(/d="([^"]*)"/) || [])[1]).filter(Boolean).join(' '); return `  <g id="layer_${String(i + 1).padStart(3, '0')}"><path fill="${g.fill}" fill-rule="evenodd" d="${ds}"/></g>`; }).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${gXml}\n</svg>`;
  fs.writeFileSync(path.join(OUT, file.replace(/\.[^.]+$/, '') + '.svg'), svg);
  return { file, fills: groups.map(g => g.fill), layers: groups.length, seeds: seeds.map(s => toHex(...s)) };
}
(async () => {
  const cases = [
    ['1 (1).jpg', { colorCount: 2, noiseReduction: 18, minArea: 10 }],
    ['1 (2).jpg', { colorCount: 1, noiseReduction: 18, minArea: 8 }],
    ['22.jpg', { colorCount: 12, noiseReduction: 12, minArea: 6 }],
    ['221.jpg', { colorCount: 10, noiseReduction: 12, minArea: 6 }],
    ['1 (1).png', { colorCount: 4, noiseReduction: 15, minArea: 10 }],
  ];
  for (const [f, s] of cases) {
    const r = await run(f, s);
    console.log(JSON.stringify({ file: r.file, layers: r.layers, fills: r.fills.join('|'), seeds: r.seeds.slice(0, 4).join('|') }));
  }
})();