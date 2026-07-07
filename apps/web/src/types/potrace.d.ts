declare module 'potrace' {
  export class Potrace {
    static COLOR_AUTO: 'auto';
    static COLOR_TRANSPARENT: 'transparent';
    static THRESHOLD_AUTO: -1;
    static TURNPOLICY_BLACK: 'black';
    static TURNPOLICY_WHITE: 'white';
    static TURNPOLICY_LEFT: 'left';
    static TURNPOLICY_RIGHT: 'right';
    static TURNPOLICY_MINORITY: 'minority';
    static TURNPOLICY_MAJORITY: 'majority';

    constructor(options?: Partial<PotraceOptions>);
    loadImage(target: any, callback: (err: Error | null) => void): void;
    setParameters(params: Partial<PotraceOptions>): void;
    getSVG(): string;
    getPathTag(fillColor?: string): string;
    getSymbol(id: string): string;
  }

  export class Posterizer {
    static STEPS_AUTO: -1;
    static FILL_SPREAD: 'spread';
    static FILL_DOMINANT: 'dominant';
    static FILL_MEDIAN: 'median';
    static FILL_MEAN: 'mean';
    static RANGES_AUTO: 'auto';
    static RANGES_EQUAL: 'equal';

    constructor(options?: Partial<PosterizerOptions>);
    loadImage(target: any, callback: (err: Error | null) => void): void;
    setParameters(params: Partial<PosterizerOptions>): void;
    getSVG(): string;
  }

  export interface PotraceOptions {
    turnPolicy: string;
    turdSize: number;
    alphaMax: number;
    optCurve: boolean;
    optTolerance: number;
    threshold: number;
    blackOnWhite: boolean;
    color: string;
    background: string;
    width: number | null;
    height: number | null;
  }

  export interface PosterizerOptions {
    steps: number;
    threshold: number;
    blackOnWhite: boolean;
    background: string;
    fillStrategy: string;
    rangeDistribution: string;
    turdSize: number;
    alphaMax: number;
    optCurve: boolean;
    optTolerance: number;
  }

  export function trace(
    file: any,
    options: Partial<PotraceOptions>,
    cb: (err: Error | null, svg: string, instance: Potrace) => void
  ): void;

  export function posterize(
    file: any,
    options: Partial<PosterizerOptions>,
    cb: (err: Error | null, svg: string, instance: Posterizer) => void
  ): void;
}
