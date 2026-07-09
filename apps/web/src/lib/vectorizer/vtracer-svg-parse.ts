/**
 * 将 VTracer 输出的 SVG 解析为 LayerRecord（按 fill 分组）
 */

import { LayerRecord } from './svg-assembler';

function ensureHex(fill: string): string {
  const t = fill.trim();
  if (t.startsWith('#')) return t.toLowerCase();
  const m = t.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (m) {
    const h = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  return t;
}

function resolveFill(el: Element): string | null {
  let node: Element | null = el;
  while (node) {
    const attr = node.getAttribute('fill');
    if (attr && attr !== 'none' && attr !== 'transparent') return ensureHex(attr);
    const style = node.getAttribute('style') || '';
    const m = style.match(/fill:\s*([^;]+)/i);
    if (m && m[1].trim() !== 'none') return ensureHex(m[1].trim());
    node = node.parentElement;
  }
  return null;
}

function pathToTag(path: Element, fill: string): string {
  const d = path.getAttribute('d') || '';
  if (!d.trim()) return '';
  const hex = ensureHex(fill);
  return `<path fill="${hex}" fill-rule="evenodd" d="${d}"/>`;
}

function approximateName(r: number, g: number, b: number): string {
  if (r > 240 && g > 240 && b > 240) return 'white';
  if (r < 15 && g < 15 && b < 15) return 'black';
  const refs: [string, number, number, number][] = [
    ['red', 255, 0, 0], ['green', 0, 180, 0], ['blue', 0, 0, 255],
    ['yellow', 255, 255, 0], ['orange', 255, 140, 0], ['pink', 255, 120, 180],
    ['purple', 160, 0, 255], ['brown', 140, 70, 20], ['gray', 128, 128, 128],
  ];
  let md = Infinity, best = 'color';
  for (const [n, cr, cg, cb] of refs) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < md) { md = d; best = n; }
  }
  return best;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  const rMean = (a[0] + b[0]) / 2;
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr +
    4 * dg * dg +
    (2 + (255 - rMean) / 256) * db * db
  );
}

function mergeSimilarFills(fills: string[], threshold = 32): Map<string, string> {
  const canonical = new Map<string, string>();
  const reps: { fill: string; rgb: [number, number, number] }[] = [];
  for (const fill of fills) {
    const rgb = hexToRgb(fill);
    let matched = reps.find(r => deltaE(r.rgb, rgb) < threshold);
    if (!matched) {
      matched = { fill, rgb };
      reps.push(matched);
    }
    canonical.set(fill, matched.fill);
  }
  return canonical;
}

function consolidateToMaxColors(records: LayerRecord[], maxColors: number): LayerRecord[] {
  if (maxColors <= 0 || records.length <= maxColors) return records;
  const sorted = [...records].sort((a, b) => b.paths.length - a.paths.length);
  const keep = sorted.slice(0, maxColors);
  const drop = sorted.slice(maxColors);
  for (const small of drop) {
    const smallRgb = hexToRgb(small.fill);
    let best = keep[0];
    let bestD = Infinity;
    for (const candidate of keep) {
      const d = deltaE(smallRgb, hexToRgb(candidate.fill));
      if (d < bestD) { bestD = d; best = candidate; }
    }
    const mergedPaths = small.paths.map(p => p.replace(/fill="[^"]+"/i, `fill="${best.fill}"`));
    best.paths.push(...mergedPaths);
    best.pixelCount += small.pixelCount;
  }
  return keep
    .sort((a, b) => b.paths.length - a.paths.length)
    .map((rec, i) => ({
      ...rec,
      id: `layer_${String(i + 1).padStart(3, '0')}`,
      type: i === 0 && rec.paths.length > keep.length ? 'background' as const : rec.type,
    }));
}

function extractPathsFromDom(svgString: string): { fill: string; tag: string }[] {
  const out: { fill: string; tag: string }[] = [];
  if (typeof DOMParser === 'undefined') return out;

  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const paths = doc.querySelectorAll('path');
  paths.forEach((path) => {
    const fill = resolveFill(path);
    if (!fill) return;
    const tag = pathToTag(path, fill);
    if (tag) out.push({ fill, tag });
  });
  return out;
}

function extractPathsFromRegex(svgString: string): { fill: string; tag: string }[] {
  const out: { fill: string; tag: string }[] = [];
  const pathRe = /<path\b[^>]*(?:\/>|>)/gi;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(svgString)) !== null) {
    let tag = m[0];
    if (!tag.endsWith('/>')) tag = tag.replace(/>$/, '/>');
    if (!tag.includes('fill-rule=')) tag = tag.replace(/<path/i, '<path fill-rule="evenodd"');
    tag = tag.replace(/fill="rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)"/i, (_, r, g, b) => {
      const h = (n: string) => Number(n).toString(16).padStart(2, '0');
      return `fill="#${h(r)}${h(g)}${h(b)}"`;
    });
    const fillMatch = tag.match(/fill="([^"]+)"/i);
    if (!fillMatch) continue;
    out.push({ fill: ensureHex(fillMatch[1]), tag });
  }
  return out;
}

export function parseVTracerSvg(
  svgString: string,
  width: number,
  height: number,
  totalPx: number,
  maxColors?: number,
): LayerRecord[] {
  const extracted = extractPathsFromDom(svgString);
  const items = extracted.length > 0 ? extracted : extractPathsFromRegex(svgString);

  const rawByFill = new Map<string, string[]>();
  for (const { fill, tag } of items) {
    const list = rawByFill.get(fill) ?? [];
    list.push(tag);
    rawByFill.set(fill, list);
  }

  const allFills = [...rawByFill.keys()];
  const canonicalMap = mergeSimilarFills(allFills);
  const byFill = new Map<string, string[]>();
  for (const [fill, paths] of rawByFill) {
    const canon = canonicalMap.get(fill) ?? fill;
    const list = byFill.get(canon) ?? [];
    list.push(...paths);
    byFill.set(canon, list);
  }

  const sorted = [...byFill.entries()].sort((a, b) => b[1].length - a[1].length);
  const records: LayerRecord[] = [];
  const totalPaths = sorted.reduce((s, [, p]) => s + p.length, 0);

  for (let i = 0; i < sorted.length; i++) {
    const [fill, paths] = sorted[i];
    const [r, g, b] = hexToRgb(fill);
    records.push({
      id: `layer_${String(i + 1).padStart(3, '0')}`,
      name: approximateName(r, g, b),
      fill,
      visible: true,
      paths,
      pixelCount: Math.round(totalPx * (paths.length / Math.max(1, totalPaths))),
      type: 'subject',
    });
  }

  if (records.length > 0 && records[0].paths.length >= totalPaths * 0.4) {
    records[0].type = 'background';
  }

  return maxColors ? consolidateToMaxColors(records, maxColors) : records;
}

export function parseVTracerSvgPayload(
  svg: string,
  width: number,
  height: number,
  totalPx: number,
  maxColors?: number,
) {
  return parseVTracerSvg(svg, width, height, totalPx, maxColors);
}
