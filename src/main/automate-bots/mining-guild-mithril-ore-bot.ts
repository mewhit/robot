import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { keyToggle, mouseClick, moveMouse } from "robotjs";
import { screen as electronScreen } from "electron";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap } from "../windowsScreenCapture";
import { MINING_GUILD_MITHRIL_ORE_BOT_ID } from "./definitions";
import { runBotEngine, sleepWithAbort } from "./engine/bot-engine";
import { detectInventoryCount } from "./shared/inventory-count-detector";
import { detectBankDepositIconWithOrb } from "./shared/bank-deposit-orb-detector";
import { detectMiningBoxStatusInScreenshot } from "./shared/mining-box-status-detector";
import { detectMithrilOreBoxesInScreenshot, MithrilOreBox } from "./shared/mithril-ore-detector";
import { RobotBitmap } from "./shared/ocr-engine";
import { detectBestPlayerBoxInScreenshot, PlayerBox } from "./shared/player-box-detector";

const BOT_NAME = "Mining Guild Mithril Ore";
const DEBUG_DIR = "ocr-debug";
const GAME_TICK_MS = 600;
const CAMERA_PITCH_HOLD_MS = 2400;
const NORTH_KEY_HOLD_MS = 100;
const STARTUP_SETTLE_MS = 180;
const ORE_RECLICK_COOLDOWN_TICKS = 10;
const MOVE_MAX_WAIT_TICKS = 18;
const MOVE_PLAYER_SPEED_TILES_PER_TICK = 2;
const MOVE_TILE_PX_FALLBACK = 64;
const MOVE_TILE_PX_MIN = 24;
const MOVE_TILE_PX_MAX = 96;
const MOVE_WAIT_EXTRA_TICKS = 1;
const BANK_MOVE_MIN_TICKS = 6;
const BANK_MOVE_TICK_MULTIPLIER = 2.5;
const MOVE_EARLY_COMPLETE_MAX_REMAINING_TICKS = 1;
const MOVE_EARLY_COMPLETE_RADIUS_TILES = 1.2;
const SAME_ORE_MATCH_RADIUS_PX = 56;
const TARGET_ORE_MATCH_RADIUS_PX = 110;
const PLAYER_ORE_MAX_EDGE_DISTANCE_PX = 500;
const INVENTORY_EMPTY_COUNT = 0;
const INVENTORY_FULL_COUNT = 28;
const BANK_DEPOSIT_ORB_REFERENCE_ICON = "test-images/icon/bank-deposit/bank-deposit-icon.png";
const BANKING_MAGENTA_MIN_PIXELS = 120;
const BANKING_MOVE_COOLDOWN_TICKS = 2;
const BANK_ORB_FIND_RETRY_MAX = 3;
const EAST_RECOVERY_STEP_COOLDOWN_TICKS = 3;
const DIRECTIONAL_STEP_Y_RATIO = 0.6;

const TARGET_MAGENTA = { r: 255, g: 0, b: 255 };

type ScreenCaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BotPhase = "searching" | "moving" | "mining" | "banking-search-magenta" | "banking-find-orb";
type MoveDestinationPhase = "mining" | "banking-search-magenta" | "banking-find-orb";
type EngineFunctionKey = "searchOre" | "move" | "mine" | "bank";

type WalkDirection = "west" | "east";

type MagentaBlob = {
  centerX: number;
  centerY: number;
  pixelCount: number;
  width: number;
  height: number;
};

type BotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  actionLockUntilMs: number;
  moveDeadlineMs: number;
  lastClickedOreScreen: { x: number; y: number } | null;
  targetScreen: { x: number; y: number } | null;
  moveWaitTicks: number;
  moveDestinationPhase: MoveDestinationPhase;
  inventoryCount: number | null;
  bankOrbClickCount: number;
  bankDepositScreen: { x: number; y: number } | null;
  bankOrbFindAttemptCount: number;
};

type TickCapture = {
  bitmap: RobotBitmap;
};

let isLoopRunning = false;
let startedAtMs: number | null = null;
let currentLogLoopIndex = 0;
let currentLogPhase: BotPhase | "startup" = "startup";
let bankDepositOrbReferenceBitmap: RobotBitmap | null = null;
let bankDepositOrbReferenceLoadAttempted = false;

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

function setCurrentLogPhase(phase: BotPhase | null | undefined): void {
  if (
    phase === "searching" ||
    phase === "moving" ||
    phase === "mining" ||
    phase === "banking-search-magenta" ||
    phase === "banking-find-orb"
  ) {
    currentLogPhase = phase;
    return;
  }

  currentLogPhase = "startup";
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

function moveMouseToWindowCenter(bounds: ScreenCaptureBounds): void {
  const centerX = Math.round(bounds.x + bounds.width / 2);
  const centerY = Math.round(bounds.y + bounds.height / 2);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return;
  }

  moveMouse(centerX, centerY);
}

async function pressKeyForMs(key: string, holdMs: number): Promise<void> {
  if (typeof keyToggle !== "function") {
    warn(`RobotJS keyToggle unavailable; skipping key '${key}'.`);
    return;
  }

  keyToggle(key, "down");
  try {
    await sleepWithAbort(holdMs, () => AppState.automateBotRunning);
  } finally {
    keyToggle(key, "up");
  }
}

async function prepareCamera(logicalBounds: ScreenCaptureBounds): Promise<void> {
  moveMouseToWindowCenter(logicalBounds);
  log(`Startup camera prep: hold W for ${CAMERA_PITCH_HOLD_MS}ms, then north.`);
  await pressKeyForMs("w", CAMERA_PITCH_HOLD_MS);
  if (!AppState.automateBotRunning) {
    return;
  }

  await sleepWithAbort(STARTUP_SETTLE_MS, () => AppState.automateBotRunning);
  await pressKeyForMs("n", NORTH_KEY_HOLD_MS);
  await sleepWithAbort(STARTUP_SETTLE_MS, () => AppState.automateBotRunning);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function distanceToBox(anchorX: number, anchorY: number, box: { x: number; y: number; width: number; height: number }): number {
  const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
  const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
  return axisDistance(anchorX - nearestX, anchorY - nearestY);
}

function isSameOreScreenTarget(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return axisDistance(a.x - b.x, a.y - b.y) <= SAME_ORE_MATCH_RADIUS_PX;
}

function selectNearestMithrilOre(
  boxes: MithrilOreBox[],
  captureSize: { width: number; height: number },
  playerAnchorInCapture: { x: number; y: number } | null,
): MithrilOreBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = playerAnchorInCapture?.x ?? captureSize.width / 2;
  const anchorY = playerAnchorInCapture?.y ?? captureSize.height / 2;
  const nearbyBoxes = boxes.filter((box) => distanceToBox(anchorX, anchorY, box) <= PLAYER_ORE_MAX_EDGE_DISTANCE_PX);
  const candidates = nearbyBoxes.length > 0 ? nearbyBoxes : boxes;

  let best: MithrilOreBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistanceSquared = Number.POSITIVE_INFINITY;

  for (const box of candidates) {
    const edgeDistance = distanceToBox(anchorX, anchorY, box);
    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistanceSquared = centerDx * centerDx + centerDy * centerDy;

    if (edgeDistance < bestEdgeDistance) {
      bestEdgeDistance = edgeDistance;
      bestCenterDistanceSquared = centerDistanceSquared;
      best = box;
      continue;
    }

    if (Math.abs(edgeDistance - bestEdgeDistance) >= 0.5) {
      continue;
    }

    if (centerDistanceSquared < bestCenterDistanceSquared) {
      bestCenterDistanceSquared = centerDistanceSquared;
      best = box;
      continue;
    }

    if (Math.abs(centerDistanceSquared - bestCenterDistanceSquared) < 0.5 && best && box.score > best.score) {
      best = box;
    }
  }

  return best;
}

function hasOreNearAnchor(
  boxes: MithrilOreBox[],
  anchorInCapture: { x: number; y: number } | null,
  maxDistancePx: number = PLAYER_ORE_MAX_EDGE_DISTANCE_PX,
): boolean {
  if (!anchorInCapture) {
    return false;
  }

  return boxes.some((box) => distanceToBox(anchorInCapture.x, anchorInCapture.y, box) <= maxDistancePx);
}

function resolveMithrilPlayerAnchor(
  boxes: MithrilOreBox[],
  captureSize: { width: number; height: number },
  playerBoxInCapture: PlayerBox | null,
): { anchorInCapture: { x: number; y: number }; playerBoxForDistance: PlayerBox | null; source: "player" | "center" } {
  const centerAnchor = {
    x: Math.round(captureSize.width / 2),
    y: Math.round(captureSize.height / 2),
  };

  if (!playerBoxInCapture) {
    return {
      anchorInCapture: centerAnchor,
      playerBoxForDistance: null,
      source: "center",
    };
  }

  const playerAnchor = {
    x: playerBoxInCapture.centerX,
    y: playerBoxInCapture.centerY,
  };

  if (hasOreNearAnchor(boxes, playerAnchor)) {
    return {
      anchorInCapture: playerAnchor,
      playerBoxForDistance: playerBoxInCapture,
      source: "player",
    };
  }

  return {
    anchorInCapture: centerAnchor,
    playerBoxForDistance: null,
    source: "center",
  };
}

function estimateMoveTilePxFromPlayerBox(playerBoxInCapture: PlayerBox | null): number {
  if (!playerBoxInCapture) {
    return MOVE_TILE_PX_FALLBACK;
  }

  const estimatedTilePx = Math.round((playerBoxInCapture.width + playerBoxInCapture.height) / 2);
  return clamp(estimatedTilePx, MOVE_TILE_PX_MIN, MOVE_TILE_PX_MAX);
}

function estimateMoveTravelTicks(
  screenPoint: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
  playerBoxInCapture: PlayerBox | null,
): number {
  const { distanceTiles } = estimateMoveDistanceToTargetPx(screenPoint, captureBounds, playerBoxInCapture);

  return clamp(Math.ceil(distanceTiles / MOVE_PLAYER_SPEED_TILES_PER_TICK) + MOVE_WAIT_EXTRA_TICKS, 1, MOVE_MAX_WAIT_TICKS);
}

function estimateBankMoveTravelTicks(
  screenPoint: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
  playerBoxInCapture: PlayerBox | null,
): number {
  const baseTicks = estimateMoveTravelTicks(screenPoint, captureBounds, playerBoxInCapture);
  return clamp(Math.max(BANK_MOVE_MIN_TICKS, Math.ceil(baseTicks * BANK_MOVE_TICK_MULTIPLIER)), 1, MOVE_MAX_WAIT_TICKS);
}

function estimateMoveDistanceToTargetPx(
  screenPoint: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
  playerBoxInCapture: PlayerBox | null,
): { distancePx: number; tilePx: number; distanceTiles: number } {
  const targetCaptureX = screenPoint.x - captureBounds.x;
  const targetCaptureY = screenPoint.y - captureBounds.y;
  const anchorCaptureX = playerBoxInCapture?.centerX ?? Math.round(captureBounds.width / 2);
  const anchorCaptureY = playerBoxInCapture?.centerY ?? Math.round(captureBounds.height / 2);
  const tilePx = estimateMoveTilePxFromPlayerBox(playerBoxInCapture);
  const dxPx = targetCaptureX - anchorCaptureX;
  const dyPx = targetCaptureY - anchorCaptureY;
  return {
    distancePx: axisDistance(dxPx, dyPx),
    tilePx,
    distanceTiles: Math.max(Math.abs(dxPx) / tilePx, Math.abs(dyPx) / tilePx),
  };
}

function findOreNearTargetScreen(
  boxes: MithrilOreBox[],
  targetScreen: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
): MithrilOreBox | null {
  const localX = targetScreen.x - captureBounds.x;
  const localY = targetScreen.y - captureBounds.y;

  let best: MithrilOreBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const distance = distanceToBox(localX, localY, box);
    if (distance > TARGET_ORE_MATCH_RADIUS_PX) {
      continue;
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      best = box;
    }
  }

  return best;
}

function toOreInteractionScreenPoint(oreBox: MithrilOreBox, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
  const upwardBiasPx = Math.max(2, Math.round(oreBox.height * 0.22));
  return {
    x: captureBounds.x + oreBox.centerX,
    y: captureBounds.y + Math.max(oreBox.y + 1, oreBox.centerY - upwardBiasPx),
  };
}

function toOreTrackingScreenPoint(oreBox: MithrilOreBox, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
  return {
    x: captureBounds.x + oreBox.centerX,
    y: captureBounds.y + oreBox.centerY,
  };
}

function clickScreenPoint(screenX: number, screenY: number): void {
  moveMouse(screenX, screenY);
  mouseClick("left", false);
}

function deadlineFromNowTicks(ticks: number, nowMs: number = Date.now()): number {
  return nowMs + Math.max(0, ticks) * GAME_TICK_MS;
}

function resolveBankDepositOrbReferencePath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), BANK_DEPOSIT_ORB_REFERENCE_ICON),
    path.resolve(__dirname, "..", "..", "..", BANK_DEPOSIT_ORB_REFERENCE_ICON),
    path.resolve(__dirname, "..", "..", "..", "..", BANK_DEPOSIT_ORB_REFERENCE_ICON),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function toRobotBitmapFromPng(png: PNG): RobotBitmap {
  const image = Buffer.alloc(png.width * png.height * 4);
  for (let i = 0; i < png.data.length; i += 4) {
    image[i] = png.data[i + 2];
    image[i + 1] = png.data[i + 1];
    image[i + 2] = png.data[i];
    image[i + 3] = png.data[i + 3];
  }

  return {
    width: png.width,
    height: png.height,
    byteWidth: png.width * 4,
    bytesPerPixel: 4,
    image,
  };
}

function getBankDepositOrbReferenceBitmap(): RobotBitmap | null {
  if (bankDepositOrbReferenceBitmap) {
    return bankDepositOrbReferenceBitmap;
  }

  if (bankDepositOrbReferenceLoadAttempted) {
    return null;
  }

  bankDepositOrbReferenceLoadAttempted = true;
  const referencePath = resolveBankDepositOrbReferencePath();
  if (!referencePath) {
    warn(`Bank deposit orb reference icon not found (${BANK_DEPOSIT_ORB_REFERENCE_ICON}).`);
    return null;
  }

  try {
    const pngBuffer = fs.readFileSync(referencePath);
    const pngSync = (PNG as unknown as { sync?: { read: (buffer: Buffer) => PNG } }).sync;
    if (!pngSync) {
      warn(`pngjs sync API unavailable; cannot load bank deposit orb reference.`);
      return null;
    }

    const png = pngSync.read(pngBuffer);
    bankDepositOrbReferenceBitmap = toRobotBitmapFromPng(png);
    log(`Bank deposit orb reference loaded (${bankDepositOrbReferenceBitmap.width}x${bankDepositOrbReferenceBitmap.height}).`);
    return bankDepositOrbReferenceBitmap;
  } catch (error) {
    warn(`Failed to load bank deposit orb reference: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function isStrictMagentaPixel(r: number, g: number, b: number): boolean {
  return r >= TARGET_MAGENTA.r - 24 && g <= 40 && b >= TARGET_MAGENTA.b - 24;
}

function findLargestMagentaBlobInBitmap(bitmap: RobotBitmap, minPixels: number = BANKING_MAGENTA_MIN_PIXELS): MagentaBlob | null {
  const width = bitmap.width;
  const height = bitmap.height;
  const visited = new Uint8Array(width * height);
  const index = (x: number, y: number) => y * width + x;

  let best: MagentaBlob | null = null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIdx = index(x, y);
      if (visited[startIdx] === 1) {
        continue;
      }

      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];

      if (!isStrictMagentaPixel(r, g, b)) {
        visited[startIdx] = 1;
        continue;
      }

      const queue: Array<{ x: number; y: number }> = [{ x, y }];
      visited[startIdx] = 1;

      let pixelCount = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (queue.length > 0) {
        const current = queue.pop();
        if (!current) {
          break;
        }

        pixelCount += 1;
        sumX += current.x;
        sumY += current.y;
        if (current.x < minX) minX = current.x;
        if (current.x > maxX) maxX = current.x;
        if (current.y < minY) minY = current.y;
        if (current.y > maxY) maxY = current.y;

        const neighbors = [
          { x: current.x - 1, y: current.y },
          { x: current.x + 1, y: current.y },
          { x: current.x, y: current.y - 1 },
          { x: current.x, y: current.y + 1 },
        ];

        for (const n of neighbors) {
          if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) {
            continue;
          }
          const nIdx = index(n.x, n.y);
          if (visited[nIdx] === 1) {
            continue;
          }

          visited[nIdx] = 1;
          const nOffset = n.y * bitmap.byteWidth + n.x * bitmap.bytesPerPixel;
          const nb = bitmap.image[nOffset];
          const ng = bitmap.image[nOffset + 1];
          const nr = bitmap.image[nOffset + 2];
          if (isStrictMagentaPixel(nr, ng, nb)) {
            queue.push(n);
          }
        }
      }

      if (pixelCount < minPixels) {
        continue;
      }

      const candidate: MagentaBlob = {
        centerX: Math.round(sumX / pixelCount),
        centerY: Math.round(sumY / pixelCount),
        pixelCount,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };

      if (!best || candidate.pixelCount > best.pixelCount) {
        best = candidate;
      }
    }
  }

  return best;
}

function clickDirectionalWalk(captureBounds: ScreenCaptureBounds, direction: WalkDirection): { x: number; y: number } {
  const ratioX = direction === "west" ? 0.2 : 0.8;
  const x = captureBounds.x + Math.round(captureBounds.width * ratioX);
  const y = captureBounds.y + Math.round(captureBounds.height * DIRECTIONAL_STEP_Y_RATIO);
  clickScreenPoint(x, y);
  return { x, y };
}

function isActionLocked(state: BotState, nowMs: number): boolean {
  return state.actionLockUntilMs > nowMs;
}

function remainingLockTicks(state: BotState, nowMs: number): number {
  if (!isActionLocked(state, nowMs)) {
    return 0;
  }

  return Math.max(1, Math.ceil((state.actionLockUntilMs - nowMs) / GAME_TICK_MS));
}

function resetToSearchingState(state: BotState, actionLockUntilMs: number = state.actionLockUntilMs): BotState {
  return {
    ...state,
    phase: "searching",
    currentFunction: "searchOre",
    actionLockUntilMs,
    moveDeadlineMs: 0,
    targetScreen: null,
    moveWaitTicks: 0,
    moveDestinationPhase: "mining",
    bankOrbClickCount: 0,
    bankDepositScreen: null,
    bankOrbFindAttemptCount: 0,
  };
}

function createInitialState(): BotState {
  return {
    loopIndex: 0,
    currentFunction: "searchOre",
    phase: "searching",
    actionLockUntilMs: 0,
    moveDeadlineMs: 0,
    lastClickedOreScreen: null,
    targetScreen: null,
    moveWaitTicks: 0,
    moveDestinationPhase: "mining",
    inventoryCount: null,
    bankOrbClickCount: 0,
    bankDepositScreen: null,
    bankOrbFindAttemptCount: 0,
  };
}

function transitionToMiningState(state: BotState): BotState {
  return {
    ...state,
    phase: "mining",
    currentFunction: "mine",
    moveDeadlineMs: 0,
    moveWaitTicks: 0,
    moveDestinationPhase: "mining",
  };
}

function transitionToBankingState(state: BotState, nowMs: number): BotState {
  return {
    ...state,
    phase: "banking-search-magenta",
    currentFunction: "bank",
    targetScreen: null,
    moveDeadlineMs: 0,
    moveWaitTicks: 0,
    moveDestinationPhase: "banking-search-magenta",
    bankOrbClickCount: 0,
    bankDepositScreen: null,
    bankOrbFindAttemptCount: 0,
    actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
  };
}

function transitionToMoveState(
  state: BotState,
  nowMs: number,
  targetScreen: { x: number; y: number },
  moveTravelTicks: number,
  moveDestinationPhase: MoveDestinationPhase,
  actionLockUntilMs: number = state.actionLockUntilMs,
): BotState {
  return {
    ...state,
    phase: "moving",
    currentFunction: "move",
    actionLockUntilMs,
    moveDeadlineMs: deadlineFromNowTicks(moveTravelTicks, nowMs),
    targetScreen,
    moveWaitTicks: 0,
    moveDestinationPhase,
  };
}

function transitionFromMoveState(state: BotState, inventoryCount: number | null): BotState {
  if (state.moveDestinationPhase === "mining") {
    return transitionToMiningState({
      ...state,
      inventoryCount,
    });
  }

  return {
    ...state,
    inventoryCount,
    phase: state.moveDestinationPhase,
    currentFunction: "bank",
    actionLockUntilMs: 0,
    moveDeadlineMs: 0,
    targetScreen: null,
    moveWaitTicks: 0,
    bankOrbFindAttemptCount: 0,
  };
}

function runSearchOreTick(state: BotState, nowMs: number, tickCapture: TickCapture, captureBounds: ScreenCaptureBounds): BotState {
  const inventoryResult = detectInventoryCount(tickCapture.bitmap);
  const inventoryCount = inventoryResult.count;
  if (inventoryCount === INVENTORY_EMPTY_COUNT) {
    log(`Inventory is empty (0); switching to banking path.`);
    return transitionToBankingState({ ...state, inventoryCount }, nowMs);
  }

  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  const tilePxHint = estimateMoveTilePxFromPlayerBox(playerBox);
  const oreBoxes = detectMithrilOreBoxesInScreenshot(tickCapture.bitmap, { tilePxHint });
  const resolvedPlayer = resolveMithrilPlayerAnchor(oreBoxes, tickCapture.bitmap, playerBox);
  const sameOreLocked = isActionLocked(state, nowMs) && !!state.lastClickedOreScreen;
  const selectableOreBoxes =
    sameOreLocked && state.lastClickedOreScreen
      ? oreBoxes.filter((box) => {
          const trackingPoint = toOreTrackingScreenPoint(box, captureBounds);
          return !isSameOreScreenTarget(trackingPoint, state.lastClickedOreScreen!);
        })
      : oreBoxes;
  const selectedOre = selectNearestMithrilOre(selectableOreBoxes, tickCapture.bitmap, resolvedPlayer.anchorInCapture);

  if (sameOreLocked && selectableOreBoxes.length === 0) {
    if (state.loopIndex % 2 === 0) {
      log(`Waiting ${remainingLockTicks(state, nowMs)} tick(s) before re-clicking the same ore.`);
    }
    return state;
  }

  if (!selectedOre) {
    if (inventoryCount === INVENTORY_FULL_COUNT && !isActionLocked(state, nowMs)) {
      const point = clickDirectionalWalk(captureBounds, "east");
      log(`Inventory is full (28) and no ore visible; stepping east via click at (${point.x},${point.y}).`);
      return {
        ...state,
        inventoryCount,
        actionLockUntilMs: deadlineFromNowTicks(EAST_RECOVERY_STEP_COOLDOWN_TICKS, nowMs),
      };
    }

    if (state.loopIndex % 3 === 0) {
      warn(
        `No mithril ore found (boxes=${oreBoxes.length}, selectable=${selectableOreBoxes.length}, anchor=${resolvedPlayer.anchorInCapture.x},${resolvedPlayer.anchorInCapture.y}, anchor-source=${resolvedPlayer.source}).`,
      );
    }
    return {
      ...state,
      inventoryCount,
    };
  }

  const interactionPoint = toOreInteractionScreenPoint(selectedOre, captureBounds);
  const trackingPoint = toOreTrackingScreenPoint(selectedOre, captureBounds);
  const edgeDistance = distanceToBox(resolvedPlayer.anchorInCapture.x, resolvedPlayer.anchorInCapture.y, selectedOre);
  const moveTravelTicks = estimateMoveTravelTicks(trackingPoint, captureBounds, resolvedPlayer.playerBoxForDistance);
  const { distanceTiles } = estimateMoveDistanceToTargetPx(trackingPoint, captureBounds, resolvedPlayer.playerBoxForDistance);

  log(
    `Selected mithril ore center=(${selectedOre.centerX},${selectedOre.centerY}) size=${selectedOre.width}x${selectedOre.height} blue=${selectedOre.blueDominance.toFixed(1)} edge=${edgeDistance} tiles~${distanceTiles.toFixed(1)} anchor=${resolvedPlayer.source}; clicking (${interactionPoint.x},${interactionPoint.y}), move eta ~${moveTravelTicks} tick(s).`,
  );

  clickScreenPoint(interactionPoint.x, interactionPoint.y);

  return transitionToMoveState(
    {
      ...state,
      inventoryCount,
      lastClickedOreScreen: trackingPoint,
    },
    nowMs,
    trackingPoint,
    moveTravelTicks,
    "mining",
    deadlineFromNowTicks(ORE_RECLICK_COOLDOWN_TICKS, nowMs),
  );
}

function runMoveTick(state: BotState, nowMs: number, tickCapture: TickCapture, captureBounds: ScreenCaptureBounds): BotState {
  const inventoryResult = detectInventoryCount(tickCapture.bitmap);
  const inventoryCount = inventoryResult.count;
  if (inventoryCount === INVENTORY_EMPTY_COUNT && state.moveDestinationPhase === "mining") {
    log(`Inventory is empty while moving; switching to banking path.`);
    return transitionToBankingState({ ...state, inventoryCount }, nowMs);
  }

  if (!state.targetScreen) {
    warn(`Missing target screen while moving; returning to search.`);
    return resetToSearchingState({ ...state, inventoryCount });
  }

  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  const { distancePx, tilePx } = estimateMoveDistanceToTargetPx(state.targetScreen, captureBounds, playerBox);
  const moveWaitTicks = state.moveWaitTicks + 1;

  if (state.moveDeadlineMs > nowMs) {
    const remainingMs = Math.max(0, state.moveDeadlineMs - nowMs);
    const remainingTicks = Math.max(1, Math.ceil(remainingMs / GAME_TICK_MS));
    const nearTarget = distancePx <= Math.round(tilePx * MOVE_EARLY_COMPLETE_RADIUS_TILES);

    if (remainingTicks <= MOVE_EARLY_COMPLETE_MAX_REMAINING_TICKS && nearTarget) {
      log(
        `Arrived near move target (${state.targetScreen.x},${state.targetScreen.y}) early after ${moveWaitTicks} tick(s) (distance=${distancePx}px); switching to ${state.moveDestinationPhase}.`,
      );
      return transitionFromMoveState(state, inventoryCount);
    }

    if (state.loopIndex % 2 === 0) {
      log(
        `Moving to (${state.targetScreen.x},${state.targetScreen.y}); waiting ${remainingTicks} more tick(s) (distance=${distancePx}px, tile=${tilePx}px).`,
      );
    }

    return {
      ...state,
      inventoryCount,
      moveWaitTicks,
    };
  }

  log(
    `Move ETA complete for (${state.targetScreen.x},${state.targetScreen.y}) after ${moveWaitTicks} tick(s); entering ${state.moveDestinationPhase} phase.`,
  );
  return transitionFromMoveState(state, inventoryCount);
}

function runMineTick(state: BotState, nowMs: number, tickCapture: TickCapture, captureBounds: ScreenCaptureBounds): BotState {
  const inventoryResult = detectInventoryCount(tickCapture.bitmap);
  const inventoryCount = inventoryResult.count;
  if (inventoryCount === INVENTORY_EMPTY_COUNT) {
    log(`Inventory is empty while mining; switching to banking path.`);
    return transitionToBankingState({ ...state, inventoryCount }, nowMs);
  }

  if (!state.targetScreen) {
    warn(`Missing target screen while mining; returning to search.`);
    return resetToSearchingState({ ...state, inventoryCount });
  }

  const miningStatus = detectMiningBoxStatusInScreenshot(tickCapture.bitmap);

  if (miningStatus.status === "not-mining") {
    log(
      `Mining status is not-mining (confidence=${miningStatus.confidence.toFixed(2)}, red=${miningStatus.redPixelCount}, green=${miningStatus.greenPixelCount}); returning to ore search.`,
    );
    return resetToSearchingState({ ...state, inventoryCount }, state.actionLockUntilMs);
  }

  if (state.loopIndex % 2 === 0) {
    log(
      miningStatus.status === "mining"
        ? `Mining status is mining (confidence=${miningStatus.confidence.toFixed(2)}, red=${miningStatus.redPixelCount}, green=${miningStatus.greenPixelCount}); holding current mining target.`
        : `Mining status is ${miningStatus.status} (confidence=${miningStatus.confidence.toFixed(2)}, red=${miningStatus.redPixelCount}, green=${miningStatus.greenPixelCount}); waiting for the status box to resolve.`,
    );
  }

  return {
    ...state,
    inventoryCount,
  };
}

function runBankTick(state: BotState, nowMs: number, tickCapture: TickCapture, captureBounds: ScreenCaptureBounds): BotState {
  const inventoryResult = detectInventoryCount(tickCapture.bitmap);
  const inventoryCount = inventoryResult.count;

  if (inventoryCount === INVENTORY_FULL_COUNT) {
    log(`Inventory reached 28; returning to ore search.`);
    return resetToSearchingState({ ...state, inventoryCount }, nowMs);
  }

  if (isActionLocked(state, nowMs)) {
    return {
      ...state,
      inventoryCount,
    };
  }

  if (state.phase === "banking-search-magenta") {
    const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
    const magenta = findLargestMagentaBlobInBitmap(tickCapture.bitmap);
    if (!magenta) {
      const stepPoint = clickDirectionalWalk(captureBounds, "west");
      const moveTravelTicks = estimateBankMoveTravelTicks(stepPoint, captureBounds, playerBox);
      if (state.loopIndex % 2 === 0) {
        log(`No large magenta target yet; stepping west at (${stepPoint.x},${stepPoint.y}) with move eta ~${moveTravelTicks} tick(s).`);
      }
      return transitionToMoveState(
        {
          ...state,
          inventoryCount,
        },
        nowMs,
        stepPoint,
        moveTravelTicks,
        "banking-search-magenta",
        0,
      );
    }

    const targetScreenX = captureBounds.x + magenta.centerX;
    const targetScreenY = captureBounds.y + magenta.centerY;
    const moveTravelTicks = estimateBankMoveTravelTicks({ x: targetScreenX, y: targetScreenY }, captureBounds, playerBox);
    log(
      `Found magenta target size=${magenta.width}x${magenta.height} pixels=${magenta.pixelCount}; clicking (${targetScreenX},${targetScreenY}) with move eta ~${moveTravelTicks} tick(s) before bank-orb detection.`,
    );
    clickScreenPoint(targetScreenX, targetScreenY);

    return transitionToMoveState(
      {
        ...state,
        inventoryCount,
        bankDepositScreen: { x: targetScreenX, y: targetScreenY },
        bankOrbFindAttemptCount: 0,
      },
      nowMs,
      { x: targetScreenX, y: targetScreenY },
      moveTravelTicks,
      "banking-find-orb",
      0,
    );
  }

  const orbReferenceBitmap = getBankDepositOrbReferenceBitmap();
  if (!orbReferenceBitmap) {
    return {
      ...state,
      inventoryCount,
      phase: "banking-search-magenta",
      currentFunction: "bank",
      actionLockUntilMs: deadlineFromNowTicks(BANKING_MOVE_COOLDOWN_TICKS, nowMs),
    };
  }

  const orbResult = detectBankDepositIconWithOrb(orbReferenceBitmap, tickCapture.bitmap);
  if (!orbResult.detection) {
    const nextAttemptCount = state.bankOrbFindAttemptCount + 1;
    if (nextAttemptCount >= BANK_ORB_FIND_RETRY_MAX) {
      if (!state.bankDepositScreen) {
        warn(`Bank orb not found after ${nextAttemptCount} attempt(s) and no deposit target is cached; restarting bank search.`);
        return {
          ...state,
          inventoryCount,
          phase: "banking-search-magenta",
          currentFunction: "bank",
          actionLockUntilMs: deadlineFromNowTicks(BANKING_MOVE_COOLDOWN_TICKS, nowMs),
          bankOrbFindAttemptCount: 0,
        };
      }

      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const moveTravelTicks = estimateBankMoveTravelTicks(state.bankDepositScreen, captureBounds, playerBox);
      log(
        `Bank orb not found after ${nextAttemptCount} attempt(s); re-clicking bank deposit at (${state.bankDepositScreen.x},${state.bankDepositScreen.y}) with move eta ~${moveTravelTicks} tick(s).`,
      );
      clickScreenPoint(state.bankDepositScreen.x, state.bankDepositScreen.y);

      return transitionToMoveState(
        {
          ...state,
          inventoryCount,
          bankOrbFindAttemptCount: 0,
        },
        nowMs,
        state.bankDepositScreen,
        moveTravelTicks,
        "banking-find-orb",
        0,
      );
    }

    if (state.loopIndex % 3 === 0) {
      log(
        `Waiting for bank deposit orb after magenta click (attempt ${nextAttemptCount}/${BANK_ORB_FIND_RETRY_MAX}, sceneKeypoints=${orbResult.sceneKeypointCount}, rawMatches=${orbResult.rawMatchCount}).`,
      );
    }
    return {
      ...state,
      inventoryCount,
      bankOrbFindAttemptCount: nextAttemptCount,
      actionLockUntilMs: deadlineFromNowTicks(1, nowMs),
    };
  }

  const orbScreenX = captureBounds.x + orbResult.detection.centerX;
  const orbScreenY = captureBounds.y + orbResult.detection.centerY;
  clickScreenPoint(orbScreenX, orbScreenY);

  log(
    `Bank orb detected at (${orbResult.detection.centerX},${orbResult.detection.centerY}) score=${orbResult.detection.score.toFixed(1)}; clicked (${orbScreenX},${orbScreenY}) and waiting for inventory=28.`,
  );

  return {
    ...state,
    inventoryCount,
    bankOrbClickCount: state.bankOrbClickCount + 1,
    bankOrbFindAttemptCount: 0,
    actionLockUntilMs: deadlineFromNowTicks(2, nowMs),
  };
}

async function runLoop(captureBounds: ScreenCaptureBounds): Promise<void> {
  if (isLoopRunning) {
    log(`Loop already running.`);
    return;
  }

  isLoopRunning = true;
  setAutomateBotCurrentStep(MINING_GUILD_MITHRIL_ORE_BOT_ID);

  try {
    await runBotEngine<BotState, EngineFunctionKey, TickCapture>({
      tickMs: GAME_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState,
      captureTick: () => ({
        bitmap: captureScreenBitmap(captureBounds),
      }),
      functions: {
        searchOre: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "searching" ? runSearchOreTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        move: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "moving" ? runMoveTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        mine: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "mining" ? runMineTick(state, nowMs, tickCapture, captureBounds) : state;
        },
        bank: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "banking-search-magenta" || state.phase === "banking-find-orb"
            ? runBankTick(state, nowMs, tickCapture, captureBounds)
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

export function onMiningGuildMithrilOreBotStart(): void {
  setCurrentLogLoopIndex(0);
  setCurrentLogPhase("searching");

  if (!isLoopRunning) {
    startedAtMs = Date.now();
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Config: engineTick=${GAME_TICK_MS}ms, phases='search->move->mine', startup='hold-w+north', player-ore-max-edge=${PLAYER_ORE_MAX_EDGE_DISTANCE_PX}px.`,
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
      await prepareCamera(logicalBounds);
      if (!AppState.automateBotRunning) {
        return;
      }

      await runLoop(captureBounds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`Startup failed: ${message}`);
      notifyUserAndStop(message);
    }
  })();
}
