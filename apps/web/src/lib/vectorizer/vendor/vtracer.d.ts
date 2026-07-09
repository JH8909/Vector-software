declare module './vendor/vtracer_webapp.js' {
  export class ColorImageConverter {
    static new_with_string(params: string): ColorImageConverter;
    init(): void;
    tick(): boolean;
    progress(): number;
    free(): void;
  }
  export class BinaryImageConverter {
    static new_with_string(params: string): BinaryImageConverter;
    init(): void;
    tick(): boolean;
    progress(): number;
    free(): void;
  }
  export default function init(moduleOrPath?: string | URL): Promise<unknown>;
}
