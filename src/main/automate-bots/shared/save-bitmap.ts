import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

export type BitmapLike = {
  width: number;
  height: number;
  byteWidth: number;
  bytesPerPixel: number;
  image: Buffer;
};

type BitmapCropBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function toPng(bitmap: BitmapLike): PNG {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const idx = (y * bitmap.width + x) * 4;
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;

      // robotjs = BGR format
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      // PNG = RGBA format
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }

  return png;
}

function ensureParentDirectory(filename: string): void {
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writePngToFile(png: PNG, filename: string): Promise<void> {
  ensureParentDirectory(filename);
  return new Promise((resolve, reject) => {
    png.pack().pipe(fs.createWriteStream(filename)).on("finish", resolve).on("error", reject);
  });
}

/**
 * Save bitmap as PNG file for debugging OCR preprocessing.
 * Converts robotjs BGR format to standard RGB PNG.
 */
export function saveBitmap(bitmap: BitmapLike, filename: string): void {
  void writePngToFile(toPng(bitmap), filename);
}

export function saveBitmapAsync(bitmap: BitmapLike, filename: string): Promise<void> {
  return writePngToFile(toPng(bitmap), filename);
}

export function cropBitmap(bitmap: BitmapLike, bounds: BitmapCropBounds): BitmapLike | null {
  const x0 = Math.max(0, Math.min(bitmap.width - 1, Math.floor(bounds.x)));
  const y0 = Math.max(0, Math.min(bitmap.height - 1, Math.floor(bounds.y)));
  const x1 = Math.max(x0, Math.min(bitmap.width - 1, Math.floor(bounds.x + bounds.width - 1)));
  const y1 = Math.max(y0, Math.min(bitmap.height - 1, Math.floor(bounds.y + bounds.height - 1)));
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  if (width <= 0 || height <= 0) {
    return null;
  }

  const cropped: BitmapLike = {
    width,
    height,
    byteWidth: width * bitmap.bytesPerPixel,
    bytesPerPixel: bitmap.bytesPerPixel,
    image: Buffer.alloc(width * height * bitmap.bytesPerPixel),
  };

  for (let row = 0; row < height; row += 1) {
    const sourceStart = (y0 + row) * bitmap.byteWidth + x0 * bitmap.bytesPerPixel;
    const sourceEnd = sourceStart + width * bitmap.bytesPerPixel;
    const targetStart = row * cropped.byteWidth;
    bitmap.image.copy(cropped.image, targetStart, sourceStart, sourceEnd);
  }

  return cropped;
}
