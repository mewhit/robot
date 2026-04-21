declare module "pngjs" {
  import { Transform } from "stream";

  class PNG extends Transform {
    constructor(options?: { width?: number; height?: number; colorType?: number; bitDepth?: number; [key: string]: any });

    width: number;
    height: number;
    data: Uint8Array;

    pack(): PNG;
  }

  export { PNG };
}
