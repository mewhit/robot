import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";
import { clamp } from "./osrs-helper";

export type ArceuusEssenceIconKind = "dense-essence-block" | "dark-essence-block" | "dark-essence-fragments";

export type ArceuusEssenceIconTemplate = {
  kind: ArceuusEssenceIconKind;
  bitmap: RobotBitmap;
};

export type ArceuusEssenceIconMatch = {
  kind: ArceuusEssenceIconKind;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  averageColorError: number;
};

export type ArceuusEssenceInventoryDetection = {
  denseBlocks: ArceuusEssenceIconMatch[];
  darkBlocks: ArceuusEssenceIconMatch[];
  darkFragments: ArceuusEssenceIconMatch[];
  isDarkEssenceConfirmed: boolean;
  searchRoi: { x: number; y: number; width: number; height: number };
};

export type ArceuusEssenceInventoryDetectionOptions = {
  blockClassificationMode?: "auto" | "dark";
};

type TemplateSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  weight: number;
};

type PreparedTemplate = ArceuusEssenceIconTemplate & {
  samples: TemplateSample[];
  totalWeight: number;
};

const TEMPLATE_SAMPLE_STRIDE = 3;
const SEARCH_STEP_PX = 2;
const MIN_MATCH_SCORE_BY_KIND: Record<ArceuusEssenceIconKind, number> = {
  "dense-essence-block": 0.95,
  "dark-essence-block": 0.94,
  "dark-essence-fragments": 0.94,
};
const MAX_MATCHES_PER_KIND = 28;
const INVENTORY_LEFT_RATIO = 0.72;
const INVENTORY_TOP_RATIO = 0.70;
const INVENTORY_RIGHT_RATIO = 0.99;
const INVENTORY_BOTTOM_RATIO = 0.97;

const DEFAULT_TEMPLATE_PATHS: Record<ArceuusEssenceIconKind, string> = {
  "dense-essence-block": "test-images/icon/dense essence block.png",
  "dark-essence-block": "test-images/icon/dark essence block.png",
  "dark-essence-fragments": "test-images/icon/Dark essence framents.png",
};

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

function prepareTemplate(template: ArceuusEssenceIconTemplate): PreparedTemplate {
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
      samples.push({ x, y, r: pixel.r, g: pixel.g, b: pixel.b, weight });
      totalWeight += weight;
    }
  }

  return { ...template, samples, totalWeight };
}

function scoreTemplateAt(template: PreparedTemplate, bitmap: RobotBitmap, x: number, y: number): number {
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

function overlaps(left: ArceuusEssenceIconMatch, right: ArceuusEssenceIconMatch): boolean {
  const margin = Math.round(Math.min(left.width, left.height, right.width, right.height) * 0.6);
  return !(
    left.x + left.width - 1 + margin < right.x ||
    right.x + right.width - 1 + margin < left.x ||
    left.y + left.height - 1 + margin < right.y ||
    right.y + right.height - 1 + margin < left.y
  );
}

function suppressOverlappingMatches(matches: ArceuusEssenceIconMatch[]): ArceuusEssenceIconMatch[] {
  const accepted: ArceuusEssenceIconMatch[] = [];
  for (const match of matches.sort((a, b) => b.score - a.score)) {
    if (!accepted.some((existing) => overlaps(existing, match))) {
      accepted.push(match);
    }
    if (accepted.length >= MAX_MATCHES_PER_KIND) {
      break;
    }
  }
  return accepted;
}

function suppressWeakFragmentsInStrongDarkBlockInventory(
  fragments: ArceuusEssenceIconMatch[],
  darkBlocks: readonly ArceuusEssenceIconMatch[],
): ArceuusEssenceIconMatch[] {
  const strongDarkBlockCount = darkBlocks.filter((block) => block.score >= 0.98).length;
  if (strongDarkBlockCount < 5) {
    return fragments;
  }

  return fragments.filter((fragment) => fragment.score >= 0.98);
}

function detectTemplateMatches(
  template: PreparedTemplate,
  bitmap: RobotBitmap,
  roi: { x: number; y: number; width: number; height: number },
): ArceuusEssenceIconMatch[] {
  if (template.bitmap.width > roi.width || template.bitmap.height > roi.height) {
    return [];
  }

  const matches: ArceuusEssenceIconMatch[] = [];
  const maxY = roi.y + roi.height - template.bitmap.height;
  const maxX = roi.x + roi.width - template.bitmap.width;

  for (let y = roi.y; y <= maxY; y += SEARCH_STEP_PX) {
    for (let x = roi.x; x <= maxX; x += SEARCH_STEP_PX) {
      const averageColorError = scoreTemplateAt(template, bitmap, x, y);
      const score = clamp(1 - averageColorError / 255, 0, 1);
      if (score < MIN_MATCH_SCORE_BY_KIND[template.kind]) {
        continue;
      }

      matches.push({
        kind: template.kind,
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

  return suppressOverlappingMatches(matches);
}

export function detectArceuusEssenceInventory(
  bitmap: RobotBitmap,
  templates: readonly ArceuusEssenceIconTemplate[],
  options: ArceuusEssenceInventoryDetectionOptions = {},
): ArceuusEssenceInventoryDetection {
  const searchRoi = resolveInventorySearchRoi(bitmap);
  const matches = suppressOverlappingMatches(
    templates.flatMap((template) => detectTemplateMatches(prepareTemplate(template), bitmap, searchRoi)),
  );
  let denseBlocks = matches.filter((match) => match.kind === "dense-essence-block");
  let darkBlocks = matches.filter((match) => match.kind === "dark-essence-block");
  let darkFragments = matches.filter((match) => match.kind === "dark-essence-fragments");

  darkFragments = suppressWeakFragmentsInStrongDarkBlockInventory(darkFragments, darkBlocks);

  if ((options.blockClassificationMode ?? "auto") === "auto" && darkFragments.length > 0 && darkBlocks.length > 0) {
    if (denseBlocks.length === 0) {
      denseBlocks = darkBlocks.map((match) => ({ ...match, kind: "dense-essence-block" }));
    }
    darkBlocks = [];
  }

  return {
    denseBlocks,
    darkBlocks,
    darkFragments,
    isDarkEssenceConfirmed: (darkBlocks.length > 0 || darkFragments.length > 0) && denseBlocks.length === 0,
    searchRoi,
  };
}

export async function loadArceuusEssenceIconTemplates(): Promise<ArceuusEssenceIconTemplate[]> {
  const entries = Object.entries(DEFAULT_TEMPLATE_PATHS) as Array<[ArceuusEssenceIconKind, string]>;
  return Promise.all(entries.map(async ([kind, iconPath]) => ({ kind, bitmap: await loadPngBitmap(iconPath) })));
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

export function formatArceuusEssenceInventoryDetection(detection: ArceuusEssenceInventoryDetection): string {
  const bestScore = (matches: ArceuusEssenceIconMatch[]): string =>
    matches[0] ? matches[0].score.toFixed(3) : "none";
  return `dense=${detection.denseBlocks.length}(best=${bestScore(detection.denseBlocks)}) dark=${detection.darkBlocks.length}(best=${bestScore(detection.darkBlocks)}) fragments=${detection.darkFragments.length}(best=${bestScore(detection.darkFragments)}) roi=(${detection.searchRoi.x},${detection.searchRoi.y}) ${detection.searchRoi.width}x${detection.searchRoi.height}`;
}

export function formatArceuusEssenceInventoryDetectionDetails(detection: ArceuusEssenceInventoryDetection): string {
  const formatMatches = (matches: ArceuusEssenceIconMatch[]): string =>
    matches
      .map((match) => `(${match.centerX},${match.centerY})=${match.score.toFixed(3)}`)
      .join("; ") || "none";
  return `denseCoords=${formatMatches(detection.denseBlocks)} darkCoords=${formatMatches(detection.darkBlocks)} fragmentCoords=${formatMatches(detection.darkFragments)}`;
}
