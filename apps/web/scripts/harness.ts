/**
 * 真实源码回归工具（Node 24 strip-types）
 * - legacy: vectorizeColorLegacy（median-cut + Potrace）
 * - vtracer: @neplex/vectorizer（与浏览器 VTracer 同源）
 */
// @ts-nocheck
import Jimp from 'jimp';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { vectorizeSync } from '@neplex/vectorizer';

(globalThis as any).ImageData = class {
  data: Uint8ClampedArray; width: number; height: number;
  constructor(a: any, b?: any, c?: any) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = c; }
  }
};

import { buildLayeredSVG } from '../src/lib/vectorizer/svg-assembler.ts';
import { optimizeSVGOutput } from '../src/lib/utils/svg-simplify.ts';
import { flattenFringeSoft, estimateColorCount, isHighContrastImage } from '../src/lib/utils/image.ts';
import { vectorizeColorLegacy } from '../src/lib/vectorizer/vectorize-legacy.ts';
import { resolveModeSettings } from '../src/lib/vectorizer/index-shared.ts';
import { mapSettingsToNeplexConfig } from '../src/lib/vectorizer/vtracer-config.ts';
import { parseVTracerSvgPayload } from '../src/lib/vectorizer/vtracer-svg-parse.ts';

const MODE_DEFAULTS: any = {
  line_art: { colorCount: 1, noiseReduction: 20, pathPrecision: 55, smoothness: 50, cornerPreservation: 65, minArea: 12 },
  logo_color: { colorCount: 6, noiseReduction: 18, pathPrecision: 55, smoothness: 55, cornerPreservation: 50, minArea: 12 },
  illustration_color: { colorCount: 12, noiseReduction: 15, pathPrecision: 60, smoothness: 55, cornerPreservation: 45, minArea: 8 },
  high_precision: { colorCount: 16, noiseReduction: 12, pathPrecision: 70, smoothness: 60, cornerPreservation: 40, minArea: 6 },
};

function parseArgs() {
  const args = process.argv.slice(2);
  let engine = 'vtracer';
  let file = '22.jpg';
  let forceColor: number | null = null;
  let inDir: string | null = null;
  for (const a of args) {
    if (a.startsWith('--engine=')) engine = a.split('=')[1];
    else if (a.startsWith('--in=')) inDir = a.split('=')[1];
    else if (a === '--legacy') engine = 'legacy';
    else if (a === '--vtracer') engine = 'vtracer';
    else if (/^\d+$/.test(a)) forceColor = parseInt(a, 10);
    else if (!a.startsWith('--')) file = a;
  }
  return { engine, file, forceColor, inDir };
}

const SCORE_BG = { r: 91, g: 91, b: 91 };

function weightedDeltaE(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  const rMean = (r1 + r2) / 2;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

/**
 * 质量评分：SVG 渲染回位图，与源图逐像素对比。
 * 双方都合成到白底上（背景移除是有意行为，不应计为误差）。
 * meanDeltaE 越低越好；badPct 为色差 > 40 的像素占比。
 */
async function scoreOutput(svg: string, img: any, w: number, h: number) {
  const WHITE = { r: 255, g: 255, b: 255 };
  const rendered = await sharp(Buffer.from(svg), { density: 96 })
    .resize(w, h, { fit: 'fill' })
    .flatten({ background: WHITE })
    .removeAlpha()
    .raw()
    .toBuffer();
  const src = img.bitmap.data;
  let sum = 0, bad = 0, n = 0;
  for (let p = 0; p < w * h; p++) {
    const qi = p * 4;
    const a = src[qi + 3] / 255;
    const sr = src[qi] * a + WHITE.r * (1 - a);
    const sg = src[qi + 1] * a + WHITE.g * (1 - a);
    const sb = src[qi + 2] * a + WHITE.b * (1 - a);
    const ri = p * 3;
    const d = weightedDeltaE(sr, sg, sb, rendered[ri], rendered[ri + 1], rendered[ri + 2]);
    sum += d;
    if (d > 40) bad++;
    n++;
  }
  return {
    meanDeltaE: Math.round((sum / Math.max(1, n)) * 100) / 100,
    badPct: Math.round((bad / Math.max(1, n)) * 10000) / 100,
  };
}

async function vectorizeVtracerNode(imageData: any, settings: any, w: number, h: number, img: any) {
  const resolved = resolveModeSettings(settings);
  const config = mapSettingsToNeplexConfig(resolved);
  const pngBuf = await img.getBufferAsync((Jimp as any).MIME_PNG);
  const rawSvg = vectorizeSync(pngBuf, config);
  const totalPx = w * h;
  const records = parseVTracerSvgPayload(rawSvg, w, h, totalPx, resolved.colorCount);
  let layeredSvg = buildLayeredSVG(records, w, h);
  const pf = resolved.pathPrecision / 100;
  const nf = resolved.noiseReduction / 100;
  const simplifyTolerance = Math.max(0.15, 0.55 - pf * 0.35);
  const minPathLength = Math.max(14, Math.round(resolved.minArea * 0.9));
  const minSubpathArea = Math.max(8, resolved.minArea * 1.2, totalPx * 0.00002 * (0.5 + nf));
  layeredSvg = optimizeSVGOutput(layeredSvg, { simplifyTolerance, minPathLength, minSubpathArea, minify: false });
  return { svg: layeredSvg, fills: records.map(r => r.fill), layers: records.length, pixelCounts: records.map(r => r.pixelCount) };
}

async function vectorizeLegacyNode(imageData: any, settings: any, w: number, h: number) {
  const resolved = resolveModeSettings(settings);
  const flat = resolved.useSoftFringe ? flattenFringeSoft(imageData) : imageData;
  const records = await vectorizeColorLegacy(flat, resolved, w, h);
  let layeredSvg = buildLayeredSVG(records, w, h);
  const pf = resolved.pathPrecision / 100;
  const nf = resolved.noiseReduction / 100;
  const totalPx = w * h;
  const simplifyTolerance = Math.max(0.2, 0.85 - pf * 0.7);
  const minPathLength = Math.max(14, Math.round(resolved.minArea * 0.9));
  const minSubpathArea = Math.max(12, resolved.minArea * 1.5, totalPx * 0.00003 * (0.5 + nf));
  layeredSvg = optimizeSVGOutput(layeredSvg, { simplifyTolerance, minPathLength, minSubpathArea, minify: false });
  return { svg: layeredSvg, fills: records.map(r => r.fill), layers: records.length, pixelCounts: records.map(r => r.pixelCount) };
}

async function main() {
  const { engine, file, forceColor, inDir } = parseArgs();
  const IN = inDir ?? path.resolve('E:/Claude/矢量软件/samples/test-run');
  const OUT = path.resolve('E:/Claude/矢量软件/samples/test-out');
  fs.mkdirSync(OUT, { recursive: true });

  let img = await Jimp.read(path.join(IN, file));
  const srcW = img.bitmap.width, srcH = img.bitmap.height;
  const MIN_PX = 1500;
  if (Math.max(srcW, srcH) < MIN_PX) {
    const r = MIN_PX / Math.max(srcW, srcH);
    img = img.resize(Math.round(srcW * r), Math.round(srcH * r), (Jimp as any).RESIZE_BICUBIC);
  }
  const w = img.bitmap.width, h = img.bitmap.height;
  const imageData = new (globalThis as any).ImageData(new Uint8ClampedArray(img.bitmap.data), w, h);

  const cc = estimateColorCount(imageData);
  const hc = isHighContrastImage(imageData);
  let mode = 'illustration_color';
  if (hc && cc <= 4) mode = 'line_art';
  else if (cc <= 12) mode = 'logo_color';
  else if (cc <= 30) mode = 'illustration_color';
  else mode = 'high_precision';
  const colorCount = forceColor ?? (mode === 'line_art' ? 1 : Math.min(Math.max(1, cc), mode === 'logo_color' ? 8 : 16));
  const settings = { ...MODE_DEFAULTS[mode], mode, colorCount };

  const t0 = Date.now();
  const res = engine === 'legacy'
    ? await vectorizeLegacyNode(imageData, settings, w, h)
    : await vectorizeVtracerNode(imageData, settings, w, h, img);

  const base = file.replace(/\.[^.]+$/, '');
  const suffix = engine === 'legacy' ? '-legacy' : '-vtracer';
  const svgPath = path.join(OUT, base + suffix + '.svg');
  fs.writeFileSync(svgPath, res.svg);

  const pngPath = path.join(OUT, base + suffix + '.png');
  await sharp(Buffer.from(res.svg)).flatten({ background: SCORE_BG }).png().toFile(pngPath);

  const score = await scoreOutput(res.svg, img, w, h);

  console.log(JSON.stringify({
    engine, file, src: `${srcW}x${srcH}`, used: `${w}x${h}`, cc, hc, mode, colorCount,
    layers: res.layers, fills: res.fills.join('|'),
    pixelCounts: res.pixelCounts, kb: Math.round(res.svg.length / 1024), ms: Date.now() - t0,
    ...score,
    svg: svgPath, png: pngPath,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
