import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { RobotBitmap } from "./ocr-engine";

export type MagentaObjectDetection = {
  centerX: number;
  centerY: number;
  pixelCount: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const MIN_PIXELS_DEFAULT = 120;

function isStrictMagentaPixel(r: number, g: number, b: number): boolean {
  return r >= 231 && g <= 40 && b >= 231;
}

export function detectLargestMagentaObject(bitmap: RobotBitmap, minPixels: number = MIN_PIXELS_DEFAULT): MagentaObjectDetection | null {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Uint8Array(width * height);

  let best: MagentaObjectDetection | null = null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIdx = y * width + x;
      if (visited[startIdx] === 1) {
        continue;
      }

      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      visited[startIdx] = 1;

      if (!isStrictMagentaPixel(r, g, b)) {
        continue;
      }

      const queue: Array<{ x: number; y: number }> = [{ x, y }];

      let pixelCount = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (queue.length > 0) {
        const current = queue.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        if (current.x < minX) minX = current.x;
        if (current.x > maxX) maxX = current.x;
        if (current.y < minY) minY = current.y;
        if (current.y > maxY) maxY = current.y;

        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
        ];

        for (const n of neighbors) {
          if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) {
            continue;
          }

          const nIdx = n.y * width + n.x;
          if (visited[nIdx] === 1) {
            continue;
          }

          visited[nIdx] = 1;
          const nOffset = n.y * bitmap.byteWidth + n.x * bitmap.bytesPerPixel;
          const nb = bitmap.image[nOffset];
          const ng = bitmap.image[nOffset + 1];
          const nr = bitmap.image[nOffset + 2];

          if (isStrictMagentaPixel(nr, ng, nb)) {
            queue.push(n);
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      const candidate: MagentaObjectDetection = {
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        minX,
        minY,
        maxX,
        maxY,
      };

      if (!best || candidate.pixelCount > best.pixelCount) {
        best = candidate;
      }
    }
  }

  return best;
}

export function detectAllMagentaObjects(bitmap: RobotBitmap, minPixels: number = MIN_PIXELS_DEFAULT): MagentaObjectDetection[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Uint8Array(width * height);
  const results: MagentaObjectDetection[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIdx = y * width + x;
      if (visited[startIdx] === 1) {
        continue;
      }

      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      visited[startIdx] = 1;

      if (!isStrictMagentaPixel(r, g, b)) {
        continue;
      }

      const queue: Array<{ x: number; y: number }> = [{ x, y }];

      let pixelCount = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (queue.length > 0) {
        const current = queue.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        if (current.x < minX) minX = current.x;
        if (current.x > maxX) maxX = current.x;
        if (current.y < minY) minY = current.y;
        if (current.y > maxY) maxY = current.y;

        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
        ];

        for (const n of neighbors) {
          if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) {
            continue;
          }

          const nIdx = n.y * width + n.x;
          if (visited[nIdx] === 1) {
            continue;
          }

          visited[nIdx] = 1;
          const nOffset = n.y * bitmap.byteWidth + n.x * bitmap.bytesPerPixel;
          const nb = bitmap.image[nOffset];
          const ng = bitmap.image[nOffset + 1];
          const nr = bitmap.image[nOffset + 2];

          if (isStrictMagentaPixel(nr, ng, nb)) {
            queue.push(n);
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      results.push({
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        minX,
        minY,
        maxX,
        maxY,
      });
    }
  }

  return results;
}

export function saveBitmapWithMagentaDetection(bitmap: RobotBitmap, detections: MagentaObjectDetection[], outputPath: string): void {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const srcOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const dstOffset = (y * bitmap.width + x) * 4;
      png.data[dstOffset] = bitmap.image[srcOffset + 2];
      png.data[dstOffset + 1] = bitmap.image[srcOffset + 1];
      png.data[dstOffset + 2] = bitmap.image[srcOffset];
      png.data[dstOffset + 3] = 255;
    }
  }

  function drawRect(x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number): void {
    for (let x = x0; x <= x1; x += 1) {
      for (const row of [y0, y1]) {
        if (x >= 0 && x < bitmap.width && row >= 0 && row < bitmap.height) {
          const idx = (row * bitmap.width + x) * 4;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        }
      }
    }

    for (let y = y0; y <= y1; y += 1) {
      for (const col of [x0, x1]) {
        if (col >= 0 && col < bitmap.width && y >= 0 && y < bitmap.height) {
          const idx = (y * bitmap.width + col) * 4;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = 255;
        }
      }
    }
  }

  function drawCross(cx: number, cy: number, size: number, r: number, g: number, b: number): void {
    for (let dx = -size; dx <= size; dx += 1) {
      const x = cx + dx;
      if (x >= 0 && x < bitmap.width) {
        const idx = (cy * bitmap.width + x) * 4;
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }

    for (let dy = -size; dy <= size; dy += 1) {
      const y = cy + dy;
      if (y >= 0 && y < bitmap.height) {
        const idx = (y * bitmap.width + cx) * 4;
        png.data[idx] = r;
        png.data[idx + 1] = g;
        png.data[idx + 2] = b;
        png.data[idx + 3] = 255;
      }
    }
  }

  for (const d of detections) {
    drawRect(d.minX, d.minY, d.maxX, d.maxY, 0, 255, 0);
    drawCross(d.centerX, d.centerY, 12, 255, 255, 0);
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(outputPath));
}
