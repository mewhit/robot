import fs from "fs";
import path from "path";
import { screen as electronScreen } from "electron";
import { PNG } from "pngjs";
import { mouseClick, moveMouse } from "robotjs";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap, type ScreenCaptureBounds } from "../windowsScreenCapture";
import { RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID } from "./definitions";
import { runBotEngine, sleepWithAbort } from "./engine/bot-engine";
import {
  detectGuardianOfTheRiftUnchargedCellCount,
  type GuardianOfTheRiftUnchargedCellTemplate,
} from "./shared/guardian-of-the-rift-uncharged-cell-detector";
import type { RobotBitmap } from "./shared/ocr-engine";

type BotPhase = "pick-uncharged-cell" | "complete";
type EngineFunctionKey = "pickUnchargedCell";

type BotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  actionLockUntilMs: number;
  unchargedCellCount: number | null;
  lastPickupClickScreen: { x: number; y: number } | null;
  missingTargetTicks: number;
};

type TickCapture = {
  bitmap: RobotBitmap;
};

type RedPickupTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
  fillRatio: number;
  score: number;
};

type RedCandidate = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

type SearchBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Roi = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type YellowComponent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelCount: number;
};

const BOT_NAME = "Runecrafting - Guardian of the Rift";
const STEP_PICK_UNCHARGED_CELL_ID = `${RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID}-step-pick-uncharged-cell`;
const GAME_TICK_MS = 600;
const STARTUP_SETTLE_MS = 180;
const POST_CLICK_LOCK_TICKS = 3;
const TARGET_UNCHARGED_CELL_COUNT = 10;
const CLICK_SAFE_EDGE_MARGIN_PX = 3;
const PURE_RED_MIN_PIXEL_COUNT = 24;
const PURE_RED_MAX_COMPONENT_WIDTH_RATIO = 0.18;
const PURE_RED_MAX_COMPONENT_HEIGHT_RATIO = 0.18;
const TEN_CELL_TEMPLATE_YELLOW_OFFSET = { x: 7, y: 4 };
const MAX_TEN_CELL_CANDIDATE_ROIS = 16;

let isLoopRunning = false;
let startedAtMs: number | null = null;
let currentLogLoopIndex = 0;
let currentLogPhase: BotPhase | "startup" = "startup";

function formatElapsedSinceStart(): string {
  if (startedAtMs === null) {
    return "+0ms";
  }

  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const ms = String(elapsedMs % 1000).padStart(3, "0");
  return `+${mm}:${ss}.${ms}`;
}

function setCurrentLogLoopIndex(loopIndex: number): void {
  currentLogLoopIndex = Number.isFinite(loopIndex) && loopIndex >= 0 ? Math.floor(loopIndex) : 0;
}

function setCurrentLogPhase(phase: BotPhase | "startup" | null | undefined): void {
  if (phase === "startup") {
    currentLogPhase = "startup";
    return;
  }

  currentLogPhase = phase === "pick-uncharged-cell" || phase === "complete" ? phase : "startup";
}

function log(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] #${currentLogLoopIndex} [${currentLogPhase}] ${message}`);
}

function warn(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] #${currentLogLoopIndex} [${currentLogPhase}] ${message}`);
}

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }

  stopAutomateBot("bot");
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
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createInitialState(): BotState {
  return {
    loopIndex: 0,
    currentFunction: "pickUnchargedCell",
    phase: "pick-uncharged-cell",
    actionLockUntilMs: 0,
    unchargedCellCount: null,
    lastPickupClickScreen: null,
    missingTargetTicks: 0,
  };
}

function resolveUnchargedCellIconDirectory(): string {
  const relativePath = path.join("test-images", "icon", "guardin-of-the-rift", "uncharged-cell");
  const candidates = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(__dirname, "..", "..", "..", relativePath),
    path.resolve(__dirname, "..", "..", "..", "..", relativePath),
  ];

  const existingDirectory = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
  return existingDirectory ?? candidates[0];
}

function loadPngBitmap(filePath: string): RobotBitmap {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const png = (PNG as unknown as { sync: { read: (buffer: Buffer) => PNG } }).sync.read(fs.readFileSync(filePath));
  const image = Buffer.alloc(png.width * png.height * 4);

  for (let index = 0; index < png.data.length; index += 4) {
    image[index] = png.data[index + 2];
    image[index + 1] = png.data[index + 1];
    image[index + 2] = png.data[index];
    image[index + 3] = png.data[index + 3];
  }

  return {
    width: png.width,
    height: png.height,
    byteWidth: png.width * 4,
    bytesPerPixel: 4,
    image,
  };
}

function loadTenUnchargedCellTemplate(): GuardianOfTheRiftUnchargedCellTemplate {
  return {
    count: TARGET_UNCHARGED_CELL_COUNT,
    bitmap: loadPngBitmap(path.join(resolveUnchargedCellIconDirectory(), `${TARGET_UNCHARGED_CELL_COUNT}.png`)),
  };
}

function isPureRuneLiteRedPixel(r: number, g: number, b: number): boolean {
  return r >= 245 && g <= 20 && b <= 20;
}

function isItemStackYellowPixel(r: number, g: number, b: number): boolean {
  return r >= 145 && g >= 105 && g <= 235 && b <= 95 && r - b >= 85 && g - b >= 65;
}

function resolveRedPickupSearchBounds(bitmap: RobotBitmap): SearchBounds {
  return {
    minX: clamp(Math.round(bitmap.width * 0.04), 0, bitmap.width - 1),
    minY: clamp(Math.round(bitmap.height * 0.05), 0, bitmap.height - 1),
    maxX: clamp(Math.round(bitmap.width * 0.78), 0, bitmap.width - 1),
    maxY: clamp(Math.round(bitmap.height * 0.78), 0, bitmap.height - 1),
  };
}

function buildPureRedMask(bitmap: RobotBitmap, bounds: SearchBounds): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isPureRuneLiteRedPixel(r, g, b)) {
        mask[y * bitmap.width + x] = 1;
      }
    }
  }

  return mask;
}

function collectRedCandidates(mask: Uint8Array, bitmap: RobotBitmap): RedCandidate[] {
  const remaining = mask.slice();
  const candidates: RedCandidate[] = [];

  for (let startIndex = 0; startIndex < remaining.length; startIndex += 1) {
    if (!remaining[startIndex]) {
      continue;
    }

    const stack = [startIndex];
    remaining[startIndex] = 0;

    let minX = bitmap.width;
    let minY = bitmap.height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) {
        break;
      }

      const x = index % bitmap.width;
      const y = Math.floor(index / bitmap.width);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixelCount += 1;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }

          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= bitmap.width || nextY >= bitmap.height) {
            continue;
          }

          const nextIndex = nextY * bitmap.width + nextX;
          if (!remaining[nextIndex]) {
            continue;
          }

          remaining[nextIndex] = 0;
          stack.push(nextIndex);
        }
      }
    }

    candidates.push({ minX, minY, maxX, maxY, pixelCount });
  }

  return candidates;
}

function toRedPickupTarget(candidate: RedCandidate, bitmap: RobotBitmap): RedPickupTarget | null {
  const width = candidate.maxX - candidate.minX + 1;
  const height = candidate.maxY - candidate.minY + 1;
  const maxComponentWidth = Math.max(24, Math.round(bitmap.width * PURE_RED_MAX_COMPONENT_WIDTH_RATIO));
  const maxComponentHeight = Math.max(24, Math.round(bitmap.height * PURE_RED_MAX_COMPONENT_HEIGHT_RATIO));

  if (
    candidate.pixelCount < PURE_RED_MIN_PIXEL_COUNT ||
    width <= 0 ||
    height <= 0 ||
    width > maxComponentWidth ||
    height > maxComponentHeight
  ) {
    return null;
  }

  const fillRatio = candidate.pixelCount / (width * height);
  const centerX = Math.round(candidate.minX + width / 2);
  const centerY = Math.round(candidate.minY + height / 2);
  const centerDistanceX = Math.abs(centerX - bitmap.width * 0.42);
  const centerDistanceY = Math.abs(centerY - bitmap.height * 0.45);
  const normalizedDistance =
    Math.sqrt(centerDistanceX * centerDistanceX + centerDistanceY * centerDistanceY) /
    Math.sqrt(bitmap.width * bitmap.width + bitmap.height * bitmap.height);
  const score = candidate.pixelCount + width * height * 0.12 + fillRatio * 90 - normalizedDistance * 160;

  return {
    x: candidate.minX,
    y: candidate.minY,
    width,
    height,
    centerX,
    centerY,
    pixelCount: candidate.pixelCount,
    fillRatio,
    score,
  };
}

function detectBestRedPickupTarget(bitmap: RobotBitmap): RedPickupTarget | null {
  const bounds = resolveRedPickupSearchBounds(bitmap);
  const mask = buildPureRedMask(bitmap, bounds);
  const targets = collectRedCandidates(mask, bitmap)
    .map((candidate) => toRedPickupTarget(candidate, bitmap))
    .filter((target): target is RedPickupTarget => target !== null)
    .sort((a, b) => b.score - a.score);

  return targets[0] ?? null;
}

function clickScreenPoint(screenX: number, screenY: number, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
  const requestedX = Math.round(screenX);
  const requestedY = Math.round(screenY);
  const safeX = clamp(
    requestedX,
    captureBounds.x + CLICK_SAFE_EDGE_MARGIN_PX,
    captureBounds.x + captureBounds.width - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
  );
  const safeY = clamp(
    requestedY,
    captureBounds.y + CLICK_SAFE_EDGE_MARGIN_PX,
    captureBounds.y + captureBounds.height - 1 - CLICK_SAFE_EDGE_MARGIN_PX,
  );

  moveMouse(safeX, safeY);
  mouseClick("left", false);
  return { x: safeX, y: safeY };
}

function deadlineFromNowTicks(ticks: number, nowMs: number): number {
  return nowMs + Math.max(0, ticks) * GAME_TICK_MS;
}

function resolveInventoryItemSearchRoi(bitmap: RobotBitmap): Roi {
  return {
    x: Math.round(bitmap.width * 0.72),
    y: Math.round(bitmap.height * 0.48),
    width: Math.round(bitmap.width * 0.28),
    height: Math.round(bitmap.height * 0.45),
  };
}

function clampRoi(bitmap: RobotBitmap, roi: Roi): Roi {
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

function buildYellowMask(bitmap: RobotBitmap, roi: Roi): Uint8Array {
  const mask = new Uint8Array(bitmap.width * bitmap.height);
  const bounds = clampRoi(bitmap, roi);

  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (isItemStackYellowPixel(r, g, b)) {
        mask[y * bitmap.width + x] = 1;
      }
    }
  }

  return mask;
}

function collectYellowComponents(mask: Uint8Array, bitmap: RobotBitmap, roi: Roi): YellowComponent[] {
  const remaining = mask.slice();
  const bounds = clampRoi(bitmap, roi);
  const components: YellowComponent[] = [];

  for (let startY = bounds.y; startY < bounds.y + bounds.height; startY += 1) {
    for (let startX = bounds.x; startX < bounds.x + bounds.width; startX += 1) {
      const startIndex = startY * bitmap.width + startX;
      if (!remaining[startIndex]) {
        continue;
      }

      const stack = [startIndex];
      remaining[startIndex] = 0;

      let minX = bitmap.width;
      let minY = bitmap.height;
      let maxX = -1;
      let maxY = -1;
      let pixelCount = 0;

      while (stack.length > 0) {
        const index = stack.pop();
        if (index === undefined) {
          break;
        }

        const x = index % bitmap.width;
        const y = Math.floor(index / bitmap.width);

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        pixelCount += 1;

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }

            const nextX = x + dx;
            const nextY = y + dy;
            if (
              nextX < bounds.x ||
              nextY < bounds.y ||
              nextX >= bounds.x + bounds.width ||
              nextY >= bounds.y + bounds.height
            ) {
              continue;
            }

            const nextIndex = nextY * bitmap.width + nextX;
            if (!remaining[nextIndex]) {
              continue;
            }

            remaining[nextIndex] = 0;
            stack.push(nextIndex);
          }
        }
      }

      components.push({ minX, minY, maxX, maxY, pixelCount });
    }
  }

  return components;
}

function buildTenCellCandidateRois(bitmap: RobotBitmap): Roi[] {
  const inventoryRoi = resolveInventoryItemSearchRoi(bitmap);
  const components = collectYellowComponents(buildYellowMask(bitmap, inventoryRoi), bitmap, inventoryRoi)
    .filter((component) => {
      const width = component.maxX - component.minX + 1;
      const height = component.maxY - component.minY + 1;
      return component.pixelCount >= 2 && width <= 28 && height <= 24;
    })
    .sort((a, b) => b.pixelCount - a.pixelCount)
    .slice(0, MAX_TEN_CELL_CANDIDATE_ROIS);

  return components.map((component) =>
    clampRoi(bitmap, {
      x: component.minX - TEN_CELL_TEMPLATE_YELLOW_OFFSET.x - 8,
      y: component.minY - TEN_CELL_TEMPLATE_YELLOW_OFFSET.y - 8,
      width: 72,
      height: 64,
    }),
  );
}

function runPickUnchargedCellTick(
  state: BotState,
  nowMs: number,
  tickCapture: TickCapture,
  captureBounds: ScreenCaptureBounds,
  unchargedCellTemplates: GuardianOfTheRiftUnchargedCellTemplate[],
): BotState {
  const tenCellCandidateRois = buildTenCellCandidateRois(tickCapture.bitmap);
  const unchargedCells = detectGuardianOfTheRiftUnchargedCellCount(
    tickCapture.bitmap,
    unchargedCellTemplates,
    tenCellCandidateRois,
  );
  const unchargedCellCount = unchargedCells.count;

  if (unchargedCells.hasTenUnchargedCells) {
    log(`Validated ${TARGET_UNCHARGED_CELL_COUNT} uncharged cells in inventory. Stopping before step two.`);
    stopAutomateBot("bot");
    return {
      ...state,
      phase: "complete",
      unchargedCellCount,
      actionLockUntilMs: Number.POSITIVE_INFINITY,
    };
  }

  if (nowMs < state.actionLockUntilMs) {
    return {
      ...state,
      unchargedCellCount,
    };
  }

  const target = detectBestRedPickupTarget(tickCapture.bitmap);
  if (!target) {
    const missingTargetTicks = state.missingTargetTicks + 1;
    if (missingTargetTicks === 1 || missingTargetTicks % 5 === 0) {
      warn(
        `Uncharged cells=${unchargedCellCount ?? "unknown"}; no pure red FFFF0000 pickup marker found in the scene.`,
      );
    }

    return {
      ...state,
      unchargedCellCount,
      missingTargetTicks,
      actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
    };
  }

  const clicked = clickScreenPoint(captureBounds.x + target.centerX, captureBounds.y + target.centerY, captureBounds);
  log(
    `Uncharged cells=${unchargedCellCount ?? "unknown"}; clicked red pickup marker at (${clicked.x},${clicked.y}) local=(${target.centerX},${target.centerY}) pixels=${target.pixelCount}.`,
  );

  return {
    ...state,
    unchargedCellCount,
    lastPickupClickScreen: clicked,
    missingTargetTicks: 0,
    actionLockUntilMs: deadlineFromNowTicks(POST_CLICK_LOCK_TICKS, nowMs),
  };
}

async function runLoop(
  captureBounds: ScreenCaptureBounds,
  unchargedCellTemplates: GuardianOfTheRiftUnchargedCellTemplate[],
): Promise<void> {
  if (isLoopRunning) {
    log("Loop already running.");
    return;
  }

  isLoopRunning = true;
  setAutomateBotCurrentStep(STEP_PICK_UNCHARGED_CELL_ID);

  try {
    await runBotEngine<BotState, EngineFunctionKey, TickCapture>({
      tickMs: GAME_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState,
      captureTick: () => ({
        bitmap: captureScreenBitmap(captureBounds),
      }),
      functions: {
        pickUnchargedCell: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "pick-uncharged-cell"
            ? runPickUnchargedCellTick(state, nowMs, tickCapture, captureBounds, unchargedCellTemplates)
            : state;
        },
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[${formatElapsedSinceStart()}] #${state.loopIndex} [${state.phase}] tick error - ${message}`);
      },
    });
  } finally {
    isLoopRunning = false;
    startedAtMs = null;
    setCurrentLogLoopIndex(0);
    setCurrentLogPhase(null);
    setAutomateBotCurrentStep(null);
  }
}

export function onRunecraftingGuardianOfTheRiftBotStart(): void {
  setCurrentLogLoopIndex(0);
  setCurrentLogPhase("startup");

  if (!isLoopRunning) {
    startedAtMs = Date.now();
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Config: engineTick=${GAME_TICK_MS}ms, first-step=pick red FFFF0000 uncharged-cell marker, stop-at=${TARGET_UNCHARGED_CELL_COUNT} uncharged cells.`,
  );

  const window = getRuneLite();
  if (!window) {
    const message = `${BOT_NAME} could not start because the RuneLite window was not found.`;
    warn(message);
    notifyUserAndStop(message);
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();

  const windowBounds = window.getBounds();
  const logicalBounds: ScreenCaptureBounds = {
    x: Number(windowBounds.x),
    y: Number(windowBounds.y),
    width: Number(windowBounds.width),
    height: Number(windowBounds.height),
  };

  if (![logicalBounds.x, logicalBounds.y, logicalBounds.width, logicalBounds.height].every(Number.isFinite)) {
    const message = "Cannot start - invalid RuneLite window bounds.";
    warn(message);
    notifyUserAndStop(message);
    return;
  }

  if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
    const message = "Cannot start - RuneLite window has zero size.";
    warn(message);
    notifyUserAndStop(message);
    return;
  }

  const scaleFactor = getWindowsDisplayScaleFactor(logicalBounds);
  const captureBounds = toPhysicalBounds(logicalBounds, scaleFactor);

  void (async () => {
    try {
      await sleepWithAbort(STARTUP_SETTLE_MS, () => AppState.automateBotRunning);
      const unchargedCellTemplates = [loadTenUnchargedCellTemplate()];

      if (!AppState.automateBotRunning) {
        return;
      }

      await runLoop(captureBounds, unchargedCellTemplates);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Startup failed: ${message}`);
      notifyUserAndStop(message);
    }
  })();
}
