import { screen as electronScreen } from "electron";
import { Window } from "node-window-manager";
import { ScreenCaptureBounds, captureScreenBitmap } from "../../windowsScreenCapture";
import { parseWorldTileFromMatchedLine, WorldTile } from "../mapping/world-coordinate";
import { detectOverlayBoxInScreenshot } from "./coordinate-box-detector";
import { estimateTilePxFromPlayerBox } from "./osrs-helper";
import { detectBestPlayerBoxInScreenshot, PlayerBox } from "./player-box-detector";

const STARTUP_TILE_PX_FALLBACK = 48;
const STARTUP_TILE_PX_MIN = 24;
const STARTUP_TILE_PX_MAX = 96;
const STARTUP_RAW_TILE_PX_MIN_TRUSTED = 35;
const STARTUP_RAW_TILE_PX_MAX_TRUSTED = 70;

export type StartupPlayerTileCalibration = {
  captureBounds: ScreenCaptureBounds;
  windowsScalePercent: number;
  playerTile: WorldTile | null;
  coordinateLine: string | null;
  playerBox: PlayerBox | null;
  playerBoxScreenCenter: { x: number; y: number } | null;
  rawTilePx: number | null;
  tilePx: number;
  tilePxSource: "player-box" | "fallback";
};

function getLogicalWindowBounds(window: Window): ScreenCaptureBounds | null {
  const bounds = window.getBounds();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function getWindowsDisplayScaleFactor(bounds: ScreenCaptureBounds): number {
  const display = electronScreen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });
  return Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
}

function toPhysicalBounds(bounds: ScreenCaptureBounds, scaleFactor: number): ScreenCaptureBounds {
  const s = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(bounds.x * s),
    y: Math.round(bounds.y * s),
    width: Math.max(1, Math.round(bounds.width * s)),
    height: Math.max(1, Math.round(bounds.height * s)),
  };
}

function formatPlayerTile(playerTile: WorldTile | null): string {
  return playerTile ? `${playerTile.x},${playerTile.y},${playerTile.z}` : "unavailable";
}

function formatCoordinateLine(coordinateLine: string | null): string {
  return coordinateLine ? `'${coordinateLine}'` : "unavailable";
}

function formatPlayerBox(calibration: StartupPlayerTileCalibration): string {
  const playerBox = calibration.playerBox;
  if (!playerBox) {
    return "unavailable";
  }

  const screenCenter = calibration.playerBoxScreenCenter;
  const screenCenterText = screenCenter ? ` screenCenter=(${screenCenter.x},${screenCenter.y})` : "";
  return `local=(${playerBox.x},${playerBox.y}) size=${playerBox.width}x${playerBox.height} center=(${playerBox.centerX},${playerBox.centerY})${screenCenterText} pixels=${playerBox.pixelCount}`;
}

function estimateRawTilePx(playerBox: PlayerBox | null): number | null {
  return playerBox ? Math.round((playerBox.width + playerBox.height) / 2) : null;
}

function isTrustedRawTilePx(rawTilePx: number | null): boolean {
  return (
    rawTilePx !== null &&
    Number.isFinite(rawTilePx) &&
    rawTilePx >= STARTUP_RAW_TILE_PX_MIN_TRUSTED &&
    rawTilePx <= STARTUP_RAW_TILE_PX_MAX_TRUSTED
  );
}

export function readStartupPlayerTileCalibration(window: Window): StartupPlayerTileCalibration | null {
  const logicalBounds = getLogicalWindowBounds(window);
  if (!logicalBounds) {
    return null;
  }

  const scaleFactor = getWindowsDisplayScaleFactor(logicalBounds);
  const captureBounds = toPhysicalBounds(logicalBounds, scaleFactor);
  const windowsScalePercent = Math.round(scaleFactor * 100);
  const bitmap = captureScreenBitmap(captureBounds);
  const coordinateBox = detectOverlayBoxInScreenshot(bitmap, windowsScalePercent);
  const coordinateLine = coordinateBox?.matchedLine ?? null;
  const playerTile = coordinateLine ? parseWorldTileFromMatchedLine(coordinateLine) : null;
  const detectedPlayerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const detectedRawTilePx = estimateRawTilePx(detectedPlayerBox);
  const playerBox = isTrustedRawTilePx(detectedRawTilePx) ? detectedPlayerBox : null;
  const rawTilePx = playerBox ? detectedRawTilePx : null;
  const tilePx = estimateTilePxFromPlayerBox(playerBox, {
    fallbackTilePx: STARTUP_TILE_PX_FALLBACK,
    minTilePx: STARTUP_TILE_PX_MIN,
    maxTilePx: STARTUP_TILE_PX_MAX,
  });

  return {
    captureBounds,
    windowsScalePercent,
    playerTile,
    coordinateLine,
    playerBox,
    playerBoxScreenCenter: playerBox
      ? {
          x: captureBounds.x + playerBox.centerX,
          y: captureBounds.y + playerBox.centerY,
      }
      : null,
    rawTilePx,
    tilePx,
    tilePxSource: playerBox ? "player-box" : "fallback",
  };
}

export function formatStartupPlayerTileCalibrationLog(
  botName: string,
  calibration: StartupPlayerTileCalibration,
): string {
  return [
    `Automate Bot (${botName}): startup calibration`,
    `playerTile=${formatPlayerTile(calibration.playerTile)}`,
    `coordinate=${formatCoordinateLine(calibration.coordinateLine)}`,
    `playerBox=${formatPlayerBox(calibration)}`,
    `tilePx=${calibration.tilePx}px`,
    `rawTilePx=${calibration.rawTilePx ?? "unavailable"}px`,
    `tilePxSource=${calibration.tilePxSource}`,
    `tilePxSafetyClamp=${STARTUP_TILE_PX_MIN}-${STARTUP_TILE_PX_MAX}px`,
    `capture=${calibration.captureBounds.width}x${calibration.captureBounds.height}`,
    `scale=${calibration.windowsScalePercent}%.`,
  ].join(" ");
}
