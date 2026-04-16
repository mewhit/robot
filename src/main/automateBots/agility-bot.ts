import { Window } from "node-window-manager";
import * as robotModule from "robotjs";
import { mouseClick, moveMouse } from "robotjs";
import { setAutomateBotCurrentStep } from "../automateBotManager";
import { findColorShapesInBounds } from "../colorDetection";
import { Coordinate, Shape } from "../colorDetection.types";
import { AppState } from "../global-state";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import {
  readTileCoordinateFromOverlay,
  readGameStatsFromOverlay,
  TileCoordinate,
  TileReadResult,
  GameStatsReadResult,
  debugSaveAllStages,
  RobotBitmap,
} from "./ocr-engine";

export const AGILITY_BOT_ID = "agility";

// Debug mode: set to true to save OCR preprocessing screenshots on FAILED reads
const DEBUG_OCR_SCREENSHOTS = true;

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

type RobotScreenApi = {
  screen: {
    capture: (x: number, y: number, width: number, height: number) => RobotBitmap;
  };
};

function isSameTile(a: TileCoordinate | null, b: TileCoordinate | null): boolean {
  if (!a || !b) {
    return false;
  }

  return a.x === b.x && a.y === b.y && a.z === b.z;
}

const robotScreen = ((robotModule as unknown as { default?: RobotScreenApi }).default ??
  robotModule) as unknown as RobotScreenApi;

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

async function runFaladorV2Loop(window: Window): Promise<void> {
  if (isFaladorV2LoopRunning) {
    logWithDelta("Automate Bot (Falador Roof Top V2): loop already running; skipping new start.");
    return;
  }

  isFaladorV2LoopRunning = true;
  setAutomateBotCurrentStep("falador-rooftop-v2-step-watch");
  let loopIndex = 0;
  let lastClickAtMs: number | null = null;
  let lastClickedShapeType: "magenta" | "green" | null = null;
  let lastTile: TileCoordinate | null = null;
  let lastObservedTile: TileCoordinate | null = null;
  let tileStableSinceMs: number | null = null;

  try {
    while (AppState.automateBotRunning) {
      loopIndex += 1;
      const tickStartedAt = Date.now();
      try {
        const bounds = getPlayableBounds(window);

        if (!bounds) {
          warnWithDelta(`Automate Bot (Falador Roof Top V2): loop #${loopIndex} - invalid RuneLite bounds.`);
        } else {
          const tileRead = readTileCoordinateFromOverlay(bounds, robotScreen);
          const tile = tileRead.tile;
          if (tile) {
            logWithDelta(
              `Automate Bot (Agility): loop #${loopIndex} - tile OCR raw='${tileRead.rawLine ?? ""}' parsed=${tile.x},${tile.y},${tile.z}.`,
            );
            const tileChanged = !isSameTile(lastTile, tile);
            if (tileChanged) {
              logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - player tile ${tile.x},${tile.y},${tile.z}.`);
              lastTile = tile;
            }

            if (!isSameTile(lastObservedTile, tile)) {
              lastObservedTile = tile;
              tileStableSinceMs = Date.now();
            }
          } else {
            if (tileRead.rawLine) {
              logWithDelta(
                `Automate Bot (Agility): loop #${loopIndex} - tile OCR failed (no tile match), raw='${tileRead.rawLine}'. Saving debug screenshots...`,
              );
              // Re-capture and save debug screenshots on OCR failure
              const debugTileRead = readTileCoordinateFromOverlay(bounds, robotScreen);
            } else {
              logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - tile OCR failed (no tile match).`);
            }
            lastObservedTile = null;
            tileStableSinceMs = null;
          }

          // Read game stats (laps, goal progress, etc.)
          const statsRead = readGameStatsFromOverlay(
            bounds,
            robotScreen,
            DEBUG_OVERLAY_WIDTH_RATIO,
            DEBUG_OVERLAY_HEIGHT_RATIO,
            false, // Only enable debug on demand
          );
          if (statsRead.stats.totalLaps !== null || statsRead.stats.lapsUntilGoal !== null) {
            if (statsRead.stats.totalLaps !== null) {
              logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - Total Laps: ${statsRead.stats.totalLaps}`);
            }
            if (statsRead.stats.lapsUntilGoal !== null) {
              logWithDelta(
                `Automate Bot (Agility): loop #${loopIndex} - Laps Until Goal: ${statsRead.stats.lapsUntilGoal}`,
              );
            }
          }

          const magentaShape = findStrictMagentaShape(bounds);
          const greenShape = findStrictGreenShape(bounds);

          // Priority: magenta first. If magenta is persistent (still detected after we just clicked it),
          // click green first to let the game progress, then retry magenta on the next iteration.
          let targetColor: "magenta" | "green" | null = null;
          if (magentaShape !== null) {
            if (lastClickedShapeType === "magenta") {
              if (greenShape !== null) {
                targetColor = "green";
                logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - magenta persistent, clicking green first.`);
              } else {
                logWithDelta(
                  `Automate Bot (Agility): loop #${loopIndex} - magenta persistent, no green available, skipping.`,
                );
              }
            } else {
              targetColor = "magenta";
              logWithDelta(
                `Automate Bot (Agility): loop #${loopIndex} - magenta shape found ` +
                  `(area=${magentaShape.area}, width=${magentaShape.width}, height=${magentaShape.height}).`,
              );
            }
          } else if (greenShape !== null) {
            targetColor = "green";
            logWithDelta(
              `Automate Bot (Agility): loop #${loopIndex} - green shape found ` +
                `(area=${greenShape.area}, width=${greenShape.width}, height=${greenShape.height}).`,
            );
          } else {
            logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - no target shape found.`);
          }

          if (targetColor !== null) {
            let canAttemptClick = true;
            if (!tile || tileStableSinceMs === null || !isSameTile(lastObservedTile, tile)) {
              logWithDelta(
                `Automate Bot (Agility): loop #${loopIndex} - tile unavailable/unstable, waiting before click.`,
              );
              canAttemptClick = false;
            }

            if (canAttemptClick && tileStableSinceMs !== null) {
              const stableForMs = Date.now() - tileStableSinceMs;
              if (stableForMs < GAME_TICK_MS) {
                const remainingStableMs = GAME_TICK_MS - stableForMs;
                logWithDelta(
                  `Automate Bot (Agility): loop #${loopIndex} - waiting ${remainingStableMs}ms for 1-tick tile stability.`,
                );
                canAttemptClick = false;
              }
            }

            if (canAttemptClick && lastClickAtMs !== null) {
              const elapsedSinceLastClickMs = Date.now() - lastClickAtMs;
              if (elapsedSinceLastClickMs < MIN_CLICK_INTERVAL_MS) {
                const remainingCooldownMs = MIN_CLICK_INTERVAL_MS - elapsedSinceLastClickMs;
                logWithDelta(`Automate Bot (Agility): loop #${loopIndex} - click cooldown ${remainingCooldownMs}ms.`);
                await sleepWithAbort(remainingCooldownMs);
                if (!AppState.automateBotRunning) {
                  break;
                }
              }
            }

            if (canAttemptClick) {
              const clickDelayMs = randomIntInclusive(CLICK_DELAY_MIN_MS, CLICK_DELAY_MAX_MS);
              await sleepWithAbort(clickDelayMs);
              if (!AppState.automateBotRunning) {
                break;
              }

              // Re-detect after all delays to avoid clicking a stale position.
              const freshShape =
                targetColor === "magenta" ? findStrictMagentaShape(bounds) : findStrictGreenShape(bounds);
              if (!freshShape) {
                logWithDelta(
                  `Automate Bot (Agility): loop #${loopIndex} - ${targetColor} shape gone after delays, skipping click.`,
                );
              } else {
                const clickPoint = getRandomPointInsideShape(freshShape);
                logWithDelta(
                  `Automate Bot (Agility): loop #${loopIndex} - clicking ${targetColor} at (${clickPoint.x},${clickPoint.y}).`,
                );
                moveMouse(clickPoint.x, clickPoint.y);
                mouseClick("left", false);
                lastClickAtMs = Date.now();
                lastClickedShapeType = targetColor;
              }
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorWithDelta(`Automate Bot (Agility): loop #${loopIndex} failed: ${message}`);
      }

      const elapsedMs = Date.now() - tickStartedAt;
      const waitToNextTickMs = Math.max(0, GAME_TICK_MS - elapsedMs);
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

  window.restore();
  window.bringToTop();

  void runFaladorV2Loop(window);
}
