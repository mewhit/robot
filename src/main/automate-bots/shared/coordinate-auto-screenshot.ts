import fs from "fs";
import path from "path";
import { CoordinateOverlayDetectionOptions, detectOverlayBoxInScreenshot } from "./coordinate-box-detector";
import type { RobotBitmap } from "./ocr-engine";
import { saveBitmap } from "./save-bitmap";

type CoordinateFilenameTokens = {
  xToken: string;
  yToken: string;
  zToken: string;
};

export type CoordinateAutoScreenshotResult = {
  saved: boolean;
  filePath: string | null;
  matchedLine: string | null;
};

export type CoordinateOverlayLocation = {
  matchedLine: string;
  x: number;
  y: number;
  z: number | null;
  chunkId: number;
  regionId: number;
};

const COORDINATE_BOX_DEBUG_RELATIVE_DIR = path.join("test-images", "coordinate-box");
const COORDINATE_BOX_UNVERIFIED_SUFFIX = "unverified";
const COORDINATE_BOX_UNKNOWN_TOKEN = "unknown";
const COORDINATE_OVERLAY_FAST_SCAN_WIDTH_PX = 2200;
const COORDINATE_OVERLAY_FAST_SCAN_HEIGHT_PX = 420;

function sanitizeFilenameToken(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function resolveCoordinateBoxDebugDir(): string {
  const candidates = [
    path.resolve(process.cwd(), COORDINATE_BOX_DEBUG_RELATIVE_DIR),
    path.resolve(__dirname, "..", "..", "..", COORDINATE_BOX_DEBUG_RELATIVE_DIR),
    path.resolve(__dirname, "..", "..", "..", "..", COORDINATE_BOX_DEBUG_RELATIVE_DIR),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveCoordinateFilenameTokens(matchedLine: string | null): CoordinateFilenameTokens {
  if (matchedLine) {
    const cleaned = matchedLine.replace(/[^0-9,]/g, "");
    const delimited = cleaned.match(/(\d{4,5}),(\d{4,5}),(\d)/);
    if (delimited) {
      return {
        xToken: delimited[1],
        yToken: delimited[2],
        zToken: delimited[3],
      };
    }

    const partial = cleaned.match(/(\d{4,5}),(\d{4,5})/);
    if (partial) {
      return {
        xToken: partial[1],
        yToken: partial[2],
        zToken: COORDINATE_BOX_UNKNOWN_TOKEN,
      };
    }
  }

  return {
    xToken: COORDINATE_BOX_UNKNOWN_TOKEN,
    yToken: COORDINATE_BOX_UNKNOWN_TOKEN,
    zToken: COORDINATE_BOX_UNKNOWN_TOKEN,
  };
}

function createTopLeftCoordinateOverlayBitmapView(bitmap: RobotBitmap): RobotBitmap {
  const width = Math.min(bitmap.width, COORDINATE_OVERLAY_FAST_SCAN_WIDTH_PX);
  const height = Math.min(bitmap.height, COORDINATE_OVERLAY_FAST_SCAN_HEIGHT_PX);
  if (width === bitmap.width && height === bitmap.height) {
    return bitmap;
  }

  return {
    width,
    height,
    byteWidth: bitmap.byteWidth,
    bytesPerPixel: bitmap.bytesPerPixel,
    image: bitmap.image,
  };
}

export function detectCoordinateOverlayBox(
  bitmap: RobotBitmap,
  windowsScalePercent: number,
  options: CoordinateOverlayDetectionOptions = {},
) {
  const scanBitmap = createTopLeftCoordinateOverlayBitmapView(bitmap);
  const fastDetection = detectOverlayBoxInScreenshot(scanBitmap, windowsScalePercent, options);
  if (fastDetection || scanBitmap === bitmap) {
    return fastDetection;
  }

  return detectOverlayBoxInScreenshot(bitmap, windowsScalePercent, options);
}

export function readCoordinateOverlayLocation(bitmap: RobotBitmap, windowsScalePercent: number): CoordinateOverlayLocation | null {
  const overlayBox = detectCoordinateOverlayBox(bitmap, windowsScalePercent);
  const matchedLine = overlayBox?.matchedLine ?? null;
  if (!matchedLine) {
    return null;
  }

  const { xToken, yToken, zToken } = resolveCoordinateFilenameTokens(matchedLine);
  const x = Number(xToken);
  const y = Number(yToken);
  const z = Number(zToken);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const worldChunkX = x >> 3;
  const worldChunkY = y >> 3;
  const regionX = x >> 6;
  const regionY = y >> 6;

  return {
    matchedLine,
    x,
    y,
    z: Number.isFinite(z) ? z : null,
    chunkId: (worldChunkX << 11) | worldChunkY,
    regionId: (regionX << 8) | regionY,
  };
}

function resolveUniqueCoordinateScreenshotPath(baseName: string): string {
  const outputDir = resolveCoordinateBoxDebugDir();
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const extension = ".png";
  const firstPath = path.join(outputDir, `${baseName}${extension}`);
  if (!fs.existsSync(firstPath)) {
    return firstPath;
  }

  let index = 1;
  while (true) {
    const indexedPath = path.join(outputDir, `${baseName}-${index}${extension}`);
    if (!fs.existsSync(indexedPath)) {
      return indexedPath;
    }
    index += 1;
  }
}

export function saveCoordinateAutoScreenshot(params: {
  bitmap: RobotBitmap;
  monitorTier: string;
  windowsScalePercent: number;
}): CoordinateAutoScreenshotResult {
  const location = readCoordinateOverlayLocation(params.bitmap, params.windowsScalePercent);
  if (!location) {
    return {
      saved: false,
      filePath: null,
      matchedLine: null,
    };
  }

  const xToken = String(location.x);
  const yToken = String(location.y);
  const zToken = location.z === null ? COORDINATE_BOX_UNKNOWN_TOKEN : String(location.z);
  const monitorTier = sanitizeFilenameToken(params.monitorTier);
  const scalePercent = sanitizeFilenameToken(params.windowsScalePercent);
  const baseName = `${params.bitmap.width}x${params.bitmap.height}-${monitorTier}-${scalePercent}-r-${xToken}-${yToken}-${zToken}-chunk-id-${location.chunkId}-region-id-${location.regionId}-${COORDINATE_BOX_UNVERIFIED_SUFFIX}`;
  const filePath = resolveUniqueCoordinateScreenshotPath(baseName);
  saveBitmap(params.bitmap, filePath);

  return {
    saved: true,
    filePath,
    matchedLine: location.matchedLine,
  };
}
