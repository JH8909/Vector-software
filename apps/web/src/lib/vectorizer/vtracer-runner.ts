/**
 * VTracer ColorImageConverter 分帧 tick 循环
 */

export interface VTracerConverter {
  init(): void;
  tick(): boolean;
  progress(): number;
  free(): void;
}

export interface RunConverterOptions {
  converter: VTracerConverter;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  frameBudgetMs?: number;
}

export function runConverterWithTicks(opts: RunConverterOptions): Promise<void> {
  const { converter, onProgress, signal, frameBudgetMs = 25 } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      try { converter.free(); } catch { /* ignore */ }
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    converter.init();

    const onAbort = () => {
      try { converter.free(); } catch { /* ignore */ }
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const tickFrame = () => {
      if (signal?.aborted) return;

      try {
        const start = performance.now();
        let done = false;
        while (!done && performance.now() - start < frameBudgetMs) {
          done = converter.tick();
        }
        onProgress?.(converter.progress());

        if (done) {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        } else {
          setTimeout(tickFrame, 0);
        }
      } catch (err) {
        try { converter.free(); } catch { /* ignore */ }
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      }
    };

    setTimeout(tickFrame, 0);
  });
}
