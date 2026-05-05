import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import {
  detectGuardianOfTheRiftPortalOpenIcon,
  type GuardianOfTheRiftPortalOpenIconDetection,
  type GuardianOfTheRiftPortalOpenIconMatch,
  type GuardianOfTheRiftPortalOpenIconSearchRoi,
  type GuardianOfTheRiftPortalOpenIconTemplate,
} from "./shared/guardian-of-the-rift-portal-detector";
import type { RobotBitmap } from "./shared/ocr-engine";

export type GuardianOfTheRiftPortalOpenIconCacheContext = {
  monitorTier: string;
  windowsScalePercent: number;
};

export type GuardianOfTheRiftPortalOpenIconCacheSource =
  | "full-search"
  | "cached-roi"
  | "cached-roi-miss"
  | "full-search-after-cache-miss";

export type GuardianOfTheRiftPortalOpenIconCachedDetection = GuardianOfTheRiftPortalOpenIconDetection & {
  cache: {
    key: string;
    path: string;
    source: GuardianOfTheRiftPortalOpenIconCacheSource;
    hasEntry: boolean;
  };
};

type PortalOpenIconCacheEntry = {
  version: 1;
  key: string;
  host: string;
  monitorTier: string;
  windowsScalePercent: number;
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
  updatedAtIso: string;
};

type PortalOpenIconCacheFile = {
  version: 1;
  entries: Record<string, PortalOpenIconCacheEntry>;
};

const CACHE_FILE_NAME = "guardian-of-the-rift-portal-open-icon-cache.json";
const CACHE_VERSION = 1;
const CACHED_ROI_PADDING_PX = 12;
const FULL_SEARCH_AFTER_CACHED_MISSES = 10;

let cacheFile: PortalOpenIconCacheFile | null = null;
const cachedMissCounts = new Map<string, number>();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Math.round(value) === value && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Math.round(value) === value && value >= 0;
}

function sanitizeKeyPart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "_");

  return sanitized.length > 0 ? sanitized : "unknown";
}

function getHostKey(): string {
  return sanitizeKeyPart(os.hostname() || "unknown");
}

export function getGuardianOfTheRiftPortalOpenIconCachePath(): string {
  try {
    return path.join(app.getPath("userData"), CACHE_FILE_NAME);
  } catch {
    return path.join(process.cwd(), "automate-bot-logs", CACHE_FILE_NAME);
  }
}

function buildCacheKey(
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
  context: GuardianOfTheRiftPortalOpenIconCacheContext,
): string {
  return [
    `host=${getHostKey()}`,
    `display=${sanitizeKeyPart(context.monitorTier)}`,
    `scale=${Math.round(context.windowsScalePercent)}`,
    `capture=${bitmap.width}x${bitmap.height}`,
    `template=${template.bitmap.width}x${template.bitmap.height}`,
  ].join("|");
}

function normalizeCacheEntry(value: unknown, expectedKey: string): PortalOpenIconCacheEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<PortalOpenIconCacheEntry>;
  if (
    candidate.version !== CACHE_VERSION ||
    candidate.key !== expectedKey ||
    typeof candidate.host !== "string" ||
    typeof candidate.monitorTier !== "string" ||
    !isFiniteNumber(candidate.windowsScalePercent) ||
    !isPositiveInteger(candidate.bitmapWidth) ||
    !isPositiveInteger(candidate.bitmapHeight) ||
    !isPositiveInteger(candidate.templateWidth) ||
    !isPositiveInteger(candidate.templateHeight) ||
    !isNonNegativeInteger(candidate.x) ||
    !isNonNegativeInteger(candidate.y) ||
    !isPositiveInteger(candidate.width) ||
    !isPositiveInteger(candidate.height) ||
    !isNonNegativeInteger(candidate.centerX) ||
    !isNonNegativeInteger(candidate.centerY) ||
    !isFiniteNumber(candidate.score) ||
    typeof candidate.updatedAtIso !== "string"
  ) {
    return null;
  }

  return {
    version: CACHE_VERSION,
    key: candidate.key,
    host: candidate.host,
    monitorTier: candidate.monitorTier,
    windowsScalePercent: candidate.windowsScalePercent,
    bitmapWidth: candidate.bitmapWidth,
    bitmapHeight: candidate.bitmapHeight,
    templateWidth: candidate.templateWidth,
    templateHeight: candidate.templateHeight,
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
    centerX: candidate.centerX,
    centerY: candidate.centerY,
    score: candidate.score,
    updatedAtIso: candidate.updatedAtIso,
  };
}

function readCacheFile(): PortalOpenIconCacheFile {
  if (cacheFile) {
    return cacheFile;
  }

  const cachePath = getGuardianOfTheRiftPortalOpenIconCachePath();
  if (!fs.existsSync(cachePath)) {
    cacheFile = {
      version: CACHE_VERSION,
      entries: {},
    };
    return cacheFile;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8")) as Partial<PortalOpenIconCacheFile>;
    const entries: Record<string, PortalOpenIconCacheEntry> = {};
    if (raw.version === CACHE_VERSION && raw.entries && typeof raw.entries === "object") {
      for (const [key, value] of Object.entries(raw.entries)) {
        const entry = normalizeCacheEntry(value, key);
        if (entry) {
          entries[key] = entry;
        }
      }
    }

    cacheFile = {
      version: CACHE_VERSION,
      entries,
    };
    return cacheFile;
  } catch (error) {
    console.warn(`Unable to read Guardian of the Rift portal-open icon cache at ${cachePath}: ${String(error)}`);
    cacheFile = {
      version: CACHE_VERSION,
      entries: {},
    };
    return cacheFile;
  }
}

function writeCacheFile(nextCacheFile: PortalOpenIconCacheFile): void {
  const cachePath = getGuardianOfTheRiftPortalOpenIconCachePath();
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(nextCacheFile, null, 2)}\n`, "utf8");
    cacheFile = nextCacheFile;
  } catch (error) {
    console.warn(`Unable to write Guardian of the Rift portal-open icon cache at ${cachePath}: ${String(error)}`);
  }
}

function isEntryCompatible(
  entry: PortalOpenIconCacheEntry,
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
): boolean {
  return (
    entry.host === getHostKey() &&
    entry.bitmapWidth === bitmap.width &&
    entry.bitmapHeight === bitmap.height &&
    entry.templateWidth === template.bitmap.width &&
    entry.templateHeight === template.bitmap.height &&
    entry.x + entry.width <= bitmap.width &&
    entry.y + entry.height <= bitmap.height
  );
}

function getCompatibleEntry(
  key: string,
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
): PortalOpenIconCacheEntry | null {
  const entry = readCacheFile().entries[key];
  return entry && isEntryCompatible(entry, bitmap, template) ? entry : null;
}

function createCachedSearchRoi(entry: PortalOpenIconCacheEntry, bitmap: RobotBitmap): GuardianOfTheRiftPortalOpenIconSearchRoi {
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

function toCacheEntry(
  key: string,
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
  context: GuardianOfTheRiftPortalOpenIconCacheContext,
  match: GuardianOfTheRiftPortalOpenIconMatch,
): PortalOpenIconCacheEntry {
  return {
    version: CACHE_VERSION,
    key,
    host: getHostKey(),
    monitorTier: context.monitorTier,
    windowsScalePercent: Math.round(context.windowsScalePercent),
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
    updatedAtIso: new Date().toISOString(),
  };
}

function isSameSavedPosition(a: PortalOpenIconCacheEntry | undefined, b: PortalOpenIconCacheEntry): boolean {
  return (
    !!a &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.bitmapWidth === b.bitmapWidth &&
    a.bitmapHeight === b.bitmapHeight &&
    a.templateWidth === b.templateWidth &&
    a.templateHeight === b.templateHeight
  );
}

function saveCacheMatch(
  key: string,
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
  context: GuardianOfTheRiftPortalOpenIconCacheContext,
  match: GuardianOfTheRiftPortalOpenIconMatch | null,
): void {
  if (!match) {
    return;
  }

  const currentCache = readCacheFile();
  const nextEntry = toCacheEntry(key, bitmap, template, context, match);
  if (isSameSavedPosition(currentCache.entries[key], nextEntry)) {
    return;
  }

  writeCacheFile({
    version: CACHE_VERSION,
    entries: {
      ...currentCache.entries,
      [key]: nextEntry,
    },
  });
}

function withCacheMetadata(
  detection: GuardianOfTheRiftPortalOpenIconDetection,
  key: string,
  source: GuardianOfTheRiftPortalOpenIconCacheSource,
  hasEntry: boolean,
): GuardianOfTheRiftPortalOpenIconCachedDetection {
  return {
    ...detection,
    cache: {
      key,
      path: getGuardianOfTheRiftPortalOpenIconCachePath(),
      source,
      hasEntry,
    },
  };
}

export function detectGuardianOfTheRiftPortalOpenIconWithCache(
  bitmap: RobotBitmap,
  template: GuardianOfTheRiftPortalOpenIconTemplate,
  context: GuardianOfTheRiftPortalOpenIconCacheContext,
): GuardianOfTheRiftPortalOpenIconCachedDetection {
  const key = buildCacheKey(bitmap, template, context);
  const entry = getCompatibleEntry(key, bitmap, template);

  if (!entry) {
    const detection = detectGuardianOfTheRiftPortalOpenIcon(bitmap, template);
    if (detection.isOpen) {
      cachedMissCounts.delete(key);
      saveCacheMatch(key, bitmap, template, context, detection.match);
    }

    return withCacheMetadata(detection, key, "full-search", false);
  }

  const cachedRoiDetection = detectGuardianOfTheRiftPortalOpenIcon(
    bitmap,
    template,
    createCachedSearchRoi(entry, bitmap),
  );
  if (cachedRoiDetection.isOpen) {
    cachedMissCounts.delete(key);
    saveCacheMatch(key, bitmap, template, context, cachedRoiDetection.match);
    return withCacheMetadata(cachedRoiDetection, key, "cached-roi", true);
  }

  const missCount = (cachedMissCounts.get(key) ?? FULL_SEARCH_AFTER_CACHED_MISSES - 1) + 1;
  cachedMissCounts.set(key, missCount);
  if (missCount % FULL_SEARCH_AFTER_CACHED_MISSES !== 0) {
    return withCacheMetadata(cachedRoiDetection, key, "cached-roi-miss", true);
  }

  const fullDetection = detectGuardianOfTheRiftPortalOpenIcon(bitmap, template);
  if (fullDetection.isOpen) {
    cachedMissCounts.delete(key);
    saveCacheMatch(key, bitmap, template, context, fullDetection.match);
  }

  return withCacheMetadata(fullDetection, key, "full-search-after-cache-miss", true);
}
