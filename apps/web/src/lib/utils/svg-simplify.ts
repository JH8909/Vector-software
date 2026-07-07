/**
 * SVG 路径简化工具
 *
 * 解析 SVG path d 属性 → 简化节点 → 重新序列化
 * 适用于 Potrace 输出的过度拟合路径，在保持视觉精度的前提下大幅减少节点数。
 */

interface Point {
  x: number;
  y: number;
}

type Command = {
  type: 'M' | 'L' | 'C' | 'Q' | 'Z';
  args: number[];
};

/** 解析 path d 字符串为命令数组 */
function parsePath(d: string): Command[] {
  const cmds: Command[] = [];
  // 匹配命令字母及后续数字
  const re = /([MLQCZ])\s*([-\d.,\s]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    const type = match[1].toUpperCase() as Command['type'];
    const args = (match[2] || '')
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (args.length > 0 || type === 'Z') {
      cmds.push({ type, args });
    }
  }
  return cmds;
}

/** 命令数组重新序列化为 d 字符串 */
function serializePath(cmds: Command[]): string {
  return cmds
    .map((c) => {
      if (c.type === 'Z') return 'Z';
      return c.type + c.args.map((n) => {
        const s = n.toFixed(2);
        return s.replace(/\.?0+$/, '');
      }).join(' ');
    })
    .join(' ');
}

/** 获取命令的终点坐标 */
function getEndPoint(cmd: Command, prev?: Point): Point {
  switch (cmd.type) {
    case 'M':
    case 'L':
      return { x: cmd.args[0], y: cmd.args[1] };
    case 'Q':
      return { x: cmd.args[2], y: cmd.args[3] };
    case 'C':
      return { x: cmd.args[4], y: cmd.args[5] };
    case 'Z':
      return prev || { x: 0, y: 0 };
    default:
      return prev || { x: 0, y: 0 };
  }
}

/** 两点间距离 */
function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 检查贝塞尔曲线是否近似直线
 * 将曲线在 t=0.5 处的点与直线中点的偏差作为判断依据
 */
function isCurveStraight(
  sx: number, sy: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  ex: number, ey: number,
  tolerance: number
): boolean {
  // 计算 t=0.5 时的曲线点
  const mx = 0.125 * sx + 0.375 * c1x + 0.375 * c2x + 0.125 * ex;
  const my = 0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ey;
  // 直线中点的 y 值
  const lx = (sx + ex) / 2;
  const ly = (sy + ey) / 2;
  // 偏差
  const dx = mx - lx;
  const dy = my - ly;
  return (dx * dx + dy * dy) < tolerance * tolerance;
}

/**
 * 简化单个路径
 * @param d         原始 path d 字符串
 * @param tolerance 简化容差（像素），越大越简化
 */
export function simplifyPath(d: string, tolerance = 0.5): string {
  const cmds = parsePath(d);
  if (cmds.length <= 2) return d;

  const simplified: Command[] = [];
  let prevPoint: Point = { x: 0, y: 0 };

  for (let i = 0; i < cmds.length; i++) {
    const cmd = cmds[i];

    switch (cmd.type) {
      case 'M': {
        simplified.push(cmd);
        prevPoint = { x: cmd.args[0], y: cmd.args[1] };
        break;
      }

      case 'L': {
        const end = { x: cmd.args[0], y: cmd.args[1] };
        // 移除几乎重合的点
        if (dist(end, prevPoint) > tolerance) {
          simplified.push(cmd);
          prevPoint = end;
        }
        break;
      }

      case 'C': {
        const [c1x, c1y, c2x, c2y, ex, ey] = cmd.args;
        const end = { x: ex, y: ey };

        // 如果曲线近似直线且端点足够近，简化为 L
        if (
          isCurveStraight(
            prevPoint.x, prevPoint.y,
            c1x, c1y, c2x, c2y, ex, ey,
            tolerance
          ) &&
          dist(end, prevPoint) > tolerance * 0.5
        ) {
          simplified.push({ type: 'L', args: [ex, ey] });
        } else {
          simplified.push(cmd);
        }
        prevPoint = end;
        break;
      }

      case 'Q': {
        const [qx, qy, ex, ey] = cmd.args;
        const end = { x: ex, y: ey };
        // Q 近似判断：检查中点
        const mx = 0.25 * prevPoint.x + 0.5 * qx + 0.25 * ex;
        const my = 0.25 * prevPoint.y + 0.5 * qy + 0.25 * ey;
        const lx = (prevPoint.x + ex) / 2;
        const ly = (prevPoint.y + ey) / 2;
        const dx = mx - lx;
        const dy = my - ly;
        if ((dx * dx + dy * dy) < tolerance * tolerance && dist(end, prevPoint) > tolerance * 0.5) {
          simplified.push({ type: 'L', args: [ex, ey] });
        } else {
          simplified.push(cmd);
        }
        prevPoint = end;
        break;
      }

      case 'Z': {
        simplified.push(cmd);
        break;
      }
    }
  }

  return serializePath(simplified);
}

/**
 * 对整个 SVG 字符串进行路径简化
 */
export function simplifySVGPaths(svg: string, tolerance = 0.8): string {
  return svg.replace(/d="([^"]*)"/g, (_, d: string) => {
    const simplified = simplifyPath(d, tolerance);
    return `d="${simplified}"`;
  });
}

/**
 * 清理 SVG 中不必要的属性和空白
 */
export function minifySVG(svg: string): string {
  return svg
    // 移除注释
    .replace(/<!--[\s\S]*?-->/g, '')
    // 合并多余空白
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\n/g, '')
    // 移除可省属性
    .replace(/ version="1\.1"/g, '')
    // 修剪
    .trim();
}

/**
 * 从 SVG 中移除面积过小的路径
 * 基于路径字符串长度近似估计（精确面积计算开销大）
 */
export function removeTinyPaths(svg: string, minLength = 20): string {
  // 提取所有 path 标签
  return svg.replace(/<path[^>]*\/>/g, (match) => {
    // 如果 d 属性太短，说明路径很小
    const dMatch = match.match(/d="([^"]*)"/);
    if (dMatch && dMatch[1].length < minLength) {
      return '';
    }
    return match;
  });
}

/**
 * 完整 SVG 后处理管线
 */
export function optimizeSVGOutput(svg: string, options?: {
  simplifyTolerance?: number;
  minPathLength?: number;
  minify?: boolean;
}): string {
  const { simplifyTolerance = 0.8, minPathLength = 15, minify = true } = options || {};
  let result = svg;

  // 1. 简化路径
  result = simplifySVGPaths(result, simplifyTolerance);

  // 2. 移除小路径
  result = removeTinyPaths(result, minPathLength);

  // 3. 压缩
  if (minify) {
    result = minifySVG(result);
  }

  return result;
}
