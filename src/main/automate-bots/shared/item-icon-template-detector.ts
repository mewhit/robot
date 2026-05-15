import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export type ItemIconSearchRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ItemIconTemplate = {
  name: string;
  bitmap: RobotBitmap;
  path: string;
};

export type ItemIconMatch = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  averageColorError: number;
};

export type ItemIconTemplateDetection = {
  template: string;
  searchRoi: ItemIconSearchRoi;
  minScore: number;
  matches: ItemIconMatch[];
  bestMatch: ItemIconMatch | null;
};

type TemplateSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  weight: number;
};

type PreparedItemIconTemplate = {
  template: ItemIconTemplate;
  samples: TemplateSample[];
  totalWeight: number;
};

type CandidateMatch = ItemIconMatch & {
  coarse: boolean;
};

const DEFAULT_COARSE_STEP_PX = 2;
const DEFAULT_REFINE_RADIUS_PX = 2;
const DEFAULT_MAX_COARSE_CANDIDATES = 32;
const DEFAULT_MAX_MATCHES = 8;
const TRANSPARENT_ALPHA_CUTOFF = 16;

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

function getPixelWeight(bitmap: RobotBitmap, x: number, y: number): number {
  const center = readPixel(bitmap, x, y);
  const left = readPixel(bitmap, Math.max(0, x - 1), y);
  const right = readPixel(bitmap, Math.min(bitmap.width - 1, x + 1), y);
  const up = readPixel(bitmap, x, Math.max(0, y - 1));
  const down = readPixel(bitmap, x, Math.min(bitmap.height - 1, y + 1));
  const gradient =
    Math.abs(right.r - left.r) +
    Math.abs(right.g - left.g) +
    Math.abs(right.b - left.b) +
    Math.abs(down.r - up.r) +
    Math.abs(down.g - up.g) +
    Math.abs(down.b - up.b);
  const saturation = Math.max(center.r, center.g, center.b) - Math.min(center.r, center.g, center.b);
  return 1 + gradient / 220 + saturation / 90;
}

function prepareTemplate(template: ItemIconTemplate): PreparedItemIconTemplate {
  const samples: TemplateSample[] = [];
  let totalWeight = 0;

  for (let y = 0; y < template.bitmap.height; y += 1) {
    for (let x = 0; x < template.bitmap.width; x += 1) {
      const pixel = readPixel(template.bitmap, x, y);
      if (pixel.a <= TRANSPARENT_ALPHA_CUTOFF) {
        continue;
      }

      const weight = getPixelWeight(template.bitmap, x, y) * (pixel.a / 255);
      samples.push({ x, y, r: pixel.r, g: pixel.g, b: pixel.b, weight });
      totalWeight += weight;
    }
  }

  return { template, samples, totalWeight };
}

function scoreTemplateAt(template: PreparedItemIconTemplate, bitmap: RobotBitmap, x: number, y: number): number {
  if (template.totalWeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  let weightedError = 0;
  for (const sample of template.samples) {
    const scene = readPixel(bitmap, x + sample.x, y + sample.y);
    weightedError +=
      sample.weight *
      ((Math.abs(sample.r - scene.r) + Math.abs(sample.g - scene.g) + Math.abs(sample.b - scene.b)) / 3);
  }

  return weightedError / template.totalWeight;
}

function toMatch(
  template: PreparedItemIconTemplate,
  x: number,
  y: number,
  averageColorError: number,
  coarse: boolean,
): CandidateMatch {
  const score = clamp(1 - averageColorError / 255, 0, 1);
  return {
    name: template.template.name,
    x,
    y,
    width: template.template.bitmap.width,
    height: template.template.bitmap.height,
    centerX: Math.round(x + template.template.bitmap.width / 2),
    centerY: Math.round(y + template.template.bitmap.height / 2),
    score,
    averageColorError,
    coarse,
  };
}

function normalizeSearchRoi(bitmap: RobotBitmap, roi: ItemIconSearchRoi): ItemIconSearchRoi {
  const x = clamp(Math.floor(roi.x), 0, bitmap.width - 1);
  const y = clamp(Math.floor(roi.y), 0, bitmap.height - 1);
  const right = clamp(Math.floor(roi.x + roi.width - 1), x, bitmap.width - 1);
  const bottom = clamp(Math.floor(roi.y + roi.height - 1), y, bitmap.height - 1);
  return { x, y, width: right - x + 1, height: bottom - y + 1 };
}

function pushTopCandidate(candidates: CandidateMatch[], candidate: CandidateMatch, maxCandidates: number): void {
  candidates.push(candidate);
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > maxCandidates) {
    candidates.length = maxCandidates;
  }
}

function overlaps(left: ItemIconMatch, right: ItemIconMatch): boolean {
  const margin = Math.round(Math.min(left.width, left.height, right.width, right.height) * 0.55);
  return !(
    left.x + left.width - 1 + margin < right.x ||
    right.x + right.width - 1 + margin < left.x ||
    left.y + left.height - 1 + margin < right.y ||
    right.y + right.height - 1 + margin < left.y
  );
}

function suppressOverlappingMatches(matches: ItemIconMatch[], maxMatches: number): ItemIconMatch[] {
  const accepted: ItemIconMatch[] = [];
  for (const match of matches.sort((a, b) => b.score - a.score)) {
    if (!accepted.some((existing) => overlaps(existing, match))) {
      accepted.push(match);
    }
    if (accepted.length >= maxMatches) {
      break;
    }
  }
  return accepted;
}

export function detectItemIconTemplate(
  bitmap: RobotBitmap,
  template: ItemIconTemplate,
  options: {
    searchRoi: ItemIconSearchRoi;
    minScore: number;
    coarseStepPx?: number;
    refineRadiusPx?: number;
    maxMatches?: number;
    maxCoarseCandidates?: number;
  },
): ItemIconTemplateDetection {
  const searchRoi = normalizeSearchRoi(bitmap, options.searchRoi);
  const prepared = prepareTemplate(template);
  const coarseStepPx = Math.max(1, Math.round(options.coarseStepPx ?? DEFAULT_COARSE_STEP_PX));
  const refineRadiusPx = Math.max(0, Math.round(options.refineRadiusPx ?? DEFAULT_REFINE_RADIUS_PX));
  const maxCoarseCandidates = Math.max(1, Math.round(options.maxCoarseCandidates ?? DEFAULT_MAX_COARSE_CANDIDATES));
  const maxMatches = Math.max(1, Math.round(options.maxMatches ?? DEFAULT_MAX_MATCHES));
  const coarseCandidates: CandidateMatch[] = [];

  const maxY = searchRoi.y + searchRoi.height - template.bitmap.height;
  const maxX = searchRoi.x + searchRoi.width - template.bitmap.width;
  if (maxX < searchRoi.x || maxY < searchRoi.y || prepared.samples.length === 0) {
    return { template: template.name, searchRoi, minScore: options.minScore, matches: [], bestMatch: null };
  }

  for (let y = searchRoi.y; y <= maxY; y += coarseStepPx) {
    for (let x = searchRoi.x; x <= maxX; x += coarseStepPx) {
      const averageColorError = scoreTemplateAt(prepared, bitmap, x, y);
      pushTopCandidate(coarseCandidates, toMatch(prepared, x, y, averageColorError, true), maxCoarseCandidates);
    }
  }

  const refinedByPoint = new Map<string, CandidateMatch>();
  for (const candidate of coarseCandidates) {
    const minY = clamp(candidate.y - refineRadiusPx, searchRoi.y, maxY);
    const maxRefineY = clamp(candidate.y + refineRadiusPx, searchRoi.y, maxY);
    const minX = clamp(candidate.x - refineRadiusPx, searchRoi.x, maxX);
    const maxRefineX = clamp(candidate.x + refineRadiusPx, searchRoi.x, maxX);

    for (let y = minY; y <= maxRefineY; y += 1) {
      for (let x = minX; x <= maxRefineX; x += 1) {
        const key = `${x},${y}`;
        if (refinedByPoint.has(key)) {
          continue;
        }

        const averageColorError = scoreTemplateAt(prepared, bitmap, x, y);
        refinedByPoint.set(key, toMatch(prepared, x, y, averageColorError, false));
      }
    }
  }

  const matches = suppressOverlappingMatches(
    [...refinedByPoint.values()].filter((match) => match.score >= options.minScore),
    maxMatches,
  );
  return {
    template: template.name,
    searchRoi,
    minScore: options.minScore,
    matches,
    bestMatch: matches[0] ?? null,
  };
}

export function loadItemIconTemplate(name: string, iconPath: string): Promise<ItemIconTemplate> {
  return loadPngBitmap(iconPath).then((bitmap) => ({ name, bitmap, path: iconPath }));
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

function bitmapToPng(bitmap: RobotBitmap): PNG {
  const png = new PNG({ width: bitmap.width, height: bitmap.height });
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const sourceOffset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const targetOffset = (y * bitmap.width + x) * 4;
      png.data[targetOffset] = bitmap.image[sourceOffset + 2];
      png.data[targetOffset + 1] = bitmap.image[sourceOffset + 1];
      png.data[targetOffset + 2] = bitmap.image[sourceOffset];
      png.data[targetOffset + 3] = bitmap.image[sourceOffset + 3] ?? 255;
    }
  }
  return png;
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

function drawBox(png: PNG, box: ItemIconSearchRoi, color: { r: number; g: number; b: number }, thickness = 2): void {
  const x0 = clamp(Math.round(box.x), 0, png.width - 1);
  const y0 = clamp(Math.round(box.y), 0, png.height - 1);
  const x1 = clamp(Math.round(box.x + box.width - 1), 0, png.width - 1);
  const y1 = clamp(Math.round(box.y + box.height - 1), 0, png.height - 1);

  for (let offset = 0; offset < thickness; offset += 1) {
    for (let x = x0; x <= x1; x += 1) {
      setPngPixel(png, x, y0 + offset, color);
      setPngPixel(png, x, y1 - offset, color);
    }
    for (let y = y0; y <= y1; y += 1) {
      setPngPixel(png, x0 + offset, y, color);
      setPngPixel(png, x1 - offset, y, color);
    }
  }
}

function drawCross(png: PNG, x: number, y: number, color: { r: number; g: number; b: number }, radius = 7): void {
  for (let delta = -radius; delta <= radius; delta += 1) {
    setPngPixel(png, x + delta, y, color);
    setPngPixel(png, x, y + delta, color);
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

export async function saveBitmapWithItemIconTemplateDebug(
  bitmap: RobotBitmap,
  detection: ItemIconTemplateDetection,
  outputPath: string,
  options: {
    clickPoint?: { x: number; y: number };
    debugBoxes?: readonly { x: number; y: number; width: number; height: number }[];
    menuBoxes?: readonly { x: number; y: number; width: number; height: number }[];
  } = {},
): Promise<void> {
  const png = bitmapToPng(bitmap);
  drawBox(png, detection.searchRoi, { r: 255, g: 220, b: 0 }, 3);

  for (const box of options.debugBoxes ?? []) {
    drawBox(png, box, { r: 0, g: 220, b: 255 }, 3);
  }

  for (const match of detection.matches) {
    const isBest = match === detection.bestMatch;
    drawBox(png, match, isBest ? { r: 0, g: 255, b: 80 } : { r: 255, g: 0, b: 255 }, isBest ? 4 : 2);
    drawCross(png, match.centerX, match.centerY, isBest ? { r: 0, g: 255, b: 80 } : { r: 255, g: 0, b: 255 }, 6);
  }

  for (const box of options.menuBoxes ?? []) {
    drawBox(png, box, { r: 255, g: 0, b: 255 }, 3);
  }

  if (options.clickPoint) {
    drawCross(png, Math.round(options.clickPoint.x), Math.round(options.clickPoint.y), { r: 255, g: 40, b: 40 }, 10);
  }

  await writePngToFile(png, outputPath);
}

export function formatItemIconTemplateDetection(detection: ItemIconTemplateDetection): string {
  const best = detection.bestMatch
    ? `${detection.bestMatch.name}@${detection.bestMatch.centerX},${detection.bestMatch.centerY} score=${detection.bestMatch.score.toFixed(3)} err=${detection.bestMatch.averageColorError.toFixed(1)}`
    : "none";
  const matches = detection.matches
    .map((match) => `${match.centerX},${match.centerY}:${match.score.toFixed(3)}`)
    .join("|");
  return `template=${detection.template} roi=${detection.searchRoi.x},${detection.searchRoi.y},${detection.searchRoi.width}x${detection.searchRoi.height} min=${detection.minScore.toFixed(3)} best=${best} matches=${matches || "none"}`;
}
