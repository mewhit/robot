import { screen as electronScreen } from "electron";
import path from "path";
import { Window } from "node-window-manager";
import {
  ScreenCaptureBounds,
  type ScreenBitmap,
  captureScreenBitmap,
  resolveScreenCaptureBounds,
} from "../../windowsScreenCapture";
import { parseWorldTileFromMatchedLine, WorldTile } from "../mapping/world-coordinate";
import { detectCompassNorthDirection, type CompassNorthDetection } from "./compass-north-detector";
import {
  detectOverlayBoxInScreenshot,
  readCoordinateOverlayBoxInKnownBounds,
  type OverlayBox,
} from "./coordinate-box-detector";
import { estimateTilePxFromPlayerBox } from "./osrs-helper";
import { detectBestPlayerBoxInScreenshot, PlayerBox } from "./player-box-detector";
import { saveBitmap } from "./save-bitmap";

const STARTUP_TILE_PX_FALLBACK = 48;
const STARTUP_TILE_PX_MIN = 24;
const STARTUP_TILE_PX_MAX = 96;
const STARTUP_RAW_TILE_PX_MIN_TRUSTED = 35;
const STARTUP_RAW_TILE_PX_MAX_TRUSTED = 70;
const STARTUP_COORDINATE_DEBUG_DIR = "test-image-debug";
const STARTUP_COORDINATE_FALLBACK_X_LOGICAL = 0;
const STARTUP_COORDINATE_FALLBACK_Y_LOGICAL = 182;
const STARTUP_COORDINATE_FALLBACK_WIDTH_LOGICAL = 210;
const STARTUP_COORDINATE_FALLBACK_HEIGHT_LOGICAL = 118;
const STARTUP_COORDINATE_FALLBACK_COMPACT_WIDTH_LOGICAL = 170;
const STARTUP_COORDINATE_FALLBACK_COMPACT_HEIGHT_LOGICAL = 72;
const STARTUP_COORDINATE_SHIFTED_Y_LOGICAL_OFFSETS = [0, 22, 44, 68];

type CoordinateBox = { x: number; y: number; width: number; height: number };
type CoordinateReadSource =
  | "detected-box"
  | "relaxed-detected-box"
  | "preferred-box"
  | "saved-box"
  | "fallback-box"
  | null;

type StartupCoordinateRead = {
  box: OverlayBox | null;
  source: Exclude<CoordinateReadSource, null> | null;
  attempts: string[];
};

type StartupCoordinateBoxCandidate = {
  source: Exclude<CoordinateReadSource, "detected-box" | "relaxed-detected-box" | null>;
  label: string;
  box: CoordinateBox;
};

let lastSuccessfulCoordinateBox: CoordinateBox | null = null;

export type StartupPlayerTileCalibration = {
  windowBounds: ScreenCaptureBounds;
  captureBounds: ScreenCaptureBounds;
  windowsScalePercent: number;
  playerTile: WorldTile | null;
  coordinateLine: string | null;
  coordinateBox: { x: number; y: number; width: number; height: number } | null;
  coordinateReadSource: CoordinateReadSource;
  coordinateReadAttempts: string[];
  coordinateDebugPath: string | null;
  rejectedCoordinateLine: string | null;
  coordinateRejectReason: string | null;
  playerBox: PlayerBox | null;
  playerBoxScreenCenter: { x: number; y: number } | null;
  compassNorth: CompassNorthDetection | null;
  rawTilePx: number | null;
  tilePx: number;
  tilePxSource: "player-box" | "fallback";
};

export type StartupPlayerTileCalibrationOptions = {
  requireRuneLiteCoordinatePattern?: boolean;
  preferredCoordinateBox?: { x: number; y: number; width: number; height: number } | null;
  lockToPreferredCoordinateBox?: boolean;
  expectedTile?: Pick<WorldTile, "x" | "y" | "z"> | null;
  maxTileJump?: number;
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

function getCoordinateScale(windowsScalePercent: number): number {
  return Number.isFinite(windowsScalePercent) && windowsScalePercent > 0 ? windowsScalePercent / 100 : 1;
}

function clampCoordinateBox(bitmap: ScreenBitmap, box: CoordinateBox): CoordinateBox | null {
  const x = Math.max(0, Math.min(bitmap.width - 1, Math.round(box.x)));
  const y = Math.max(0, Math.min(bitmap.height - 1, Math.round(box.y)));
  const width = Math.max(1, Math.min(bitmap.width - x, Math.round(box.width)));
  const height = Math.max(1, Math.min(bitmap.height - y, Math.round(box.height)));
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function formatCoordinateBoxShort(box: CoordinateBox): string {
  return `${box.x},${box.y},${box.width}x${box.height}`;
}

function pushCoordinateBoxCandidate(
  candidates: StartupCoordinateBoxCandidate[],
  seen: Set<string>,
  bitmap: ScreenBitmap,
  candidate: StartupCoordinateBoxCandidate,
): void {
  const box = clampCoordinateBox(bitmap, candidate.box);
  if (!box) {
    return;
  }

  const key = `${candidate.source}:${box.x}:${box.y}:${box.width}:${box.height}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  candidates.push({
    ...candidate,
    box,
  });
}

function pushCoordinateBoxNeighborhood(
  candidates: StartupCoordinateBoxCandidate[],
  seen: Set<string>,
  bitmap: ScreenBitmap,
  source: StartupCoordinateBoxCandidate["source"],
  label: string,
  box: CoordinateBox,
): void {
  pushCoordinateBoxCandidate(candidates, seen, bitmap, { source, label, box });
  pushCoordinateBoxCandidate(candidates, seen, bitmap, {
    source,
    label: `${label}-expanded`,
    box: {
      x: box.x - 12,
      y: box.y - 10,
      width: box.width + 36,
      height: box.height + 34,
    },
  });
  pushCoordinateBoxCandidate(candidates, seen, bitmap, {
    source,
    label: `${label}-lower`,
    box: {
      x: box.x - 10,
      y: box.y + Math.round(box.height * 0.35),
      width: box.width + 42,
      height: Math.max(box.height, Math.round(box.height * 1.15)),
    },
  });
}

function buildStartupCoordinateBoxCandidates(
  bitmap: ScreenBitmap,
  windowsScalePercent: number,
  options: StartupPlayerTileCalibrationOptions,
): StartupCoordinateBoxCandidate[] {
  const candidates: StartupCoordinateBoxCandidate[] = [];
  const seen = new Set<string>();
  const scale = getCoordinateScale(windowsScalePercent);

  if (options.preferredCoordinateBox) {
    pushCoordinateBoxNeighborhood(candidates, seen, bitmap, "preferred-box", "preferred", options.preferredCoordinateBox);
  }

  if (lastSuccessfulCoordinateBox) {
    pushCoordinateBoxNeighborhood(candidates, seen, bitmap, "saved-box", "last-good", lastSuccessfulCoordinateBox);
  }

  for (const offset of STARTUP_COORDINATE_SHIFTED_Y_LOGICAL_OFFSETS) {
    const y = Math.round((STARTUP_COORDINATE_FALLBACK_Y_LOGICAL + offset) * scale);
    pushCoordinateBoxCandidate(candidates, seen, bitmap, {
      source: "fallback-box",
      label: `runelite-top-left-${offset}`,
      box: {
        x: Math.round(STARTUP_COORDINATE_FALLBACK_X_LOGICAL * scale),
        y,
        width: Math.round(STARTUP_COORDINATE_FALLBACK_WIDTH_LOGICAL * scale),
        height: Math.round(STARTUP_COORDINATE_FALLBACK_HEIGHT_LOGICAL * scale),
      },
    });
    pushCoordinateBoxCandidate(candidates, seen, bitmap, {
      source: "fallback-box",
      label: `runelite-top-left-compact-${offset}`,
      box: {
        x: Math.round(STARTUP_COORDINATE_FALLBACK_X_LOGICAL * scale),
        y,
        width: Math.round(STARTUP_COORDINATE_FALLBACK_COMPACT_WIDTH_LOGICAL * scale),
        height: Math.round(STARTUP_COORDINATE_FALLBACK_COMPACT_HEIGHT_LOGICAL * scale),
      },
    });
  }

  if (windowsScalePercent >= 115 && windowsScalePercent <= 135 && bitmap.width >= 1000 && bitmap.height >= 900) {
    pushCoordinateBoxCandidate(candidates, seen, bitmap, {
      source: "fallback-box",
      label: "observed-125",
      box: { x: 0, y: 218, width: 245, height: 132 },
    });
    pushCoordinateBoxCandidate(candidates, seen, bitmap, {
      source: "fallback-box",
      label: "observed-125-compact",
      box: { x: 0, y: 224, width: 190, height: 86 },
    });
  }

  return candidates;
}

function readKnownStartupCoordinateBox(
  bitmap: ScreenBitmap,
  windowsScalePercent: number,
  candidate: StartupCoordinateBoxCandidate,
  requireRuneLiteCoordinatePattern: boolean,
): OverlayBox | null {
  return readCoordinateOverlayBoxInKnownBounds(bitmap, candidate.box, windowsScalePercent, {
    allowCompactSingleLine: true,
    requireRuneLiteCoordinatePattern,
  });
}

function parseCandidateTile(box: OverlayBox | null): WorldTile | null {
  return box ? parseWorldTileFromMatchedLine(box.matchedLine) : null;
}

function isPlausibleStartupCoordinate(
  box: OverlayBox | null,
  options: StartupPlayerTileCalibrationOptions,
): boolean {
  const tile = parseCandidateTile(box);
  if (!tile || tile.z < 0 || tile.z > 3) {
    return false;
  }

  if (options.expectedTile && Number.isFinite(options.maxTileJump)) {
    return tileDistance(tile, options.expectedTile) <= (options.maxTileJump ?? 0);
  }

  return tile.x >= 1000 && tile.x <= 5000 && tile.y >= 2500 && tile.y <= 13000;
}

function readStartupCoordinateBoxFromBitmap(
  bitmap: ScreenBitmap,
  windowsScalePercent: number,
  options: StartupPlayerTileCalibrationOptions,
): StartupCoordinateRead {
  const attempts: string[] = [];
  const knownCandidates = buildStartupCoordinateBoxCandidates(bitmap, windowsScalePercent, options);

  for (const candidate of knownCandidates) {
    const strictBox = readKnownStartupCoordinateBox(bitmap, windowsScalePercent, candidate, true);
    const strictIsPlausible = isPlausibleStartupCoordinate(strictBox, options);
    attempts.push(
      `${candidate.source}:${candidate.label}:strict:${formatCoordinateBoxShort(candidate.box)}=${strictBox?.matchedLine ?? "none"}${strictBox && !strictIsPlausible ? ":rejected-plausibility" : ""}`,
    );
    if (strictBox && strictIsPlausible) {
      return { box: strictBox, source: candidate.source, attempts };
    }
  }

  for (const candidate of knownCandidates) {
    const relaxedBox = readKnownStartupCoordinateBox(bitmap, windowsScalePercent, candidate, false);
    const relaxedIsPlausible = isPlausibleStartupCoordinate(relaxedBox, options);
    attempts.push(
      `${candidate.source}:${candidate.label}:relaxed:${formatCoordinateBoxShort(candidate.box)}=${relaxedBox?.matchedLine ?? "none"}${relaxedBox && !relaxedIsPlausible ? ":rejected-plausibility" : ""}`,
    );
    if (relaxedBox && relaxedIsPlausible) {
      return { box: relaxedBox, source: candidate.source, attempts };
    }
  }

  if (!options.lockToPreferredCoordinateBox) {
    const detectedCoordinateBox = detectOverlayBoxInScreenshot(bitmap, windowsScalePercent, {
      allowCompactSingleLine: true,
      requireRuneLiteCoordinatePattern: options.requireRuneLiteCoordinatePattern,
    });
    const detectedIsPlausible = isPlausibleStartupCoordinate(detectedCoordinateBox, options);
    attempts.push(
      `detected-box:scan:strict=${detectedCoordinateBox?.matchedLine ?? "none"}${detectedCoordinateBox && !detectedIsPlausible ? ":rejected-plausibility" : ""}`,
    );
    if (detectedCoordinateBox && detectedIsPlausible) {
      return { box: detectedCoordinateBox, source: "detected-box", attempts };
    }

    const relaxedDetectedCoordinateBox = detectOverlayBoxInScreenshot(bitmap, windowsScalePercent, {
      allowCompactSingleLine: true,
      leftStripRatio: 0.35,
      requireRuneLiteCoordinatePattern: false,
    });
    const relaxedDetectedIsPlausible = isPlausibleStartupCoordinate(relaxedDetectedCoordinateBox, options);
    attempts.push(
      `relaxed-detected-box:scan:relaxed=${relaxedDetectedCoordinateBox?.matchedLine ?? "none"}${relaxedDetectedCoordinateBox && !relaxedDetectedIsPlausible ? ":rejected-plausibility" : ""}`,
    );
    if (relaxedDetectedCoordinateBox && relaxedDetectedIsPlausible) {
      return { box: relaxedDetectedCoordinateBox, source: "relaxed-detected-box", attempts };
    }
  }

  return { box: null, source: null, attempts };
}

function buildStartupCoordinateDebugPath(): string {
  const now = new Date();
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  return path.join(STARTUP_COORDINATE_DEBUG_DIR, `${stamp}-startup-coordinate-read-fail.png`);
}

function formatPlayerTile(playerTile: WorldTile | null): string {
  return playerTile ? `${playerTile.x},${playerTile.y},${playerTile.z}` : "unavailable";
}

function formatCoordinateLine(coordinateLine: string | null): string {
  return coordinateLine ? `'${coordinateLine}'` : "unavailable";
}

function tileDistance(a: Pick<WorldTile, "x" | "y" | "z">, b: Pick<WorldTile, "x" | "y" | "z">): number {
  if (a.z !== b.z) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function rejectImplausibleCoordinateRead(
  playerTile: WorldTile | null,
  coordinateLine: string | null,
  options: StartupPlayerTileCalibrationOptions,
): { playerTile: WorldTile | null; coordinateLine: string | null; rejectedCoordinateLine: string | null; rejectReason: string | null } {
  const maxTileJump = options.maxTileJump;
  const expectedTile = options.expectedTile;
  if (!playerTile || !coordinateLine || !expectedTile || !Number.isFinite(maxTileJump) || maxTileJump === undefined) {
    return {
      playerTile,
      coordinateLine,
      rejectedCoordinateLine: null,
      rejectReason: null,
    };
  }

  const distance = tileDistance(playerTile, expectedTile);
  if (distance <= maxTileJump) {
    return {
      playerTile,
      coordinateLine,
      rejectedCoordinateLine: null,
      rejectReason: null,
    };
  }

  return {
    playerTile: null,
    coordinateLine: null,
    rejectedCoordinateLine: coordinateLine,
    rejectReason: `jump=${distance} tile(s) expected=${expectedTile.x},${expectedTile.y},${expectedTile.z} max=${maxTileJump}`,
  };
}

function formatCoordinateBox(calibration: StartupPlayerTileCalibration): string {
  const box = calibration.coordinateBox;
  if (!box) {
    return "unavailable";
  }

  return `local=(${box.x},${box.y}) screen=(${calibration.captureBounds.x + box.x},${calibration.captureBounds.y + box.y}) size=${box.width}x${box.height}`;
}

function formatScreenBounds(bounds: ScreenCaptureBounds): string {
  return `${bounds.width}x${bounds.height}@${bounds.x},${bounds.y}`;
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

function formatCompassNorth(calibration: StartupPlayerTileCalibration): string {
  const compassNorth = calibration.compassNorth;
  if (!compassNorth) {
    return "unavailable";
  }

  return `vector=(${compassNorth.northVectorX.toFixed(2)},${compassNorth.northVectorY.toFixed(
    2,
  )}) confidence=${compassNorth.confidence.toFixed(2)} pixels=${compassNorth.pixelCount}`;
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

export function readStartupPlayerTileCalibration(
  window: Window,
  options: StartupPlayerTileCalibrationOptions = {},
): StartupPlayerTileCalibration | null {
  const logicalBounds = getLogicalWindowBounds(window);
  if (!logicalBounds) {
    return null;
  }

  const scaleFactor = getWindowsDisplayScaleFactor(logicalBounds);
  const captureBounds = resolveScreenCaptureBounds(toPhysicalBounds(logicalBounds, scaleFactor));
  const windowsScalePercent = Math.round(scaleFactor * 100);
  const bitmap = captureScreenBitmap(captureBounds);
  const coordinateRead = readStartupCoordinateBoxFromBitmap(bitmap, windowsScalePercent, options);
  const coordinateBox = coordinateRead.box;
  const coordinateReadSource = coordinateRead.source;
  const rawCoordinateLine = coordinateBox?.matchedLine ?? null;
  const rawPlayerTile = rawCoordinateLine ? parseWorldTileFromMatchedLine(rawCoordinateLine) : null;
  const coordinateValidation = rejectImplausibleCoordinateRead(rawPlayerTile, rawCoordinateLine, options);
  const coordinateLine = coordinateValidation.coordinateLine;
  const playerTile = coordinateValidation.playerTile;
  if (playerTile && coordinateBox) {
    lastSuccessfulCoordinateBox = {
      x: coordinateBox.x,
      y: coordinateBox.y,
      width: coordinateBox.width,
      height: coordinateBox.height,
    };
  }
  const coordinateDebugPath = playerTile ? null : buildStartupCoordinateDebugPath();
  if (coordinateDebugPath) {
    saveBitmap(bitmap, coordinateDebugPath);
  }
  const detectedPlayerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const compassNorth = detectCompassNorthDirection(bitmap, windowsScalePercent);
  const detectedRawTilePx = estimateRawTilePx(detectedPlayerBox);
  const playerBox = isTrustedRawTilePx(detectedRawTilePx) ? detectedPlayerBox : null;
  const rawTilePx = playerBox ? detectedRawTilePx : null;
  const tilePx = estimateTilePxFromPlayerBox(playerBox, {
    fallbackTilePx: STARTUP_TILE_PX_FALLBACK,
    minTilePx: STARTUP_TILE_PX_MIN,
    maxTilePx: STARTUP_TILE_PX_MAX,
  });

  return {
    windowBounds: logicalBounds,
    captureBounds,
    windowsScalePercent,
    playerTile,
    coordinateLine,
    coordinateBox: coordinateBox
      ? {
          x: coordinateBox.x,
          y: coordinateBox.y,
          width: coordinateBox.width,
          height: coordinateBox.height,
        }
      : null,
    coordinateReadSource,
    coordinateReadAttempts: coordinateRead.attempts,
    coordinateDebugPath,
    rejectedCoordinateLine: coordinateValidation.rejectedCoordinateLine,
    coordinateRejectReason: coordinateValidation.rejectReason,
    playerBox,
    playerBoxScreenCenter: playerBox
      ? {
          x: captureBounds.x + playerBox.centerX,
          y: captureBounds.y + playerBox.centerY,
        }
      : null,
    compassNorth,
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
    `coordinateBox=${formatCoordinateBox(calibration)}`,
    `coordinateSource=${calibration.coordinateReadSource ?? "unavailable"}`,
    `coordinateAttempts=${calibration.coordinateReadAttempts.join(" | ") || "none"}`,
    `coordinateDebug=${calibration.coordinateDebugPath ?? "none"}`,
    `coordinateRejected=${calibration.rejectedCoordinateLine ? `'${calibration.rejectedCoordinateLine}' reason=${calibration.coordinateRejectReason ?? "unknown"}` : "none"}`,
    `playerBox=${formatPlayerBox(calibration)}`,
    `compassNorth=${formatCompassNorth(calibration)}`,
    `tilePx=${calibration.tilePx}px`,
    `rawTilePx=${calibration.rawTilePx ?? "unavailable"}px`,
    `tilePxSource=${calibration.tilePxSource}`,
    `tilePxSafetyClamp=${STARTUP_TILE_PX_MIN}-${STARTUP_TILE_PX_MAX}px`,
    `window=${formatScreenBounds(calibration.windowBounds)}`,
    `capture=${formatScreenBounds(calibration.captureBounds)}`,
    `scale=${calibration.windowsScalePercent}%.`,
  ].join(" ");
}
