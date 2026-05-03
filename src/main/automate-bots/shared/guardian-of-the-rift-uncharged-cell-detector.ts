import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export type GuardianOfTheRiftUnchargedCellTemplate = {
  count: number;
  bitmap: RobotBitmap;
};

export type GuardianOfTheRiftUnchargedCellMatch = {
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  averageColorError: number;
};

export type GuardianOfTheRiftUnchargedCellDetection = {
  count: number | null;
  hasTenUnchargedCells: boolean;
  match: GuardianOfTheRiftUnchargedCellMatch | null;
  matches: GuardianOfTheRiftUnchargedCellMatch[];
};

type Roi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TemplateSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  weight: number;
};

type PreparedTemplate = GuardianOfTheRiftUnchargedCellTemplate & {
  samples: TemplateSample[];
  totalWeight: number;
};

const UNCHARGED_CELL_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const TEMPLATE_SAMPLE_STRIDE = 2;
const MIN_MATCH_SCORE = 0.84;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readPixel(bitmap: RobotBitmap, x: number, y: number): { r: number; g: number; b: number; a: number } {
  const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;

  return {
    b: bitmap.image[offset],
    g: bitmap.image[offset + 1],
    r: bitmap.image[offset + 2],
    a: bitmap.image[offset + 3] ?? 255,
  };
}

function getPixelWeight(templateBitmap: RobotBitmap, x: number, y: number): number {
  const center = readPixel(templateBitmap, x, y);
  const left = readPixel(templateBitmap, Math.max(0, x - 1), y);
  const right = readPixel(templateBitmap, Math.min(templateBitmap.width - 1, x + 1), y);
  const up = readPixel(templateBitmap, x, Math.max(0, y - 1));
  const down = readPixel(templateBitmap, x, Math.min(templateBitmap.height - 1, y + 1));

  const gradient =
    Math.abs(right.r - left.r) +
    Math.abs(right.g - left.g) +
    Math.abs(right.b - left.b) +
    Math.abs(down.r - up.r) +
    Math.abs(down.g - up.g) +
    Math.abs(down.b - up.b);
  const saturation = Math.max(center.r, center.g, center.b) - Math.min(center.r, center.g, center.b);
  const yellowTextStrength = Math.max(0, Math.min(center.r, center.g) - center.b);

  return 1 + gradient / 180 + saturation / 80 + yellowTextStrength / 90;
}

function prepareTemplate(template: GuardianOfTheRiftUnchargedCellTemplate): PreparedTemplate {
  const samples: TemplateSample[] = [];
  let totalWeight = 0;

  for (let y = 0; y < template.bitmap.height; y += 1) {
    for (let x = 0; x < template.bitmap.width; x += 1) {
      if (x % TEMPLATE_SAMPLE_STRIDE !== 0 || y % TEMPLATE_SAMPLE_STRIDE !== 0) {
        continue;
      }

      const pixel = readPixel(template.bitmap, x, y);
      const alphaWeight = pixel.a / 255;
      if (alphaWeight <= 0) {
        continue;
      }

      const weight = getPixelWeight(template.bitmap, x, y) * alphaWeight;
      samples.push({
        x,
        y,
        r: pixel.r,
        g: pixel.g,
        b: pixel.b,
        weight,
      });
      totalWeight += weight;
    }
  }

  return {
    ...template,
    samples,
    totalWeight,
  };
}

function scoreTemplateAt(template: PreparedTemplate, bitmap: RobotBitmap, x: number, y: number): number {
  let weightedError = 0;

  for (const sample of template.samples) {
    const scene = readPixel(bitmap, x + sample.x, y + sample.y);
    weightedError +=
      sample.weight *
      ((Math.abs(sample.r - scene.r) + Math.abs(sample.g - scene.g) + Math.abs(sample.b - scene.b)) / 3);
  }

  if (template.totalWeight === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return weightedError / template.totalWeight;
}

function clampRoi(bitmap: RobotBitmap, roi: Roi): Roi {
  const x = clamp(Math.floor(roi.x), 0, bitmap.width - 1);
  const y = clamp(Math.floor(roi.y), 0, bitmap.height - 1);
  const maxX = clamp(Math.floor(roi.x + roi.width - 1), x, bitmap.width - 1);
  const maxY = clamp(Math.floor(roi.y + roi.height - 1), y, bitmap.height - 1);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function resolveDefaultSearchRois(bitmap: RobotBitmap): Roi[] {
  if (bitmap.width <= 140 && bitmap.height <= 140) {
    return [{ x: 0, y: 0, width: bitmap.width, height: bitmap.height }];
  }

  return [
    {
      x: Math.round(bitmap.width * 0.72),
      y: Math.round(bitmap.height * 0.68),
      width: Math.round(bitmap.width * 0.28),
      height: Math.round(bitmap.height * 0.32),
    },
    {
      x: 0,
      y: Math.round(bitmap.height * 0.1),
      width: Math.round(bitmap.width * 0.18),
      height: Math.round(bitmap.height * 0.22),
    },
  ];
}

function findBestMatchInRoi(
  template: PreparedTemplate,
  bitmap: RobotBitmap,
  roi: Roi,
): GuardianOfTheRiftUnchargedCellMatch | null {
  if (template.bitmap.width > roi.width || template.bitmap.height > roi.height) {
    return null;
  }

  let bestError = Number.POSITIVE_INFINITY;
  let bestX = roi.x;
  let bestY = roi.y;

  const maxY = roi.y + roi.height - template.bitmap.height;
  const maxX = roi.x + roi.width - template.bitmap.width;

  for (let y = roi.y; y <= maxY; y += 1) {
    for (let x = roi.x; x <= maxX; x += 1) {
      const error = scoreTemplateAt(template, bitmap, x, y);
      if (error < bestError) {
        bestError = error;
        bestX = x;
        bestY = y;
      }
    }
  }

  const score = clamp(1 - bestError / 255, 0, 1);
  return {
    count: template.count,
    x: bestX,
    y: bestY,
    width: template.bitmap.width,
    height: template.bitmap.height,
    centerX: Math.round(bestX + template.bitmap.width / 2),
    centerY: Math.round(bestY + template.bitmap.height / 2),
    score,
    averageColorError: bestError,
  };
}

export function detectGuardianOfTheRiftUnchargedCellCount(
  bitmap: RobotBitmap,
  templates: GuardianOfTheRiftUnchargedCellTemplate[],
  searchRois: Roi[] = resolveDefaultSearchRois(bitmap),
): GuardianOfTheRiftUnchargedCellDetection {
  const rois = searchRois.map((roi) => clampRoi(bitmap, roi));
  const preparedTemplates = templates.map(prepareTemplate);
  const matches: GuardianOfTheRiftUnchargedCellMatch[] = [];

  for (const template of preparedTemplates) {
    for (const roi of rois) {
      const match = findBestMatchInRoi(template, bitmap, roi);
      if (match) {
        matches.push(match);
      }
    }
  }

  const sortedMatches = matches.sort((a, b) => b.score - a.score);
  const match = sortedMatches[0] ?? null;
  const count = match && match.score >= MIN_MATCH_SCORE ? match.count : null;

  return {
    count,
    hasTenUnchargedCells: count === 10,
    match: count === null ? null : match,
    matches: sortedMatches,
  };
}

export function loadGuardianOfTheRiftUnchargedCellTemplatesFromDirectory(
  iconDirectory: string,
): Promise<GuardianOfTheRiftUnchargedCellTemplate[]> {
  return Promise.all(
    UNCHARGED_CELL_COUNTS.map(async (count) => ({
      count,
      bitmap: await loadPngBitmap(path.join(iconDirectory, `${count}.png`)),
    })),
  );
}

function loadPngBitmap(filePath: string): Promise<RobotBitmap> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new Error(`File not found: ${filePath}`));
      return;
    }

    const png = new PNG();
    fs.createReadStream(filePath)
      .pipe(png)
      .on("parsed", function (this: PNG) {
        const image = Buffer.alloc(png.width * png.height * 4);

        for (let index = 0; index < png.data.length; index += 4) {
          image[index] = png.data[index + 2];
          image[index + 1] = png.data[index + 1];
          image[index + 2] = png.data[index];
          image[index + 3] = png.data[index + 3];
        }

        resolve({
          width: png.width,
          height: png.height,
          byteWidth: png.width * 4,
          bytesPerPixel: 4,
          image,
        });
      })
      .on("error", reject);
  });
}

function setPngPixel(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const index = (y * png.width + x) * 4;
  png.data[index] = color.r;
  png.data[index + 1] = color.g;
  png.data[index + 2] = color.b;
  png.data[index + 3] = 255;
}

function drawRectangleOnPng(
  png: PNG,
  x: number,
  y: number,
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
  thickness: number,
): void {
  const x0 = clamp(x, 0, png.width - 1);
  const y0 = clamp(y, 0, png.height - 1);
  const x1 = clamp(x + width - 1, 0, png.width - 1);
  const y1 = clamp(y + height - 1, 0, png.height - 1);

  for (let t = 0; t < thickness; t += 1) {
    for (let drawX = x0 + t; drawX <= x1 - t; drawX += 1) {
      setPngPixel(png, drawX, y0 + t, color);
      setPngPixel(png, drawX, y1 - t, color);
    }

    for (let drawY = y0 + t; drawY <= y1 - t; drawY += 1) {
      setPngPixel(png, x0 + t, drawY, color);
      setPngPixel(png, x1 - t, drawY, color);
    }
  }
}

export function saveBitmapWithGuardianOfTheRiftUnchargedCellDebug(
  bitmap: RobotBitmap,
  detection: GuardianOfTheRiftUnchargedCellDetection,
  outputPath: string,
): void {
  const png = new PNG({
    width: bitmap.width,
    height: bitmap.height,
  });

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const pngIndex = (y * bitmap.width + x) * 4;
      const bitmapIndex = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;

      png.data[pngIndex] = bitmap.image[bitmapIndex + 2];
      png.data[pngIndex + 1] = bitmap.image[bitmapIndex + 1];
      png.data[pngIndex + 2] = bitmap.image[bitmapIndex];
      png.data[pngIndex + 3] = 255;
    }
  }

  if (detection.match) {
    drawRectangleOnPng(
      png,
      detection.match.x,
      detection.match.y,
      detection.match.width,
      detection.match.height,
      { r: 255, g: 210, b: 50 },
      2,
    );
  }

  const directory = path.dirname(outputPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(outputPath));
}
