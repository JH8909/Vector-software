/**
 * SVG 图层组装器 — 印刷友好分层输出
 *
 * - 填充统一 #RRGGBB
 * - fill-rule="evenodd"（复合路径孔洞）
 * - 同色路径尽量合并为单 path
 */

export interface LayerRecord {
  id: string;
  name: string;
  fill: string;
  visible: boolean;
  paths: string[];
  pixelCount: number;
  type: string;
}

function ensureHex(fill: string): string {
  if (fill.startsWith('#')) return fill.toLowerCase();
  const m = fill.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (m) {
    const h = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
  }
  return fill;
}

/** 将同层多个 path 的 d 合并为一条 compound path */
function mergePathTags(paths: string[], fill: string): string {
  const hex = ensureHex(fill);
  const ds: string[] = [];
  for (const tag of paths) {
    const m = tag.match(/d="([^"]*)"/);
    if (m && m[1].trim()) ds.push(m[1].trim());
  }
  if (ds.length === 0) return '';
  if (ds.length === 1) {
    return `<path fill="${hex}" fill-rule="evenodd" d="${ds[0]}"/>`;
  }
  return `<path fill="${hex}" fill-rule="evenodd" d="${ds.join(' ')}"/>`;
}

export function buildLayeredSVG(
  layers: LayerRecord[],
  width: number,
  height: number,
): string {
  const groups = layers
    .filter(l => l.paths.length > 0)
    .map(l => {
      const style = l.visible ? '' : ' style="display:none"';
      const merged = mergePathTags(l.paths, l.fill);
      if (!merged) return '';
      return `  <g id="${l.id}" data-name="${l.name}" data-type="${l.type}"${style}>\n    ${merged}\n  </g>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${groups}\n</svg>`;
}

export function flattenSVG(svg: string): string {
  const paths: string[] = [];
  const re = /<path[^>]*\/>/g;
  let m;
  while ((m = re.exec(svg)) !== null) paths.push(m[0]);
  const vb = svg.match(/viewBox="[^"]*"/)?.[0] || 'viewBox="0 0 100 100"';
  const dim = svg.match(/width="[^"]*"\s+height="[^"]*"/)?.[0] || 'width="100" height="100"';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${dim} ${vb}>\n  ${paths.join('\n  ')}\n</svg>`;
}
