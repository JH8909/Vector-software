/**
 * VTracer Web Worker — SVG 解析 offload
 * （ColorImageConverter 需 DOM canvas，在主线程 vtracer-client 运行）
 */

import { parseVTracerSvgPayload } from './vtracer-svg-parse';

export type VTracerWorkerRequest =
  | { type: 'parse'; svg: string; width: number; height: number; totalPx: number; maxColors?: number };

export type VTracerWorkerResponse =
  | { records: ReturnType<typeof parseVTracerSvgPayload> }
  | { error: string };

self.onmessage = (ev: MessageEvent<VTracerWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'parse') return;
  try {
    const records = parseVTracerSvgPayload(msg.svg, msg.width, msg.height, msg.totalPx, msg.maxColors);
    const response: VTracerWorkerResponse = { records };
    self.postMessage(response);
  } catch (err) {
    const response: VTracerWorkerResponse = {
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
