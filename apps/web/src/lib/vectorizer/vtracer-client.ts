/**
 * VTracer WASM 客户端
 *
 * VTracer 官方 WASM 依赖 DOM canvas/svg（getElementById），
 * 因此在主线程用分帧 tick 保持 UI 响应；SVG 解析可 offload 到 Worker。
 */

import { VectorSettings } from '@/types';
import { mapSettingsToVTracer } from './vtracer-config';
import { runConverterWithTicks, VTracerConverter } from './vtracer-runner';
import { parseVTracerSvgPayload } from './vtracer-svg-parse';
import { LayerRecord } from './svg-assembler';

const CANVAS_ID = 'vf-vtracer-canvas';
const SVG_ID = 'vf-vtracer-svg';
const WASM_PUBLIC = '/wasm/vtracer_webapp_bg.wasm';

type WasmModule = {
  default: (moduleOrPath?: string | URL) => Promise<unknown>;
  ColorImageConverter: {
    new_with_string(params: string): VTracerConverter;
  };
};

let wasmLoad: Promise<WasmModule> | null = null;
let domReady = false;

function ensureDomTargets(): void {
  if (typeof document === 'undefined') return;
  if (domReady) return;

  let canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;visibility:hidden';
    document.body.appendChild(canvas);
  }

  if (!document.getElementById(SVG_ID)) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('id', SVG_ID);
    el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;pointer-events:none;visibility:hidden';
    document.body.appendChild(el);
  }

  domReady = true;
}

function getSvgElement(): SVGSVGElement {
  const el = document.getElementById(SVG_ID);
  if (!el) throw new Error('VTracer SVG 元素未初始化');
  return el as unknown as SVGSVGElement;
}

function getCanvasElement(): HTMLCanvasElement {
  const el = document.getElementById(CANVAS_ID);
  if (!el || !(el instanceof HTMLCanvasElement)) throw new Error('VTracer canvas 元素未初始化');
  return el;
}

async function loadWasmModule(): Promise<WasmModule> {
  if (!wasmLoad) {
    wasmLoad = (async () => {
      try {
        const mod = (await import('./vendor/vtracer_webapp.js')) as WasmModule;
        await mod.default(WASM_PUBLIC);
        return mod;
      } catch (err) {
        wasmLoad = null;
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`VTracer WASM 加载失败：${msg}`);
      }
    })();
  }
  return wasmLoad;
}

function drawImageToCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  source?: HTMLImageElement,
  imageData?: ImageData,
): void {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 canvas 2d 上下文');
  if (source) {
    ctx.imageSmoothingEnabled = true;
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, width, height);
    return;
  }
  if (imageData) {
    ctx.putImageData(imageData, 0, 0);
    return;
  }
  throw new Error('缺少图片数据');
}

function clearSvgElement(svg: SVGSVGElement): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(svg.getAttribute('width') ?? '0'));
  svg.setAttribute('height', String(svg.getAttribute('height') ?? '0'));
}

export interface TraceWithVTracerResult {
  svg: string;
  layers: LayerRecord[];
}

export async function traceWithVTracer(
  imageData: ImageData,
  settings: VectorSettings,
  sourceImg?: HTMLImageElement,
  signal?: AbortSignal,
): Promise<TraceWithVTracerResult> {
  if (typeof document === 'undefined') {
    throw new Error('VTracer 需要在浏览器环境中运行');
  }

  ensureDomTargets();
  const mod = await loadWasmModule();

  const canvas = getCanvasElement();
  const svg = getSvgElement();

  drawImageToCanvas(canvas, imageData.width, imageData.height, sourceImg, imageData);
  clearSvgElement(svg);
  svg.setAttribute('width', String(imageData.width));
  svg.setAttribute('height', String(imageData.height));
  svg.setAttribute('viewBox', `0 0 ${imageData.width} ${imageData.height}`);

  const config = mapSettingsToVTracer(settings, CANVAS_ID, SVG_ID);
  const converter = mod.ColorImageConverter.new_with_string(JSON.stringify(config));

  try {
    await runConverterWithTicks({ converter, signal });
  } catch (err) {
    try { converter.free(); } catch { /* ignore */ }
    throw err;
  }

  const svgString = new XMLSerializer().serializeToString(svg);
  converter.free();

  const pathCount = (svgString.match(/<path\b/gi) || []).length;
  if (pathCount === 0) {
    throw new Error('VTracer 未生成任何路径（请刷新后重试）');
  }

  const totalPx = imageData.width * imageData.height;
  const layers = parseVTracerSvgPayload(
    svgString,
    imageData.width,
    imageData.height,
    totalPx,
    settings.colorCount,
  );

  if (layers.length === 0) {
    throw new Error('SVG 解析失败：未找到有效色层');
  }

  return { svg: svgString, layers };
}
