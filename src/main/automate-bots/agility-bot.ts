import { windowManager, Window } from "node-window-manager";
import { mouseClick, moveMouse, screen } from "robotjs";
import { setAutomateBotCurrentStep } from "../automateBotManager";
import { findColorShapesInBounds } from "../colorDetection";
import { Coordinate, Shape } from "../colorDetection.types";
import { AppState } from "../global-state";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import {
  TileReadResult,
  lastSegmentDebugLog,
  clearSegmentDebugLog,
  flushOcrDebugDirectory,
  readTileCoordinateFromOverlay,
  RobotBitmap,
  TileCoordinate,
} from "./shared/ocr-engine";
import { detectOverlayBoxInScreenshot, saveBitmapWithBox } from "./shared/coordinate-box-detector";
import { saveBitmap } from "./shared/save-bitmap";
import { initBotCoordinateDetection } from "./shared/init-bot";

export const AGILITY_BOT_ID = "agility";

// Debug mode: set to true to save OCR preprocessing screenshots on FAILED reads
const DEBUG_OCR_SCREENSHOTS = false;

const GAME_TICK_MS = 600;
const MIN_CLICK_INTERVAL_MS = 2000;
const CLICK_DELAY_MIN_MS = 100;
const CLICK_DELAY_MAX_MS = 500;
const TARGET_GREEN = { r: 0, g: 255, b: 0 };
const TARGET_MAGENTA = { r: 255, g: 0, b: 255 };
const STRICT_GREEN_TOLERANCE = 0;
const MIN_SHAPE_SIZE = 100;
const DEFAULT_EDGE_INSET_PX_MIN = 3;
const DEFAULT_EDGE_INSET_PX_MAX = 4;
const DEBUG_OVERLAY_WIDTH_RATIO = 0.25;
const DEBUG_OVERLAY_HEIGHT_RATIO = 0.25;
const OCR_STARTUP_WARMUP_MS = 700;

function isSameTile(a: TileCoordinate | null, b: TileCoordinate | null): boolean {
  if (!!a && !!b) return a.x === b.x && a.y === b.y && a.z === b.z;

  return a === b;
}

let isFaladorV2LoopRunning = false;
let faladorV2StartedAtMs: number | null = null;

function formatElapsedSinceStart(): string {
  if (faladorV2StartedAtMs === null) {
    return "+0ms";
  }

  const elapsedMs = Math.max(0, Date.now() - faladorV2StartedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = elapsedMs % 1000;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const mmm = String(milliseconds).padStart(3, "0");
  return `+${mm}:${ss}.${mmm}`;
}

function logWithDelta(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] ${message}`);
}

function warnWithDelta(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] ${message}`);
}

function errorWithDelta(message: string): void {
  logger.error(`[${formatElapsedSinceStart()}] ${message}`);
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleepWithAbort(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const intervalMs = 50;
    let elapsed = 0;

    const timer = setInterval(() => {
      elapsed += intervalMs;
      if (!AppState.automateBotRunning || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, intervalMs);
  });
}

function getPlayableBounds(window: Window): { x: number; y: number; width: number; height: number } | null {
  const bounds = window.getBounds();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height) - 50;

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function findStrictGreenShape(bounds: { x: number; y: number; width: number; height: number }): Shape | null {
  const strictShapes = findColorShapesInBounds(bounds, TARGET_GREEN, {
    tolerance: STRICT_GREEN_TOLERANCE,
    minShapeSize: MIN_SHAPE_SIZE,
    stepPx: 1,
    mergeGapPx: 0,
  });

  if (strictShapes.length === 0) {
    return null;
  }

  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;

  // Prefer shapes near center instead of preferring large areas.
  return strictShapes.sort((a, b) => {
    const aDx = a.center.x - boundsCenterX;
    const aDy = a.center.y - boundsCenterY;
    const bDx = b.center.x - boundsCenterX;
    const bDy = b.center.y - boundsCenterY;
    const aDistanceSquared = aDx * aDx + aDy * aDy;
    const bDistanceSquared = bDx * bDx + bDy * bDy;
    return aDistanceSquared - bDistanceSquared;
  })[0];
}

function findStrictMagentaShape(bounds: { x: number; y: number; width: number; height: number }): Shape | null {
  const shapes = findColorShapesInBounds(bounds, TARGET_MAGENTA, {
    tolerance: STRICT_GREEN_TOLERANCE,
    minShapeSize: MIN_SHAPE_SIZE,
    stepPx: 1,
    mergeGapPx: 0,
  });

  if (shapes.length === 0) {
    return null;
  }

  const boundsCenterX = bounds.x + bounds.width / 2;
  const boundsCenterY = bounds.y + bounds.height / 2;

  return shapes.sort((a, b) => {
    const aDx = a.center.x - boundsCenterX;
    const aDy = a.center.y - boundsCenterY;
    const bDx = b.center.x - boundsCenterX;
    const bDy = b.center.y - boundsCenterY;
    return aDx * aDx + aDy * aDy - (bDx * bDx + bDy * bDy);
  })[0];
}

function getRandomPointInsideShape(shape: Shape): Coordinate {
  const requestedInset = randomIntInclusive(DEFAULT_EDGE_INSET_PX_MIN, DEFAULT_EDGE_INSET_PX_MAX);
  const maxInsetX = Math.floor((shape.width - 1) / 2);
  const maxInsetY = Math.floor((shape.height - 1) / 2);
  const safeInset = Math.max(0, Math.min(requestedInset, maxInsetX, maxInsetY));

  const innerMinX = shape.minX + safeInset;
  const innerMaxX = shape.maxX - safeInset;
  const innerMinY = shape.minY + safeInset;
  const innerMaxY = shape.maxY - safeInset;

  const safeCoordinates = shape.coordinates.filter((point) => {
    return point.x >= innerMinX && point.x <= innerMaxX && point.y >= innerMinY && point.y <= innerMaxY;
  });

  if (safeCoordinates.length > 0) {
    return safeCoordinates[randomIntInclusive(0, safeCoordinates.length - 1)];
  }

  return {
    x: Math.round(shape.center.x),
    y: Math.round(shape.center.y),
  };
}

// ---------------------------------------------------------------------------
// Loop state — immutable record, updated functionally each tick
// ---------------------------------------------------------------------------

type LoopState = {
  readonly loopIndex: number;
  readonly lastClickAtMs: number | null;
  readonly lastClickedShapeType: "magenta" | "green" | null;
  readonly lastTile: TileCoordinate | null;
  readonly lastObservedTile: TileCoordinate | null;
  readonly tileStableSinceMs: number | null;
  readonly hasMoved: boolean;
};

const initialLoopState: LoopState = {
  loopIndex: 0,
  lastClickAtMs: null,
  lastClickedShapeType: null,
  lastTile: null,
  lastObservedTile: null,
  tileStableSinceMs: null,
  hasMoved: true,
};

// Pure: derive new tile-tracking state from a completed OCR read.
function applyTileRead(state: LoopState, tileRead: TileReadResult, now: number): LoopState {
  const { tile } = tileRead;
  if (!tile) {
    return { ...state, lastObservedTile: null, tileStableSinceMs: null };
  }
  const lastTile = isSameTile(state.lastTile, tile) ? state.lastTile : tile;
  const observedChanged = !isSameTile(state.lastObservedTile, tile);
  return {
    ...state,
    lastTile,
    lastObservedTile: observedChanged ? tile : state.lastObservedTile,
    tileStableSinceMs: observedChanged ? now : state.tileStableSinceMs,
    hasMoved: !isSameTile(state.lastTile, tile),
  };
}

// Pure: decide which color to target given current shapes and last-click history.
function resolveTargetColor(
  lastClickedShapeType: "magenta" | "green" | null,
  magentaShape: Shape | null,
  greenShape: Shape | null,
): "magenta" | "green" | null {
  if (magentaShape !== null) {
    if (lastClickedShapeType === "magenta") {
      return greenShape !== null ? "green" : null;
    }
    return "magenta";
  }
  return greenShape !== null ? "green" : null;
}

// Pure: how many ms of click cooldown remain (0 = ready).
function clickCooldownRemainingMs(lastClickAtMs: number | null, now: number): number {
  if (lastClickAtMs === null) return 0;
  return Math.max(0, MIN_CLICK_INTERVAL_MS - (now - lastClickAtMs));
}

// Pure: true when the tile has been stable long enough to allow a click.
function isTileReadyForClick(
  tile: TileCoordinate | null,
  lastObservedTile: TileCoordinate | null,
  tileStableSinceMs: number | null,
  now: number,
): boolean {
  if (!tile || tileStableSinceMs === null || !isSameTile(lastObservedTile, tile)) return false;
  return now - tileStableSinceMs >= GAME_TICK_MS;
}

// Pure: record that a click just happened.
function applyClick(state: LoopState, color: "magenta" | "green", now: number): LoopState {
  return { ...state, lastClickAtMs: now, lastClickedShapeType: color };
}

// ---------------------------------------------------------------------------
// Loop — threads LoopState through each tick; side effects are isolated here
// ---------------------------------------------------------------------------

async function runFaladorV2Loop(window: Window): Promise<void> {
  if (isFaladorV2LoopRunning) {
    logWithDelta("Automate Bot (Falador Roof Top V2): loop already running; skipping new start.");
    return;
  }

  isFaladorV2LoopRunning = true;
  setAutomateBotCurrentStep("falador-rooftop-v2-step-watch");

  try {
    // Initialize bot: verify RuneLite window and detect coordinates overlay
    const initResult = initBotCoordinateDetection();
    if (!initResult.ok) {
      logWithDelta(`Automate Bot (Agility): initialization failed - ${initResult.error}`);
      return;
    }

    logWithDelta(`Automate Bot (Agility): initialization successful - overlay detected at '${initResult.overlay?.matchedLine}'`);

    await sleepWithAbort(OCR_STARTUP_WARMUP_MS);

    let state: LoopState = initialLoopState;

    while (AppState.automateBotRunning) {
      const loopIndex = state.loopIndex + 1;
      state = { ...state, loopIndex };
      const tickStartedAt = Date.now();

      try {
        const bounds = getPlayableBounds(window);

        if (!bounds) {
          warnWithDelta(`Automate Bot (Agility): loop #${loopIndex} - invalid RuneLite bounds.`);
        } else {
          // --- OCR: tile ---
          const loopRawScreenshotPath = DEBUG_OCR_SCREENSHOTS ? `./ocr-debug/loop-${String(loopIndex).padStart(6, "0")}-raw.png` : null;
          const playerTile = readTileCoordinateFromOverlay(bounds, screen, loopRawScreenshotPath);

          state = applyTileRead(state, playerTile, Date.now());

          logWithDelta(
            `Automate Bot (Agility): loop #${loopIndex} - tile OCR raw='${playerTile.rawLine ?? ""}' parsed=${playerTile.tile?.x},${playerTile.tile?.y},${playerTile.tile?.z}.`,
          );

          if (state.hasMoved) {
            logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - player moved, skipping color detection and click logic.`);
            await sleepWithAbort(GAME_TICK_MS);
            continue;
          }

          // --- Color detection & target resolution ---
          const magentaShape = findStrictMagentaShape(bounds);
          const greenShape = findStrictGreenShape(bounds);

          const targetColor = resolveTargetColor(state.lastClickedShapeType, magentaShape, greenShape);

          if (!targetColor) {
            logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - no target shapes detected.`);
            await sleepWithAbort(GAME_TICK_MS);
            continue;
          }

          // --- Click gating (pure checks, async delays as side effects) ---
          if (!isTileReadyForClick(playerTile.tile, state.lastObservedTile, state.tileStableSinceMs, Date.now())) {
            logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - tile unavailable/unstable, waiting before click.`);
            await sleepWithAbort(GAME_TICK_MS);
            continue;
          }

          const cooldown = clickCooldownRemainingMs(state.lastClickAtMs, Date.now());
          if (cooldown > 0) {
            logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - click cooldown ${cooldown}ms.`);
            await sleepWithAbort(cooldown);
            if (!AppState.automateBotRunning) break;
          }

          const clickDelayMs = randomIntInclusive(CLICK_DELAY_MIN_MS, CLICK_DELAY_MAX_MS);
          await sleepWithAbort(clickDelayMs);
          if (!AppState.automateBotRunning) break;

          // Re-detect after delays to avoid clicking a stale position.
          const freshShape = targetColor === "magenta" ? findStrictMagentaShape(bounds) : findStrictGreenShape(bounds);
          if (!freshShape) {
            logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - ${targetColor} shape gone after delays, skipping click.`);
          } else {
            const clickPoint = getRandomPointInsideShape(freshShape);
            logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - clicking ${targetColor} at (${clickPoint.x},${clickPoint.y}).`);
            moveMouse(clickPoint.x, clickPoint.y);
            mouseClick("left", false);
            state = applyClick(state, targetColor, Date.now());
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorWithDelta(`Automate Bot (Agility): loop #${loopIndex} failed: ${message}`);
      }

      const waitToNextTickMs = Math.max(0, GAME_TICK_MS - (Date.now() - tickStartedAt));
      if (waitToNextTickMs > 0) {
        await sleepWithAbort(waitToNextTickMs);
      }
    }
  } finally {
    isFaladorV2LoopRunning = false;
    faladorV2StartedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onAgilityBotStart(): void {
  if (!isFaladorV2LoopRunning) {
    faladorV2StartedAtMs = Date.now();
  }
  logWithDelta("Automate Bot STARTED (Agility).");
  const window = getRuneLite();
  if (!window) {
    warnWithDelta("Automate Bot (Agility): RuneLite window not found.");
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();

  void runFaladorV2Loop(window);
}
