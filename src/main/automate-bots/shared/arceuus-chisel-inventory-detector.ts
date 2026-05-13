import fs from "fs";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";
import { clamp } from "./osrs-helper";

export type ArceuusChiselInventoryMatch = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  averageColorError: number;
};

export type ArceuusChiselInventoryDetection = {
  chisels: ArceuusChiselInventoryMatch[];
  hasChisel: boolean;
  searchRoi: { x: number; y: number; width: number; height: number };
};

type TemplateSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  weight: number;
};

type PreparedChiselTemplate = {
  bitmap: RobotBitmap;
  samples: TemplateSample[];
  totalWeight: number;
};

const CHISEL_TEMPLATE_PATH = "test-images/icon/chisel.png";
const TEMPLATE_SAMPLE_STRIDE = 2;
const SEARCH_STEP_PX = 2;
const MIN_MATCH_SCORE = 0.94;
const MAX_MATCHES = 4;
const INVENTORY_LEFT_RATIO = 0.45;
const INVENTORY_TOP_RATIO = 0.70;
const INVENTORY_RIGHT_RATIO = 0.99;
const INVENTORY_BOTTOM_RATIO = 0.97;

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
  return 1 + gradient / 220 + saturation / 90;
}

function prepareTemplate(bitmap: RobotBitmap): PreparedChiselTemplate {
  const samples: TemplateSample[] = [];
  let totalWeight = 0;

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (x % TEMPLATE_SAMPLE_STRIDE !== 0 || y % TEMPLATE_SAMPLE_STRIDE !== 0) {
        continue;
      }

      const pixel = readPixel(bitmap, x, y);
      const alphaWeight = pixel.a / 255;
      if (alphaWeight <= 0) {
        continue;
      }

      const weight = getPixelWeight(bitmap, x, y) * alphaWeight;
      samples.push({ x, y, r: pixel.r, g: pixel.g, b: pixel.b, weight });
      totalWeight += weight;
    }
  }

  return { bitmap, samples, totalWeight };
}

function scoreTemplateAt(template: PreparedChiselTemplate, bitmap: RobotBitmap, x: number, y: number): number {
  let weightedError = 0;

  for (const sample of template.samples) {
    const scene = readPixel(bitmap, x + sample.x, y + sample.y);
    weightedError +=
      sample.weight *
      ((Math.abs(sample.r - scene.r) + Math.abs(sample.g - scene.g) + Math.abs(sample.b - scene.b)) / 3);
  }

  return template.totalWeight > 0 ? weightedError / template.totalWeight : Number.POSITIVE_INFINITY;
}

function resolveInventorySearchRoi(bitmap: RobotBitmap): { x: number; y: number; width: number; height: number } {
  const x = clamp(Math.round(bitmap.width * INVENTORY_LEFT_RATIO), 0, bitmap.width - 1);
  const y = clamp(Math.round(bitmap.height * INVENTORY_TOP_RATIO), 0, bitmap.height - 1);
  const maxX = clamp(Math.round(bitmap.width * INVENTORY_RIGHT_RATIO), x, bitmap.width - 1);
  const maxY = clamp(Math.round(bitmap.height * INVENTORY_BOTTOM_RATIO), y, bitmap.height - 1);
  return { x, y, width: maxX - x + 1, height: maxY - y + 1 };
}

function overlaps(left: ArceuusChiselInventoryMatch, right: ArceuusChiselInventoryMatch): boolean {
  const margin = Math.round(Math.min(left.width, left.height, right.width, right.height) * 0.6);
  return !(
    left.x + left.width - 1 + margin < right.x ||
    right.x + right.width - 1 + margin < left.x ||
    left.y + left.height - 1 + margin < right.y ||
    right.y + right.height - 1 + margin < left.y
  );
}

function suppressOverlappingMatches(matches: ArceuusChiselInventoryMatch[]): ArceuusChiselInventoryMatch[] {
  const accepted: ArceuusChiselInventoryMatch[] = [];
  for (const match of matches.sort((a, b) => b.score - a.score)) {
    if (!accepted.some((existing) => overlaps(existing, match))) {
      accepted.push(match);
    }
    if (accepted.length >= MAX_MATCHES) {
      break;
    }
  }
  return accepted;
}

export function detectArceuusChiselInventory(
  bitmap: RobotBitmap,
  templateBitmap: RobotBitmap,
): ArceuusChiselInventoryDetection {
  const searchRoi = resolveInventorySearchRoi(bitmap);
  const template = prepareTemplate(templateBitmap);
  const matches: ArceuusChiselInventoryMatch[] = [];

  if (template.bitmap.width <= searchRoi.width && template.bitmap.height <= searchRoi.height) {
    const maxY = searchRoi.y + searchRoi.height - template.bitmap.height;
    const maxX = searchRoi.x + searchRoi.width - template.bitmap.width;

    for (let y = searchRoi.y; y <= maxY; y += SEARCH_STEP_PX) {
      for (let x = searchRoi.x; x <= maxX; x += SEARCH_STEP_PX) {
        const averageColorError = scoreTemplateAt(template, bitmap, x, y);
        const score = clamp(1 - averageColorError / 255, 0, 1);
        if (score < MIN_MATCH_SCORE) {
          continue;
        }

        matches.push({
          x,
          y,
          width: template.bitmap.width,
          height: template.bitmap.height,
          centerX: Math.round(x + template.bitmap.width / 2),
          centerY: Math.round(y + template.bitmap.height / 2),
          score,
          averageColorError,
        });
      }
    }
  }

  const chisels = suppressOverlappingMatches(matches);
  return {
    chisels,
    hasChisel: chisels.length > 0,
    searchRoi,
  };
}

export async function loadArceuusChiselIconTemplate(): Promise<RobotBitmap> {
  return loadPngBitmap(CHISEL_TEMPLATE_PATH);
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

export function formatArceuusChiselInventoryDetection(detection: ArceuusChiselInventoryDetection): string {
  const bestScore = detection.chisels[0] ? detection.chisels[0].score.toFixed(3) : "none";
  return `chisel=${detection.chisels.length}(best=${bestScore}) hasChisel=${detection.hasChisel ? "yes" : "no"} roi=(${detection.searchRoi.x},${detection.searchRoi.y}) ${detection.searchRoi.width}x${detection.searchRoi.height}`;
}

export function formatArceuusChiselInventoryDetectionDetails(detection: ArceuusChiselInventoryDetection): string {
  const coords =
    detection.chisels
      .map((match) => `(${match.centerX},${match.centerY})=${match.score.toFixed(3)}`)
      .join("; ") || "none";
  return `chiselCoords=${coords}`;
}
