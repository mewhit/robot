import * as fs from "fs";
import { screen as electronScreen } from "electron";
import path from "path";
import * as logger from "../../logger";
import { getRuneLite } from "../../runeLiteWindow";
import { captureScreenRect } from "../../windowsScreenCapture";
import { saveBitmap } from "./save-bitmap";

function getResolutionTierLabel(width: number, height: number): string {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);

  if (longEdge >= 7680 || shortEdge >= 4320) {
    return "8k";
  }
  if (longEdge >= 5120 || shortEdge >= 2880) {
    return "5k";
  }
  if (longEdge >= 3840 || shortEdge >= 2160) {
    return "4k";
  }
  if (longEdge >= 2560 || shortEdge >= 1440) {
    return "2k";
  }
  if (longEdge >= 1920 || shortEdge >= 1080) {
    return "1080p";
  }
  if (longEdge >= 1280 || shortEdge >= 720) {
    return "720p";
  }

  return `${width}x${height}`;
}

function getWindowsDisplayMeta(bounds: { x: number; y: number; width: number; height: number }): {
  tierLabel: string;
  scalePercent: string;
  scaleFactor: number;
} {
  const display = electronScreen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });

  const scaleFactor = Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;

  // Electron display sizes are DIP; multiply by scale factor to approximate Windows physical resolution.
  const windowsWidth = Math.max(1, Math.round(display.size.width * scaleFactor));
  const windowsHeight = Math.max(1, Math.round(display.size.height * scaleFactor));
  const tierLabel = getResolutionTierLabel(windowsWidth, windowsHeight);
  const scalePercent = String(Math.round(scaleFactor * 100));

  return { tierLabel, scalePercent, scaleFactor };
}

function toPhysicalCaptureBounds(
  bounds: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
): { x: number; y: number; width: number; height: number } {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

  // node-window-manager bounds are logical (DIP) on many Windows setups.
  // robotjs capture expects physical pixels, so apply DPI scale before capture.
  return {
    x: Math.round(bounds.x * safeScale),
    y: Math.round(bounds.y * safeScale),
    width: Math.max(1, Math.round(bounds.width * safeScale)),
    height: Math.max(1, Math.round(bounds.height * safeScale)),
  };
}

function ensurePngExtension(filePath: string): string {
  if (path.extname(filePath).toLowerCase() === ".png") {
    return filePath;
  }

  return `${filePath}.png`;
}

function normalizeScreenshotNameSuffix(fileNameSuffix: string | undefined): string {
  if (!fileNameSuffix) {
    return "";
  }

  return fileNameSuffix
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
}

function appendSuffixToFilePath(filePath: string, fileNameSuffix: string | undefined): string {
  const normalizedSuffix = normalizeScreenshotNameSuffix(fileNameSuffix);
  if (!normalizedSuffix) {
    return filePath;
  }

  const parsedPath = path.parse(filePath);
  const extension = parsedPath.ext || ".png";
  const baseName = parsedPath.ext ? parsedPath.name : parsedPath.base;
  return path.join(parsedPath.dir, `${baseName}-${normalizedSuffix}${extension}`);
}

function buildDebugScreenshotFileName(gameResolution: string, tierLabel: string, scalePercent: string): string {
  return `${gameResolution}-${tierLabel}-${scalePercent}.png`;
}

function resolveScreenshotFilePath(
  targetPath: string | undefined,
  fileNameSuffix: string | undefined,
  gameResolution: string,
  tierLabel: string,
  scalePercent: string,
): string {
  const screenshotFileName = buildDebugScreenshotFileName(gameResolution, tierLabel, scalePercent);
  const trimmedTargetPath = targetPath?.trim();

  if (!trimmedTargetPath) {
    return appendSuffixToFilePath(`./test-images/${screenshotFileName}`, fileNameSuffix);
  }

  const resolvedTargetPath = path.resolve(trimmedTargetPath);
  if (fs.existsSync(resolvedTargetPath) && fs.statSync(resolvedTargetPath).isDirectory()) {
    return appendSuffixToFilePath(path.join(trimmedTargetPath, screenshotFileName), fileNameSuffix);
  }

  return appendSuffixToFilePath(ensurePngExtension(trimmedTargetPath), fileNameSuffix);
}

export function runAgilityScreenshotCapture(options?: { targetFilePath?: string; fileNameSuffix?: string }): {
  ok: boolean;
  filePath?: string;
  error?: string;
} {
  const window = getRuneLite();
  if (!window) {
    const message = "RuneLite window not found.";
    logger.warn(`Automate Bot (Agility): ${message}`);
    return { ok: false, error: message };
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();

  const windowBounds = window.getBounds();
  const bounds = {
    x: Number(windowBounds.x),
    y: Number(windowBounds.y),
    width: Number(windowBounds.width),
    height: Number(windowBounds.height),
  };

  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value))) {
    const message = "Cannot take screenshot due to invalid RuneLite bounds.";
    logger.warn(`Automate Bot (Agility): ${message}`);
    return { ok: false, error: message };
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    const message = "Cannot take screenshot due to invalid RuneLite bounds.";
    logger.warn(`Automate Bot (Agility): ${message}`);
    return { ok: false, error: message };
  }

  const displayMeta = getWindowsDisplayMeta(bounds);
  const captureBounds = toPhysicalCaptureBounds(bounds, displayMeta.scaleFactor);
  const fullBitmap = captureScreenRect(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);
  const gameResolution = `${fullBitmap.width}x${fullBitmap.height}`;
  const filePath = resolveScreenshotFilePath(
    options?.targetFilePath,
    options?.fileNameSuffix,
    gameResolution,
    displayMeta.tierLabel,
    displayMeta.scalePercent,
  );
  saveBitmap(fullBitmap, filePath);

  logger.log(`Automate Bot (Agility): screenshot saved to ${filePath}.`);
  return { ok: true, filePath };
}
