import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { BitmapLike } from "./save-bitmap";

export type DebugOverlayColor = {
  r: number;
  g: number;
  b: number;
};

export type DebugOverlayShape =
  | {
      type: "box";
      x: number;
      y: number;
      width: number;
      height: number;
      color: DebugOverlayColor;
      thickness?: number;
    }
  | {
      type: "circle";
      x: number;
      y: number;
      radius: number;
      color: DebugOverlayColor;
      thickness?: number;
    }
  | {
      type: "cross";
      x: number;
      y: number;
      radius?: number;
      color: DebugOverlayColor;
      thickness?: number;
    }
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: DebugOverlayColor;
      thickness?: number;
    }
  | {
      type: "points";
      points: readonly { x: number; y: number }[];
      color: DebugOverlayColor;
      thickness?: number;
    };

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function bitmapToPng(bitmap: BitmapLike): PNG {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const targetOffset = (y * bitmap.width + x) * 4;
      const sourceOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;

      png.data[targetOffset] = bitmap.image[sourceOffset + 2];
      png.data[targetOffset + 1] = bitmap.image[sourceOffset + 1];
      png.data[targetOffset + 2] = bitmap.image[sourceOffset];
      png.data[targetOffset + 3] = bitmap.image[sourceOffset + 3] ?? 255;
    }
  }

  return png;
}

function setPngPixel(
  png: PNG,
  x: number,
  y: number,
  color: DebugOverlayColor,
  thickness = 1,
): void {
  const half = Math.max(0, Math.floor((thickness - 1) / 2));
  for (let dy = -half; dy <= half; dy += 1) {
    for (let dx = -half; dx <= half; dx += 1) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) {
        continue;
      }

      const offset = (py * png.width + px) * 4;
      png.data[offset] = color.r;
      png.data[offset + 1] = color.g;
      png.data[offset + 2] = color.b;
      png.data[offset + 3] = 255;
    }
  }
}

function drawCross(png: PNG, shape: Extract<DebugOverlayShape, { type: "cross" }>): void {
  const x = Math.round(shape.x);
  const y = Math.round(shape.y);
  const radius = Math.max(2, Math.round(shape.radius ?? 8));
  const thickness = Math.max(1, Math.round(shape.thickness ?? 2));

  for (let delta = -radius; delta <= radius; delta += 1) {
    setPngPixel(png, x + delta, y, shape.color, thickness);
    setPngPixel(png, x, y + delta, shape.color, thickness);
  }
}

function drawBox(png: PNG, shape: Extract<DebugOverlayShape, { type: "box" }>): void {
  const thickness = Math.max(1, Math.round(shape.thickness ?? 2));
  const x0 = clampInt(shape.x, 0, png.width - 1);
  const y0 = clampInt(shape.y, 0, png.height - 1);
  const x1 = clampInt(shape.x + shape.width - 1, x0, png.width - 1);
  const y1 = clampInt(shape.y + shape.height - 1, y0, png.height - 1);

  for (let offset = 0; offset < thickness; offset += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPngPixel(png, x, y0 + offset, shape.color);
      setPngPixel(png, x, y1 - offset, shape.color);
    }

    for (let y = y0; y <= y1; y += 1) {
      setPngPixel(png, x0 + offset, y, shape.color);
      setPngPixel(png, x1 - offset, y, shape.color);
    }
  }
}

function drawLine(png: PNG, shape: Extract<DebugOverlayShape, { type: "line" }>): void {
  const x1 = Math.round(shape.x1);
  const y1 = Math.round(shape.y1);
  const x2 = Math.round(shape.x2);
  const y2 = Math.round(shape.y2);
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
  const thickness = Math.max(1, Math.round(shape.thickness ?? 2));

  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    setPngPixel(
      png,
      x1 + (x2 - x1) * ratio,
      y1 + (y2 - y1) * ratio,
      shape.color,
      thickness,
    );
  }
}

function drawCircle(png: PNG, shape: Extract<DebugOverlayShape, { type: "circle" }>): void {
  const radius = Math.max(1, Math.round(shape.radius));
  const thickness = Math.max(1, Math.round(shape.thickness ?? 2));
  const circumference = Math.max(24, Math.round(2 * Math.PI * radius));

  for (let step = 0; step < circumference; step += 1) {
    const angle = (step / circumference) * Math.PI * 2;
    setPngPixel(
      png,
      shape.x + Math.cos(angle) * radius,
      shape.y + Math.sin(angle) * radius,
      shape.color,
      thickness,
    );
  }
}

function drawPoints(png: PNG, shape: Extract<DebugOverlayShape, { type: "points" }>): void {
  const thickness = Math.max(1, Math.round(shape.thickness ?? 1));
  for (const point of shape.points) {
    setPngPixel(png, point.x, point.y, shape.color, thickness);
  }
}

function drawShape(png: PNG, shape: DebugOverlayShape): void {
  if (shape.type === "box") {
    drawBox(png, shape);
  } else if (shape.type === "circle") {
    drawCircle(png, shape);
  } else if (shape.type === "cross") {
    drawCross(png, shape);
  } else if (shape.type === "points") {
    drawPoints(png, shape);
  } else {
    drawLine(png, shape);
  }
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

export async function saveBitmapWithDebugOverlay(
  bitmap: BitmapLike,
  outputPath: string,
  shapes: readonly DebugOverlayShape[],
): Promise<void> {
  const png = bitmapToPng(bitmap);
  for (const shape of shapes) {
    drawShape(png, shape);
  }

  await writePngToFile(png, outputPath);
}
