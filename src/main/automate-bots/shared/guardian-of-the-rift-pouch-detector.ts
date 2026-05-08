import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import type { RobotBitmap } from "./ocr-engine";

export const GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES = ["small", "medium", "large", "giant"] as const;
export type GuardianOfTheRiftDetectablePouch = (typeof GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES)[number];

export type GuardianOfTheRiftPouchTemplate = {
  pouch: GuardianOfTheRiftDetectablePouch;
  bitmap: RobotBitmap;
};

export type GuardianOfTheRiftPouchSearchRoi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GuardianOfTheRiftPouchMatchSource =
  | "cached-roi"
  | "full-search"
  | "full-search-after-cache-miss";

export type GuardianOfTheRiftPouchMatch = {
  pouch: GuardianOfTheRiftDetectablePouch;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
  averageColorError: number;
  source: GuardianOfTheRiftPouchMatchSource;
};

export type GuardianOfTheRiftPouchDetection = {
  pouches: Record<GuardianOfTheRiftDetectablePouch, GuardianOfTheRiftPouchMatch | null>;
  detectedPouches: GuardianOfTheRiftPouchMatch[];
  matches: GuardianOfTheRiftPouchMatch[];
  searchRois: GuardianOfTheRiftPouchSearchRoi[];
};

export type GuardianOfTheRiftPouchDetectorCacheEntry = {
  pouch: GuardianOfTheRiftDetectablePouch;
  bitmapWidth: number;
  bitmapHeight: number;
  templateWidth: number;
  templateHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  score: number;
};

export type GuardianOfTheRiftPouchDetectorCache = {
  entries: Partial<Record<GuardianOfTheRiftDetectablePouch, GuardianOfTheRiftPouchDetectorCacheEntry>>;
};

export type GuardianOfTheRiftPouchDetectionOptions = {
  minScore?: number;
  searchRois?: GuardianOfTheRiftPouchSearchRoi[];
  cache?: GuardianOfTheRiftPouchDetectorCache;
};

type TemplateSample = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  weight: number;
};

type PreparedTemplate = GuardianOfTheRiftPouchTemplate & {
  samples: TemplateSample[];
  totalWeight: number;
};

const DEFAULT_POUCH_ICON_DIR = "test-images/icon/guardin-of-the-rift/pouch";
const TEMPLATE_SAMPLE_STRIDE = 2;
const MIN_MATCH_SCORE = 0.82;
const CACHED_ROI_PADDING_PX = 12;
const INVENTORY_SEARCH_ROI = {
  xRatio: 0.72,
  yRatio: 0.68,
  widthRatio: 0.28,
  heightRatio: 0.32,
};

const preparedTemplateCache = new WeakMap<GuardianOfTheRiftPouchTemplate, PreparedTemplate>();

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
  const brownStrength = Math.max(0, Math.min(center.r, center.g) - center.b * 0.7);

  return 1 + gradient / 180 + saturation / 80 + brownStrength / 120;
}

function prepareTemplate(template: GuardianOfTheRiftPouchTemplate): PreparedTemplate {
  const cached = preparedTemplateCache.get(template);
  if (cached) {
    return cached;
  }

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

  const prepared = {
    ...template,
    samples,
    totalWeight,
  };
  preparedTemplateCache.set(template, prepared);
  return prepared;
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

function clampRoi(bitmap: RobotBitmap, roi: GuardianOfTheRiftPouchSearchRoi): GuardianOfTheRiftPouchSearchRoi {
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

function resolveDefaultSearchRois(bitmap: RobotBitmap): GuardianOfTheRiftPouchSearchRoi[] {
  if (bitmap.width <= 180 && bitmap.height <= 180) {
    return [{ x: 0, y: 0, width: bitmap.width, height: bitmap.height }];
  }

  return [
    {
      x: Math.round(bitmap.width * INVENTORY_SEARCH_ROI.xRatio),
      y: Math.round(bitmap.height * INVENTORY_SEARCH_ROI.yRatio),
      width: Math.round(bitmap.width * INVENTORY_SEARCH_ROI.widthRatio),
      height: Math.round(bitmap.height * INVENTORY_SEARCH_ROI.heightRatio),
    },
  ];
}

function findBestMatchInRoi(
  template: PreparedTemplate,
  bitmap: RobotBitmap,
  roi: GuardianOfTheRiftPouchSearchRoi,
  source: GuardianOfTheRiftPouchMatchSource,
): GuardianOfTheRiftPouchMatch | null {
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
    pouch: template.pouch,
    x: bestX,
    y: bestY,
    width: template.bitmap.width,
    height: template.bitmap.height,
    centerX: Math.round(bestX + template.bitmap.width / 2),
    centerY: Math.round(bestY + template.bitmap.height / 2),
    score,
    averageColorError: bestError,
    source,
  };
}

function findBestMatchInRois(
  template: PreparedTemplate,
  bitmap: RobotBitmap,
  rois: GuardianOfTheRiftPouchSearchRoi[],
  source: GuardianOfTheRiftPouchMatchSource,
): GuardianOfTheRiftPouchMatch | null {
  let bestMatch: GuardianOfTheRiftPouchMatch | null = null;

  for (const roi of rois) {
    const match = findBestMatchInRoi(template, bitmap, roi, source);
    if (match && (!bestMatch || match.score > bestMatch.score)) {
      bestMatch = match;
    }
  }

  return bestMatch;
}

function isCacheEntryCompatible(
  entry: GuardianOfTheRiftPouchDetectorCacheEntry,
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPouchTemplate,
): boolean {
  return (
    entry.bitmapWidth === bitmap.width &&
    entry.bitmapHeight === bitmap.height &&
    entry.templateWidth === template.bitmap.width &&
    entry.templateHeight === template.bitmap.height &&
    entry.x + entry.width <= bitmap.width &&
    entry.y + entry.height <= bitmap.height
  );
}

function createCachedSearchRoi(
  entry: GuardianOfTheRiftPouchDetectorCacheEntry,
  bitmap: RobotBitmap,
): GuardianOfTheRiftPouchSearchRoi {
  const padding = Math.max(CACHED_ROI_PADDING_PX, Math.round(Math.max(entry.width, entry.height) * 0.25));
  const x = Math.max(0, entry.x - padding);
  const y = Math.max(0, entry.y - padding);
  const maxX = Math.min(bitmap.width - 1, entry.x + entry.width - 1 + padding);
  const maxY = Math.min(bitmap.height - 1, entry.y + entry.height - 1 + padding);

  return {
    x,
    y,
    width: maxX - x + 1,
    height: maxY - y + 1,
  };
}

function saveCacheMatch(
  cache: GuardianOfTheRiftPouchDetectorCache | undefined,
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPouchTemplate,
  match: GuardianOfTheRiftPouchMatch | null,
): void {
  if (!cache || !match) {
    return;
  }

  cache.entries[template.pouch] = {
    pouch: template.pouch,
    bitmapWidth: bitmap.width,
    bitmapHeight: bitmap.height,
    templateWidth: template.bitmap.width,
    templateHeight: template.bitmap.height,
    x: match.x,
    y: match.y,
    width: match.width,
    height: match.height,
    centerX: match.centerX,
    centerY: match.centerY,
    score: match.score,
  };
}

function detectPouchTemplate(
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPouchTemplate,
  searchRois: GuardianOfTheRiftPouchSearchRoi[],
  minScore: number,
  cache: GuardianOfTheRiftPouchDetectorCache | undefined,
): { accepted: GuardianOfTheRiftPouchMatch | null; matches: GuardianOfTheRiftPouchMatch[] } {
  const preparedTemplate = prepareTemplate(template);
  const matches: GuardianOfTheRiftPouchMatch[] = [];
  const entry = cache?.entries[template.pouch];

  if (entry && isCacheEntryCompatible(entry, bitmap, template)) {
    const cachedRoi = clampRoi(bitmap, createCachedSearchRoi(entry, bitmap));
    const cachedMatch = findBestMatchInRoi(preparedTemplate, bitmap, cachedRoi, "cached-roi");
    if (cachedMatch) {
      matches.push(cachedMatch);
      if (cachedMatch.score >= minScore) {
        saveCacheMatch(cache, bitmap, template, cachedMatch);
        return { accepted: cachedMatch, matches };
      }
    }
  }

  const source: GuardianOfTheRiftPouchMatchSource = entry ? "full-search-after-cache-miss" : "full-search";
  const fullMatch = findBestMatchInRois(preparedTemplate, bitmap, searchRois, source);
  if (fullMatch) {
    matches.push(fullMatch);
    if (fullMatch.score >= minScore) {
      saveCacheMatch(cache, bitmap, template, fullMatch);
      return { accepted: fullMatch, matches };
    }
  }

  return { accepted: null, matches };
}

export function createGuardianOfTheRiftPouchDetectorCache(): GuardianOfTheRiftPouchDetectorCache {
  return { entries: {} };
}

export function detectGuardianOfTheRiftPouches(
  bitmap: RobotBitmap,
  templates: GuardianOfTheRiftPouchTemplate[],
  options: GuardianOfTheRiftPouchDetectionOptions = {},
): GuardianOfTheRiftPouchDetection {
  const minScore = options.minScore ?? MIN_MATCH_SCORE;
  const searchRois = (options.searchRois ?? resolveDefaultSearchRois(bitmap)).map((roi) => clampRoi(bitmap, roi));
  const pouches: Record<GuardianOfTheRiftDetectablePouch, GuardianOfTheRiftPouchMatch | null> = {
    small: null,
    medium: null,
    large: null,
    giant: null,
  };
  const matches: GuardianOfTheRiftPouchMatch[] = [];

  for (const template of templates) {
    const result = detectPouchTemplate(bitmap, template, searchRois, minScore, options.cache);
    matches.push(...result.matches);
    pouches[template.pouch] = result.accepted;
  }

  const detectedPouches = Object.values(pouches)
    .filter((match): match is GuardianOfTheRiftPouchMatch => match !== null)
    .sort((a, b) => b.score - a.score);

  return {
    pouches,
    detectedPouches,
    matches: matches.sort((a, b) => b.score - a.score),
    searchRois,
  };
}

export function loadGuardianOfTheRiftPouchTemplatesFromDirectory(
  iconDirectory = DEFAULT_POUCH_ICON_DIR,
): Promise<GuardianOfTheRiftPouchTemplate[]> {
  return Promise.all(
    GUARDIAN_OF_THE_RIFT_DETECTABLE_POUCHES.map(async (pouch) => ({
      pouch,
      bitmap: await loadPngBitmap(resolvePouchTemplatePath(iconDirectory, pouch)),
    })),
  );
}

function resolvePouchTemplatePath(iconDirectory: string, pouch: GuardianOfTheRiftDetectablePouch): string {
  const candidates = [
    path.join(iconDirectory, `${pouch}-pouch.png`),
    path.join(iconDirectory, `${pouch}-pouch-0.png`),
  ];

  for (const candidate of candidates) {
    if (resolvePngPath(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolvePngPath(filePath: string): string | null {
  const candidates = [
    filePath,
    path.resolve(process.cwd(), filePath),
    path.resolve(__dirname, "..", "..", "..", "..", filePath),
    path.resolve(__dirname, "..", "..", "..", "..", "..", filePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function loadPngBitmap(filePath: string): Promise<RobotBitmap> {
  return new Promise((resolve, reject) => {
    const resolvedPath = resolvePngPath(filePath);
    if (!resolvedPath) {
      reject(new Error(`File not found: ${filePath}`));
      return;
    }

    const png = new PNG();
    fs.createReadStream(resolvedPath)
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
