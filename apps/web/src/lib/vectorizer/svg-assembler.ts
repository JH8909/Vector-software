/**
 * SVG 图层组装器
 *
 * 输入：ComponentLayer[]（连通组件拆层后的结果）
 * 输出：分层 SVG，每层用 <g id="layer_NNN_name"> 包装
 */

export interface LayerRecord {
  id: string;
  name: string;
  fill: string;
  visible: boolean;
  paths: string[];           // SVG path 标签数组
  pixelCount: number;
  type: string;              // "background" | "subject" | "detail"
}

/**
 * 构建分层 SVG 字符串
 */
export function buildLayeredSVG(
  layers: LayerRecord[],
  width: number,
  height: number,
): string {
  const groups = layers
    .filter(l => l.paths.length > 0)
    .map(l => {
      const style = l.visible ? '' : ' style="display:none"';
      const paths = l.paths.join('\n    ');
      return `  <g id="${l.id}" data-name="${l.name}" data-type="${l.type}"${style}>\n    ${paths}\n  </g>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${groups}\n</svg>`;
}

/**
 * 扁平化：去掉 <g>，仅保留所有 path
 */
export function flattenSVG(svg: string): string {
  const paths: string[] = [];
  const re = /<path[^>]*\/>/g;
  let m;
  while ((m = re.exec(svg)) !== null) paths.push(m[0]);
  // 提取 viewBox
  const vb = svg.match(/viewBox="[^"]*"/)?.[0] || 'viewBox="0 0 100 100"';
  const dim = svg.match(/width="[^"]*"\s+height="[^"]*"/)?.[0] || 'width="100" height="100"';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${dim} ${vb}>\n  ${paths.join('\n  ')}\n</svg>`;
}
