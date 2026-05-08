import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export const ELEMENTAL_GUARDIAN_RUNES = ["air", "water", "earth", "fire"] as const;
export const CATALYTIC_GUARDIAN_RUNES = [
  "mind",
  "body",
  "chaos",
  "cosmic",
  "nature",
  "law",
  "death",
  "blood",
] as const;

export const GUARDIAN_OF_THE_RIFT_RUNES = [
  ...ELEMENTAL_GUARDIAN_RUNES,
  ...CATALYTIC_GUARDIAN_RUNES,
] as const;

export type ElementalGuardianRune = (typeof ELEMENTAL_GUARDIAN_RUNES)[number];
export type CatalyticGuardianRune = (typeof CATALYTIC_GUARDIAN_RUNES)[number];
export type GuardianOfTheRiftRune = (typeof GUARDIAN_OF_THE_RIFT_RUNES)[number];
export type GuardianOfTheRiftSlot = "elemental" | "catalytic";

export type GuardianOfTheRiftRuneTemplate = {
  rune: GuardianOfTheRiftRune;
  bitmap: RobotBitmap;
};

export type GuardianOfTheRiftRuneMatch = {
  rune: GuardianOfTheRiftRune;
  slot: GuardianOfTheRiftSlot;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  averageColorError: number;
};

export type GuardianOfTheRiftActiveRuneDetection = {
  elemental: GuardianOfTheRiftRuneMatch | null;
  catalytic: GuardianOfTheRiftRuneMatch | null;
  matches: GuardianOfTheRiftRuneMatch[];
};

type Roi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type SlotSearchRois = Record<GuardianOfTheRiftSlot, Roi>;

type TemplateSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  weight: number;
};

type PreparedGuardianOfTheRiftRuneTemplate = GuardianOfTheRiftRuneTemplate & {
  samples: TemplateSample[];
  totalWeight: number;
};

const MIN_MATCH_SCORE = 0.82;
const TEMPLATE_SAMPLE_STRIDE = 2;
const preparedTemplateCache = new WeakMap<GuardianOfTheRiftRuneTemplate, PreparedGuardianOfTheRiftRuneTemplate>();

const DEFAULT_SLOT_SEARCH_ROIS: SlotSearchRois = {
  elemental: {
    x: 24,
    y: 92,
    width: 90,
    height: 76,
  },
  catalytic: {
    x: 124,
    y: 92,
    width: 96,
    height: 76,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isElementalRune(rune: GuardianOfTheRiftRune): rune is ElementalGuardianRune {
  return (ELEMENTAL_GUARDIAN_RUNES as readonly string[]).includes(rune);
}

function isCatalyticRune(rune: GuardianOfTheRiftRune): rune is CatalyticGuardianRune {
  return (CATALYTIC_GUARDIAN_RUNES as readonly string[]).includes(rune);
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

  return 1 + gradient / 180 + saturation / 80;
}

function prepareTemplate(template: GuardianOfTheRiftRuneTemplate): PreparedGuardianOfTheRiftRuneTemplate {
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

function getPreparedTemplate(template: GuardianOfTheRiftRuneTemplate): PreparedGuardianOfTheRiftRuneTemplate {
  const cached = preparedTemplateCache.get(template);
  if (cached) {
    return cached;
  }

  const prepared = prepareTemplate(template);
  preparedTemplateCache.set(template, prepared);
  return prepared;
}

function scoreTemplateAt(
  template: PreparedGuardianOfTheRiftRuneTemplate,
  screenshotBitmap: RobotBitmap,
  x: number,
  y: number,
): number {
  let weightedError = 0;

  for (const sample of template.samples) {
    const scene = readPixel(screenshotBitmap, x + sample.x, y + sample.y);
    weightedError +=
      sample.weight *
      ((Math.abs(sample.r - scene.r) + Math.abs(sample.g - scene.g) + Math.abs(sample.b - scene.b)) / 3);
  }

  if (template.totalWeight === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return weightedError / template.totalWeight;
}

function findBestTemplateMatchInRoi(
  template: PreparedGuardianOfTheRiftRuneTemplate,
  slot: GuardianOfTheRiftSlot,
  screenshotBitmap: RobotBitmap,
  roi: Roi,
): GuardianOfTheRiftRuneMatch | null {
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
      const error = scoreTemplateAt(template, screenshotBitmap, x, y);
      if (error < bestError) {
        bestError = error;
        bestX = x;
        bestY = y;
      }
    }
  }

  const score = clamp(1 - bestError / 255, 0, 1);

  return {
    rune: template.rune,
    slot,
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

function pickBestMatch(
  matches: GuardianOfTheRiftRuneMatch[],
  slot: GuardianOfTheRiftSlot,
): GuardianOfTheRiftRuneMatch | null {
  const bestMatch = matches
    .filter((match) => match.slot === slot)
    .sort((a, b) => b.score - a.score)[0];

  if (!bestMatch || bestMatch.score < MIN_MATCH_SCORE) {
    return null;
  }

  return bestMatch;
}

export function detectGuardianOfTheRiftActiveRunes(
  screenshotBitmap: RobotBitmap,
  templates: GuardianOfTheRiftRuneTemplate[],
  slotSearchRois: Partial<SlotSearchRois> = {},
): GuardianOfTheRiftActiveRuneDetection {
  const elementalRoi = clampRoi(screenshotBitmap, slotSearchRois.elemental ?? DEFAULT_SLOT_SEARCH_ROIS.elemental);
  const catalyticRoi = clampRoi(screenshotBitmap, slotSearchRois.catalytic ?? DEFAULT_SLOT_SEARCH_ROIS.catalytic);
  const preparedTemplates = templates.map(getPreparedTemplate);
  const matches: GuardianOfTheRiftRuneMatch[] = [];

  for (const template of preparedTemplates) {
    if (isElementalRune(template.rune)) {
      const match = findBestTemplateMatchInRoi(template, "elemental", screenshotBitmap, elementalRoi);
      if (match) {
        matches.push(match);
      }
    }

    if (isCatalyticRune(template.rune)) {
      const match = findBestTemplateMatchInRoi(template, "catalytic", screenshotBitmap, catalyticRoi);
      if (match) {
        matches.push(match);
      }
    }
  }

  return {
    elemental: pickBestMatch(matches, "elemental"),
    catalytic: pickBestMatch(matches, "catalytic"),
    matches: matches.sort((a, b) => b.score - a.score),
  };
}

export function loadGuardianOfTheRiftRuneTemplatesFromDirectory(
  iconDirectory: string,
): Promise<GuardianOfTheRiftRuneTemplate[]> {
  return Promise.all(
    GUARDIAN_OF_THE_RIFT_RUNES.map(async (rune) => ({
      rune,
      bitmap: await loadPngBitmap(path.join(iconDirectory, `${rune}-rune-indicator.png`)),
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

export function saveBitmapWithGuardianOfTheRiftActiveRunesDebug(
  bitmap: RobotBitmap,
  detection: GuardianOfTheRiftActiveRuneDetection,
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

  if (detection.elemental) {
    drawRectangleOnPng(
      png,
      detection.elemental.x,
      detection.elemental.y,
      detection.elemental.width,
      detection.elemental.height,
      { r: 60, g: 220, b: 255 },
      3,
    );
  }

  if (detection.catalytic) {
    drawRectangleOnPng(
      png,
      detection.catalytic.x,
      detection.catalytic.y,
      detection.catalytic.width,
      detection.catalytic.height,
      { r: 255, g: 210, b: 50 },
      3,
    );
  }

  const directory = path.dirname(outputPath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  png.pack().pipe(fs.createWriteStream(outputPath));
}
