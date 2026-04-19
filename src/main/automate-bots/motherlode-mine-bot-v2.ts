import path from "path";
import { keyToggle, mouseClick, moveMouse, screen, scrollMouse } from "robotjs";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { MINING_MOTHERLODE_MINE_V2_BOT_ID } from "./definitions";
import {
  MotherlodeMineBox,
  detectMotherlodeMineBoxesInScreenshot,
  saveBitmapWithMotherlodeMineBoxes,
} from "./shared/motherlode-mine-box-detector";
import {
  MotherlodeBagFullState,
  detectMotherlodeBagFullBoxInScreenshot,
} from "./shared/motherlode-bag-full-box-detector";
import {
  MotherlodeDepositBox,
  detectBestMotherlodeDepositBoxInScreenshot,
} from "./shared/motherlode-deposit-box-detector";
import {
  MotherlodeObstacleRedBox,
  detectBestMotherlodeObstacleRedBoxInScreenshot,
} from "./shared/motherlode-obstacle-red-detector";
import { isPlayerCollidingWithObstacle as isPlayerCollidingWithObstacleBox } from "./shared/player-obstacle-collision";
import { PlayerBox, detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";
import { selectNearestGreenMotherlodeNode } from "./shared/motherlode-target-selection";
import { screen as electronScreen } from "electron";
import { detectTileLocationBoxInScreenshot } from "./shared/tile-location-detection";
import { detectOverlayBoxInScreenshot } from "./shared/coordinate-box-detector";
import { RobotBitmap } from "./shared/ocr-engine";

const BOT_NAME = "Motherlode Mine V2";
const DEBUG_DIR = "ocr-debug";
const CAMERA_SCROLL_TICKS = 35;
const CAMERA_SCROLL_DELTA_Y = 120;
const NORTH_KEY_HOLD_MS = 100;

const BASE_TICK_MS = 600;
const TOOLTIP_SETTLE_MS = 400;
const ENABLE_TILE_LOCATION_DETECTION = false;
const ENABLE_NODE_HOVER_BEFORE_TILE_READ = true;
const ENABLE_OBSTACLE_RED_CLICK = true;
const POST_CLICK_MOUSE_MOVE_MODE: PostClickMouseMoveMode = "offset-200";
const POST_CLICK_MOUSE_OFFSET_PX = 200;
const POST_CLICK_CORNER_MARGIN_PX = 6;
const OBSTACLE_PLAYER_COLLISION_PADDING_PX = 4;
const DEPOSIT_PLAYER_NEAR_RADIUS_PX = 48;

const DEPOSIT_TRIGGER_STABLE_TICKS = 2;
const NODE_CLICK_LOCK_TICKS = 3;
const OBSTACLE_CLICK_LOCK_TICKS = 2;
const DEPOSIT_CLICK_LOCK_TICKS = 1;
const BANK_CLICK_LOCK_TICKS = 1;
const BANK_POST_ORANGE_WAIT_TICKS = 3;
const BANK_SOUTH_CLICK_LOCK_TICKS = 1;
const BANK_YELLOW_TILE_CLICK_LOCK_TICKS = 2;
const BANK_SOUTH_CLICK_OFFSET_PX = 120;
const BANK_SOUTH_CLICK_RANDOM_RADIUS_PX = 14;
const BANK_EXPECTED_LADDER_DOWN_X = 3755;
const BANK_EXPECTED_LADDER_DOWN_Y = 5672;
const BANK_SOUTH_CLICKS_BEFORE_YELLOW_CHECK = 6;
const BANK_LADDER_RECHECK_MAX = 2;
const BANK_LADDER_RECHECK_WAIT_MIN_TICKS = 2;
const BANK_LADDER_RECHECK_WAIT_MAX_TICKS = 4;
const BANK_MOVE_MARGIN_PX = 8;
const DEPOSIT_NEAR_STABLE_TICKS = 2;
const DEPOSIT_STUCK_RETRY_TICKS = 3;
const DEPOSIT_PROGRESS_EPSILON_PX = 2;
const ACTIVE_NODE_MISSING_GRACE_TICKS = 2;
const ACTIVE_NODE_MAX_WAIT_TICKS_MIN = 80;
const ACTIVE_NODE_MAX_WAIT_TICKS_MAX = 100;
const ACTIVE_NODE_MATCH_RADIUS_PX = 34;
const BANK_ORANGE_TARGET_R = 255;
const BANK_ORANGE_TARGET_G = 125;
const BANK_ORANGE_TARGET_B = 0;
const BANK_ORANGE_R_TOLERANCE = 10;
const BANK_ORANGE_G_TOLERANCE = 18;
const BANK_ORANGE_B_TOLERANCE = 20;
const BANK_ORANGE_MIN_COMPONENT_PIXELS = 40;
const BOX_CLICK_INNER_RATIO = 0.75;
const BOX_CLICK_PICK_MAX_ATTEMPTS = 12;

interface ScreenCaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TileCoord {
  x: number;
  y: number;
  z: number;
}

type HoverTileReadSource = "tile-location" | "overlay" | "none";
type PostClickMouseMoveMode = "off" | "top-left" | "offset-200";
type BotPhase = "searching" | "mining" | "depositing" | "banking";
type BankingStep = "find-orange" | "wait-after-orange" | "move-south-until-yellow" | "yellow-clicked";

type HoverTileReadResult = {
  tile: TileCoord | null;
  source: HoverTileReadSource;
  rawLine: string | null;
};

type BotState = {
  phase: BotPhase;
  activeTile: TileCoord | null;
  activeScreen: { x: number; y: number } | null;
  missingActiveTicks: number;
  miningWaitTicks: number;
  activeNodeMaxWaitTicks: number;
  bagFullState: MotherlodeBagFullState | null;
  depositTriggerStableTicks: number;
  depositNearStableTicks: number;
  depositRetryTicks: number;
  depositInFlight: boolean;
  depositLastDistancePx: number | null;
  actionLockTicks: number;
  bankingStep: BankingStep;
  bankSouthClicks: number;
  bankLadderRecheckCount: number;
  loopIndex: number;
};

type MineCaptureResult = {
  boxes: MotherlodeMineBox[];
  greenBoxes: MotherlodeMineBox[];
  orangeBoxes: OrangeTargetBox[];
  obstacleBox: MotherlodeObstacleRedBox | null;
  playerBoxInCapture: PlayerBox | null;
  playerAnchorInCapture: { x: number; y: number } | null;
  playerTileFromOverlay: TileCoord | null;
  bagFullState: MotherlodeBagFullState;
};

type DepositCaptureResult = {
  depositBox: MotherlodeDepositBox | null;
  obstacleBox: MotherlodeObstacleRedBox | null;
  playerBoxInCapture: PlayerBox | null;
  playerAnchorInCapture: { x: number; y: number } | null;
  bagFullState: MotherlodeBagFullState;
};

type OrangeTargetBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  pixelCount: number;
};

let isLoopRunning = false;
let startedAtMs: number | null = null;
let debugCaptureIndex = 0;
let lastClickPoint: { x: number; y: number } | null = null;
let currentWindowsScalePercent = 100;

function formatElapsedSinceStart(): string {
  if (startedAtMs === null) return "+0ms";
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const ms = String(elapsedMs % 1000).padStart(3, "0");
  return `+${mm}:${ss}.${ms}`;
}

function log(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] ${message}`);
}

function warn(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] ${message}`);
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

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }
  stopAutomateBot("bot");
}

function sleepWithAbort(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const tick = 50;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += tick;
      if (!AppState.automateBotRunning || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, tick);
  });
}

function moveMouseToWindowCenter(bounds: ScreenCaptureBounds): void {
  const centerX = Math.round(bounds.x + bounds.width / 2);
  const centerY = Math.round(bounds.y + bounds.height / 2);
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
  moveMouse(centerX, centerY);
}

function scrollCameraDownToMaximum(): void {
  if (typeof scrollMouse !== "function") {
    warn(`Automate Bot (${BOT_NAME}): RobotJS scrollMouse unavailable; skipping startup camera scroll.`);
    return;
  }
  for (let i = 0; i < CAMERA_SCROLL_TICKS; i += 1) {
    scrollMouse(0, CAMERA_SCROLL_DELTA_Y);
  }
}

function tapCompassNorth(): void {
  if (typeof keyToggle !== "function") {
    warn(`Automate Bot (${BOT_NAME}): RobotJS keyToggle unavailable; skipping startup compass alignment.`);
    return;
  }
  keyToggle("n", "down");
  setTimeout(() => {
    keyToggle("n", "up");
  }, NORTH_KEY_HOLD_MS);
}

function parseTileCoord(matchedLine: string): TileCoord | null {
  const parts = matchedLine.split(",");
  if (parts.length < 3) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function isAtBankLadderDownTile(tile: TileCoord | null): boolean {
  return tile?.x === BANK_EXPECTED_LADDER_DOWN_X && tile?.y === BANK_EXPECTED_LADDER_DOWN_Y;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}

function randomIntInclusive(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function getInnerRange(start: number, size: number, ratio: number): { min: number; max: number } {
  const boundedSize = Math.max(1, size);
  const innerSize = Math.max(1, Math.floor(boundedSize * ratio));
  const margin = Math.max(0, Math.floor((boundedSize - innerSize) / 2));
  const min = start + margin;
  const max = min + innerSize - 1;
  return { min, max };
}

function pickDistinctScreenPointInLocalRange(
  localMinX: number,
  localMaxX: number,
  localMinY: number,
  localMaxY: number,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const minX = captureBounds.x + Math.min(localMinX, localMaxX);
  const maxX = captureBounds.x + Math.max(localMinX, localMaxX);
  const minY = captureBounds.y + Math.min(localMinY, localMaxY);
  const maxY = captureBounds.y + Math.max(localMinY, localMaxY);

  let candidate = { x: minX, y: minY };
  for (let attempt = 0; attempt < BOX_CLICK_PICK_MAX_ATTEMPTS; attempt += 1) {
    const x = randomIntInclusive(minX, maxX);
    const y = randomIntInclusive(minY, maxY);
    candidate = { x, y };
    if (!lastClickPoint || x !== lastClickPoint.x || y !== lastClickPoint.y) {
      return candidate;
    }
  }

  if (minX < maxX) {
    const nextX = candidate.x > minX ? candidate.x - 1 : candidate.x + 1;
    return { x: nextX, y: candidate.y };
  }

  if (minY < maxY) {
    const nextY = candidate.y > minY ? candidate.y - 1 : candidate.y + 1;
    return { x: candidate.x, y: nextY };
  }

  return candidate;
}

function pickDistinctScreenPointInBox(
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getInnerRange(boxX, boxWidth, BOX_CLICK_INNER_RATIO);
  const innerY = getInnerRange(boxY, boxHeight, BOX_CLICK_INNER_RATIO);
  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, innerY.max, captureBounds);
}

function isBankOrangePixel(r: number, g: number, b: number): boolean {
  if (Math.abs(r - BANK_ORANGE_TARGET_R) > BANK_ORANGE_R_TOLERANCE) return false;
  if (Math.abs(g - BANK_ORANGE_TARGET_G) > BANK_ORANGE_G_TOLERANCE) return false;
  if (Math.abs(b - BANK_ORANGE_TARGET_B) > BANK_ORANGE_B_TOLERANCE) return false;
  return r >= 235 && g >= 90 && b <= 35;
}

function detectOrangeBoxesInScreenshot(bitmap: RobotBitmap): OrangeTargetBox[] {
  const width = bitmap.width;
  const height = bitmap.height;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * bitmap.byteWidth + x * bitmap.bytesPerPixel;
      const b = bitmap.image[offset];
      const g = bitmap.image[offset + 1];
      const r = bitmap.image[offset + 2];
      if (isBankOrangePixel(r, g, b)) {
        mask[y * width + x] = 1;
      }
    }
  }

  const remaining = mask.slice();
  const out: OrangeTargetBox[] = [];

  for (let i = 0; i < remaining.length; i += 1) {
    if (!remaining[i]) continue;
    remaining[i] = 0;
    const stack = [i];

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let pixelCount = 0;

    while (stack.length > 0) {
      const idx = stack.pop();
      if (idx === undefined) break;
      const x = idx % width;
      const y = Math.floor(idx / width);

      pixelCount += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (!remaining[n]) continue;
          remaining[n] = 0;
          stack.push(n);
        }
      }
    }

    if (pixelCount < BANK_ORANGE_MIN_COMPONENT_PIXELS) continue;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    if (w <= 0 || h <= 0) continue;

    out.push({
      x: minX,
      y: minY,
      width: w,
      height: h,
      centerX: Math.round((minX + maxX) / 2),
      centerY: Math.round((minY + maxY) / 2),
      pixelCount,
    });
  }

  out.sort((a, b) => b.pixelCount - a.pixelCount);
  return out;
}

function findNodeNearActiveScreen(
  boxes: MotherlodeMineBox[],
  activeScreen: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
): MotherlodeMineBox | null {
  const activeX = activeScreen.x - captureBounds.x;
  const activeY = activeScreen.y - captureBounds.y;

  let best: MotherlodeMineBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(activeX, box.x, box.x + box.width - 1);
    const nearestY = clamp(activeY, box.y, box.y + box.height - 1);
    const dx = activeX - nearestX;
    const dy = activeY - nearestY;
    const distance = axisDistance(dx, dy);
    if (distance > ACTIVE_NODE_MATCH_RADIUS_PX) continue;

    const centerDx = box.centerX - activeX;
    const centerDy = box.centerY - activeY;
    const centerDistance = axisDistance(centerDx, centerDy);
    if (distance < bestDistance || (Math.abs(distance - bestDistance) < 0.001 && centerDistance < bestCenterDistance)) {
      bestDistance = distance;
      bestCenterDistance = centerDistance;
      best = box;
    }
  }

  return best;
}

function getNodeUpperBiasedLocalY(node: MotherlodeMineBox): number {
  const upwardBiasPx = Math.max(3, Math.round(node.height * 0.32));
  return Math.max(node.y + 1, node.centerY - upwardBiasPx);
}

function toNodeInteractionScreenPoint(
  node: MotherlodeMineBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getInnerRange(node.x, node.width, BOX_CLICK_INNER_RATIO);
  const innerY = getInnerRange(node.y, node.height, BOX_CLICK_INNER_RATIO);

  const preferredY = clamp(getNodeUpperBiasedLocalY(node), innerY.min, innerY.max);
  const yBandHeight = Math.max(1, Math.floor((innerY.max - innerY.min + 1) * 0.45));
  const yMin = Math.max(innerY.min, preferredY - yBandHeight + 1);
  const yMax = Math.max(yMin, preferredY);

  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, yMin, yMax, captureBounds);
}

function toNodeTrackingScreenPoint(
  node: MotherlodeMineBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return {
    x: captureBounds.x + node.centerX,
    y: captureBounds.y + node.centerY,
  };
}

function toDepositInteractionScreenPoint(
  depositBox: MotherlodeDepositBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(depositBox.x, depositBox.y, depositBox.width, depositBox.height, captureBounds);
}

function toObstacleInteractionScreenPoint(
  obstacleBox: MotherlodeObstacleRedBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(
    obstacleBox.x,
    obstacleBox.y,
    obstacleBox.width,
    obstacleBox.height,
    captureBounds,
  );
}

function toOrangeInteractionScreenPoint(
  orangeBox: OrangeTargetBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(orangeBox.x, orangeBox.y, orangeBox.width, orangeBox.height, captureBounds);
}

function toYellowInteractionScreenPoint(
  node: MotherlodeMineBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return pickDistinctScreenPointInBox(node.x, node.y, node.width, node.height, captureBounds);
}

function resolvePostClickMouseTarget(
  clickedScreenX: number,
  clickedScreenY: number,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } | null {
  const minX = captureBounds.x + POST_CLICK_CORNER_MARGIN_PX;
  const minY = captureBounds.y + POST_CLICK_CORNER_MARGIN_PX;
  const maxX = captureBounds.x + captureBounds.width - 1 - POST_CLICK_CORNER_MARGIN_PX;
  const maxY = captureBounds.y + captureBounds.height - 1 - POST_CLICK_CORNER_MARGIN_PX;

  if (minX > maxX || minY > maxY) return null;
  if (POST_CLICK_MOUSE_MOVE_MODE === "top-left") return { x: minX, y: minY };
  if (POST_CLICK_MOUSE_MOVE_MODE === "offset-200") {
    return {
      x: clamp(clickedScreenX - POST_CLICK_MOUSE_OFFSET_PX, minX, maxX),
      y: clamp(clickedScreenY - POST_CLICK_MOUSE_OFFSET_PX, minY, maxY),
    };
  }
  return null;
}

function moveMouseAwayFromClickedNode(
  clickedScreenX: number,
  clickedScreenY: number,
  captureBounds: ScreenCaptureBounds,
): void {
  const target = resolvePostClickMouseTarget(clickedScreenX, clickedScreenY, captureBounds);
  if (!target) return;
  moveMouse(target.x, target.y);
}

function clickScreenPoint(screenX: number, screenY: number): void {
  moveMouse(screenX, screenY);
  mouseClick("left", false);
  lastClickPoint = { x: screenX, y: screenY };
}

function toSouthMoveScreenPoint(
  captureBounds: ScreenCaptureBounds,
  playerAnchorInCapture: { x: number; y: number } | null,
): { x: number; y: number } {
  const anchorX = playerAnchorInCapture?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = playerAnchorInCapture?.y ?? Math.round(captureBounds.height / 2);

  const minLocalX = BANK_MOVE_MARGIN_PX;
  const minLocalY = BANK_MOVE_MARGIN_PX;
  const maxLocalX = captureBounds.width - 1 - BANK_MOVE_MARGIN_PX;
  const maxLocalY = captureBounds.height - 1 - BANK_MOVE_MARGIN_PX;

  const baseLocalX = clamp(anchorX, minLocalX, maxLocalX);
  const baseLocalY = clamp(anchorY + BANK_SOUTH_CLICK_OFFSET_PX, minLocalY, maxLocalY);

  const randomMinX = clamp(baseLocalX - BANK_SOUTH_CLICK_RANDOM_RADIUS_PX, minLocalX, maxLocalX);
  const randomMaxX = clamp(baseLocalX + BANK_SOUTH_CLICK_RANDOM_RADIUS_PX, minLocalX, maxLocalX);
  const randomMinY = clamp(baseLocalY - BANK_SOUTH_CLICK_RANDOM_RADIUS_PX, minLocalY, maxLocalY);
  const randomMaxY = clamp(baseLocalY + BANK_SOUTH_CLICK_RANDOM_RADIUS_PX, minLocalY, maxLocalY);

  return pickDistinctScreenPointInLocalRange(randomMinX, randomMaxX, randomMinY, randomMaxY, captureBounds);
}

function isPlayerNearDepositBox(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: MotherlodeDepositBox | null,
  radiusPx: number,
): boolean {
  const distance = getPlayerDistanceToDepositBox(playerAnchorInCapture, depositBox);
  return distance !== null && distance <= radiusPx;
}

function getPlayerDistanceToDepositBox(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: MotherlodeDepositBox | null,
): number | null {
  if (!playerAnchorInCapture || !depositBox) return null;
  const nearestX = clamp(playerAnchorInCapture.x, depositBox.x, depositBox.x + depositBox.width - 1);
  const nearestY = clamp(playerAnchorInCapture.y, depositBox.y, depositBox.y + depositBox.height - 1);
  const dx = playerAnchorInCapture.x - nearestX;
  const dy = playerAnchorInCapture.y - nearestY;
  return Math.sqrt(dx * dx + dy * dy);
}

function isPlayerCollidingWithObstacle(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): boolean {
  return isPlayerCollidingWithObstacleBox(playerBoxInCapture, obstacleBox, OBSTACLE_PLAYER_COLLISION_PADDING_PX);
}

function shouldClearRedObstacle(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): obstacleBox is MotherlodeObstacleRedBox {
  return ENABLE_OBSTACLE_RED_CLICK && isPlayerCollidingWithObstacle(playerBoxInCapture, obstacleBox);
}

function isBagAtDepositThreshold(state: MotherlodeBagFullState): boolean {
  return state === "green" || state === "red";
}

function resetToSearching(current: BotState): BotState {
  return {
    ...current,
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    bankingStep: "find-orange",
    bankSouthClicks: 0,
    bankLadderRecheckCount: 0,
  };
}

function resetToDepositing(current: BotState): BotState {
  return {
    ...current,
    phase: "depositing",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    bankingStep: "find-orange",
    bankSouthClicks: 0,
    bankLadderRecheckCount: 0,
  };
}

function resetToBanking(current: BotState): BotState {
  return {
    ...current,
    phase: "banking",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    bankingStep: "find-orange",
    bankSouthClicks: 0,
    bankLadderRecheckCount: 0,
  };
}

function findNearestOrangeBox(
  boxes: OrangeTargetBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): OrangeTargetBox | null {
  if (boxes.length === 0) return null;

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: OrangeTargetBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
    const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
    const edgeDx = anchorX - nearestX;
    const edgeDy = anchorY - nearestY;
    const edgeDistance = axisDistance(edgeDx, edgeDy);

    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (
      edgeDistance < bestEdgeDistance ||
      (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)
    ) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function findNearestYellowNode(
  boxes: MotherlodeMineBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MotherlodeMineBox | null {
  const yellowBoxes = boxes.filter((box) => box.color === "yellow");
  if (yellowBoxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MotherlodeMineBox | null = null;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const box of yellowBoxes) {
    const nearestX = clamp(anchorX, box.x, box.x + box.width - 1);
    const nearestY = clamp(anchorY, box.y, box.y + box.height - 1);
    const edgeDx = anchorX - nearestX;
    const edgeDy = anchorY - nearestY;
    const edgeDistance = axisDistance(edgeDx, edgeDy);

    const centerDx = anchorX - box.centerX;
    const centerDy = anchorY - box.centerY;
    const centerDistance = axisDistance(centerDx, centerDy);

    if (
      edgeDistance < bestEdgeDistance ||
      (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)
    ) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
}

function captureMineState(
  captureBounds: ScreenCaptureBounds,
  label: string,
  activeTargetScreen?: { x: number; y: number } | null,
): MineCaptureResult {
  const bitmap = screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);
  const boxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
  const greenBoxes = boxes.filter((b) => b.color === "green");
  const orangeBoxes = detectOrangeBoxesInScreenshot(bitmap);
  const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
  const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  const overlayBox = detectOverlayBoxInScreenshot(bitmap, currentWindowsScalePercent);
  const playerTileFromOverlay = overlayBox ? parseTileCoord(overlayBox.matchedLine) : null;

  debugCaptureIndex += 1;
  const filename = path.join(DEBUG_DIR, `${debugCaptureIndex}-motherlode-v2-${label}.png`);
  const activeTargetInCapture =
    activeTargetScreen !== undefined && activeTargetScreen !== null
      ? {
          x: activeTargetScreen.x - captureBounds.x,
          y: activeTargetScreen.y - captureBounds.y,
        }
      : null;
  saveBitmapWithMotherlodeMineBoxes(bitmap, boxes, filename, activeTargetInCapture, playerBox);

  return {
    boxes,
    greenBoxes,
    orangeBoxes,
    obstacleBox,
    playerBoxInCapture: playerBox,
    playerAnchorInCapture,
    playerTileFromOverlay,
    bagFullState: bagFullDetection.state,
  };
}

function captureDepositState(captureBounds: ScreenCaptureBounds, label: string): DepositCaptureResult {
  const bitmap = screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);
  const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
  const depositBox = detectBestMotherlodeDepositBoxInScreenshot(bitmap);
  const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;

  debugCaptureIndex += 1;
  const filename = path.join(DEBUG_DIR, `${debugCaptureIndex}-motherlode-v2-${label}.png`);
  const activeTargetInCapture = depositBox ? { x: depositBox.centerX, y: depositBox.centerY } : null;
  saveBitmapWithMotherlodeMineBoxes(bitmap, [], filename, activeTargetInCapture, playerBox);

  return {
    depositBox,
    obstacleBox,
    playerBoxInCapture: playerBox,
    playerAnchorInCapture,
    bagFullState: bagFullDetection.state,
  };
}

async function hoverAndReadTile(
  screenX: number,
  screenY: number,
  captureBounds: ScreenCaptureBounds,
): Promise<HoverTileReadResult> {
  if (ENABLE_NODE_HOVER_BEFORE_TILE_READ) {
    moveMouse(screenX, screenY);
    await sleepWithAbort(TOOLTIP_SETTLE_MS);
  }

  if (!AppState.automateBotRunning) {
    return { tile: null, source: "none", rawLine: null };
  }

  const bitmap = screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);
  let tileBox: ReturnType<typeof detectTileLocationBoxInScreenshot> = null;
  if (ENABLE_TILE_LOCATION_DETECTION) {
    tileBox = detectTileLocationBoxInScreenshot(bitmap);
    const tileFromPrimary = tileBox ? parseTileCoord(tileBox.matchedLine) : null;
    if (tileFromPrimary) {
      return {
        tile: tileFromPrimary,
        source: "tile-location",
        rawLine: tileBox?.matchedLine ?? null,
      };
    }
  }

  const overlayBox = detectOverlayBoxInScreenshot(bitmap, currentWindowsScalePercent);
  if (!overlayBox) {
    return {
      tile: null,
      source: "none",
      rawLine: tileBox?.matchedLine ?? null,
    };
  }

  const tileFromOverlay = parseTileCoord(overlayBox.matchedLine);
  return {
    tile: tileFromOverlay,
    source: tileFromOverlay ? "overlay" : "none",
    rawLine: tileFromOverlay ? overlayBox.matchedLine : (tileBox?.matchedLine ?? overlayBox.matchedLine),
  };
}

function updateBagState(current: BotState, nextState: MotherlodeBagFullState): BotState {
  const stable = isBagAtDepositThreshold(nextState) ? current.depositTriggerStableTicks + 1 : 0;
  return {
    ...current,
    bagFullState: nextState,
    depositTriggerStableTicks: stable,
  };
}

function maybeDecrementActionLock(current: BotState): BotState {
  if (current.actionLockTicks <= 0) return current;
  return { ...current, actionLockTicks: current.actionLockTicks - 1 };
}

async function runTick(state: BotState, captureBounds: ScreenCaptureBounds): Promise<BotState> {
  let current = maybeDecrementActionLock({ ...state, loopIndex: state.loopIndex + 1 });

  if (current.phase === "depositing") {
    const capture = captureDepositState(captureBounds, "deposit");
    current = updateBagState(current, capture.bagFullState);

    const depositDistancePx = getPlayerDistanceToDepositBox(capture.playerAnchorInCapture, capture.depositBox);
    const nearDeposit = isPlayerNearDepositBox(
      capture.playerAnchorInCapture,
      capture.depositBox,
      DEPOSIT_PLAYER_NEAR_RADIUS_PX,
    );
    const depositNearStableTicks = nearDeposit ? current.depositNearStableTicks + 1 : 0;
    let depositRetryTicks = current.depositRetryTicks;
    let depositLastDistancePx = current.depositLastDistancePx;

    if (nearDeposit) {
      depositRetryTicks = 0;
      depositLastDistancePx = depositDistancePx;
    } else if (!current.depositInFlight) {
      depositRetryTicks = 0;
      depositLastDistancePx = depositDistancePx;
    } else if (depositDistancePx === null) {
      depositRetryTicks += 1;
      depositLastDistancePx = null;
    } else if (
      depositLastDistancePx === null ||
      depositDistancePx < depositLastDistancePx - DEPOSIT_PROGRESS_EPSILON_PX
    ) {
      depositRetryTicks = 0;
      depositLastDistancePx = depositDistancePx;
    } else {
      depositRetryTicks += 1;
      depositLastDistancePx = depositDistancePx;
    }

    current = { ...current, depositNearStableTicks, depositRetryTicks, depositLastDistancePx };

    if (depositNearStableTicks >= DEPOSIT_NEAR_STABLE_TICKS) {
      if (current.bagFullState === "red") {
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit path stable but bag-full is still red. Switching to banking phase.`,
        );
        return resetToBanking(current);
      }

      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit path stable for ${depositNearStableTicks} ticks. Returning to search.`,
      );
      return resetToSearching(current);
    }

    if (current.actionLockTicks > 0) {
      return current;
    }

    if (
      capture.obstacleBox &&
      (shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox) ||
        (current.depositInFlight && current.depositRetryTicks >= 1))
    ) {
      const obstaclePoint = toObstacleInteractionScreenPoint(capture.obstacleBox, captureBounds);
      const clearReason = shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)
        ? "collision"
        : `stalled-${current.depositRetryTicks}`;
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit red obstacle at (${obstaclePoint.x},${obstaclePoint.y}) detected (${clearReason}). Clearing immediately.`,
      );
      clickScreenPoint(obstaclePoint.x, obstaclePoint.y);
      moveMouseAwayFromClickedNode(obstaclePoint.x, obstaclePoint.y, captureBounds);
      return {
        ...current,
        depositInFlight: false,
        depositRetryTicks: 0,
        depositLastDistancePx: depositDistancePx,
        actionLockTicks: OBSTACLE_CLICK_LOCK_TICKS,
      };
    }

    if (!capture.depositBox) {
      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit phase active but cyan deposit not found.`);
      return current;
    }

    if (!current.depositInFlight) {
      const point = toDepositInteractionScreenPoint(capture.depositBox, captureBounds);
      log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Clicking cyan deposit at (${point.x},${point.y}).`);
      clickScreenPoint(point.x, point.y);
      moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
      return {
        ...current,
        depositInFlight: true,
        depositRetryTicks: 0,
        depositLastDistancePx: depositDistancePx,
        actionLockTicks: DEPOSIT_CLICK_LOCK_TICKS,
      };
    }

    if (current.depositRetryTicks < DEPOSIT_STUCK_RETRY_TICKS) {
      return current;
    }

    const point = toDepositInteractionScreenPoint(capture.depositBox, captureBounds);
    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit travel stalled for ${current.depositRetryTicks} ticks. Retrying cyan deposit click at (${point.x},${point.y}).`,
    );
    clickScreenPoint(point.x, point.y);
    moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
    return {
      ...current,
      depositRetryTicks: 0,
      depositLastDistancePx: depositDistancePx,
      actionLockTicks: DEPOSIT_CLICK_LOCK_TICKS,
    };
  }

  const captureLabel = current.phase === "mining" ? "mine" : current.phase === "banking" ? "bank" : "search";
  const capture = captureMineState(captureBounds, captureLabel, current.activeScreen);
  current = updateBagState(current, capture.bagFullState);

  if (current.phase !== "banking" && current.depositTriggerStableTicks >= DEPOSIT_TRIGGER_STABLE_TICKS) {
    if (current.phase !== "depositing") {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full threshold stable for ${current.depositTriggerStableTicks} ticks. Switching to deposit.`,
      );
    }
    return resetToDepositing(current);
  }

  if (
    current.phase !== "banking" &&
    current.actionLockTicks === 0 &&
    shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)
  ) {
    const point = toObstacleInteractionScreenPoint(capture.obstacleBox, captureBounds);
    log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Clearing red obstacle at (${point.x},${point.y}).`);
    clickScreenPoint(point.x, point.y);
    moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
    return {
      ...resetToSearching(current),
      bagFullState: current.bagFullState,
      depositTriggerStableTicks: current.depositTriggerStableTicks,
      actionLockTicks: OBSTACLE_CLICK_LOCK_TICKS,
    };
  }

  if (current.phase === "banking") {
    if (current.bagFullState !== "red") {
      log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full no longer red. Leaving banking phase.`);
      return resetToSearching(current);
    }

    if (current.actionLockTicks === 0 && shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)) {
      const point = toObstacleInteractionScreenPoint(capture.obstacleBox, captureBounds);
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking collision with red obstacle at (${point.x},${point.y}). Clearing.`,
      );
      clickScreenPoint(point.x, point.y);
      moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
      return {
        ...current,
        actionLockTicks: OBSTACLE_CLICK_LOCK_TICKS,
      };
    }

    if (current.bankingStep === "wait-after-orange") {
      if (current.actionLockTicks > 0) {
        return current;
      }
      const tileText = capture.playerTileFromOverlay
        ? `${capture.playerTileFromOverlay.x},${capture.playerTileFromOverlay.y},${capture.playerTileFromOverlay.z}`
        : "unavailable";
      if (!isAtBankLadderDownTile(capture.playerTileFromOverlay)) {
        const nextRecheckCount = current.bankLadderRecheckCount + 1;
        if (nextRecheckCount <= BANK_LADDER_RECHECK_MAX) {
          const waitTicks = randomIntInclusive(BANK_LADDER_RECHECK_WAIT_MIN_TICKS, BANK_LADDER_RECHECK_WAIT_MAX_TICKS);
          warn(
            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking ladder descent not confirmed (tile=${tileText}, expected=${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y},*). Waiting ${waitTicks} ticks before re-check (${nextRecheckCount}/${BANK_LADDER_RECHECK_MAX}).`,
          );
          return {
            ...current,
            bankLadderRecheckCount: nextRecheckCount,
            actionLockTicks: waitTicks,
          };
        }

        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking ladder descent still not confirmed after ${current.bankLadderRecheckCount} re-checks (tile=${tileText}). Retrying ladder click.`,
        );
        return {
          ...current,
          bankingStep: "find-orange",
          bankSouthClicks: 0,
          bankLadderRecheckCount: 0,
        };
      }
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking ladder descent confirmed at tile ${BANK_EXPECTED_LADDER_DOWN_X},${BANK_EXPECTED_LADDER_DOWN_Y}. Moving south until yellow tile appears.`,
      );
      return {
        ...current,
        bankingStep: "move-south-until-yellow",
        bankSouthClicks: 0,
        bankLadderRecheckCount: 0,
      };
    }

    if (current.bankingStep === "yellow-clicked") {
      if (current.actionLockTicks > 0) {
        return current;
      }
      return current;
    }

    if (current.actionLockTicks > 0) {
      return current;
    }

    if (current.bankingStep === "find-orange") {
      const nearestOrangeBox = findNearestOrangeBox(capture.orangeBoxes, captureBounds, capture.playerAnchorInCapture);
      if (nearestOrangeBox) {
        const point = toOrangeInteractionScreenPoint(nearestOrangeBox, captureBounds);
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking phase clicking orange box at (${point.x},${point.y}) rgb˜(${BANK_ORANGE_TARGET_R},${BANK_ORANGE_TARGET_G},${BANK_ORANGE_TARGET_B}) pixels=${nearestOrangeBox.pixelCount}.`,
        );
        clickScreenPoint(point.x, point.y);
        moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);
        return {
          ...current,
          bankingStep: "wait-after-orange",
          bankSouthClicks: 0,
          bankLadderRecheckCount: 0,
          actionLockTicks: Math.max(BANK_CLICK_LOCK_TICKS, BANK_POST_ORANGE_WAIT_TICKS),
        };
      }

      const nearestYellowNodeForFallback = findNearestYellowNode(
        capture.boxes,
        captureBounds,
        capture.playerAnchorInCapture,
      );
      if (!nearestYellowNodeForFallback) {
        warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking phase active but no orange/yellow box found.`);
        return current;
      }

      const fallbackPoint = toYellowInteractionScreenPoint(nearestYellowNodeForFallback, captureBounds);
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Orange box not found; fallback clicking yellow box at (${fallbackPoint.x},${fallbackPoint.y}).`,
      );
      clickScreenPoint(fallbackPoint.x, fallbackPoint.y);
      moveMouseAwayFromClickedNode(fallbackPoint.x, fallbackPoint.y, captureBounds);
      return {
        ...current,
        bankingStep: "wait-after-orange",
        bankSouthClicks: 0,
        bankLadderRecheckCount: 0,
        actionLockTicks: Math.max(BANK_CLICK_LOCK_TICKS, BANK_POST_ORANGE_WAIT_TICKS),
      };
    }

    if (current.bankSouthClicks === 0) {
      if (!capture.playerTileFromOverlay) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking cannot verify start tile before first south click (overlay tile unavailable). Waiting.`,
        );
        return current;
      }
      if (!isAtBankLadderDownTile(capture.playerTileFromOverlay)) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking start tile mismatch before first south click (tile=${capture.playerTileFromOverlay.x},${capture.playerTileFromOverlay.y},${capture.playerTileFromOverlay.z}). Returning to ladder.`,
        );
        return { ...current, bankingStep: "find-orange", bankSouthClicks: 0 };
      }
    }

    if (current.bankSouthClicks >= BANK_SOUTH_CLICKS_BEFORE_YELLOW_CHECK) {
      const nearestYellowNode = findNearestYellowNode(capture.boxes, captureBounds, capture.playerAnchorInCapture);
      if (nearestYellowNode) {
        const yellowPoint = toYellowInteractionScreenPoint(nearestYellowNode, captureBounds);
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking found yellow tile at (${yellowPoint.x},${yellowPoint.y}); clicking.`,
        );
        clickScreenPoint(yellowPoint.x, yellowPoint.y);
        moveMouseAwayFromClickedNode(yellowPoint.x, yellowPoint.y, captureBounds);
        return {
          ...current,
          bankingStep: "yellow-clicked",
          actionLockTicks: BANK_YELLOW_TILE_CLICK_LOCK_TICKS,
        };
      }
    } else {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking south warmup ${current.bankSouthClicks}/${BANK_SOUTH_CLICKS_BEFORE_YELLOW_CHECK}; delaying yellow check.`,
      );
    }

    const southPoint = toSouthMoveScreenPoint(captureBounds, capture.playerAnchorInCapture);
    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Banking yellow tile not visible; clicking south at (${southPoint.x},${southPoint.y}).`,
    );
    clickScreenPoint(southPoint.x, southPoint.y);
    moveMouseAwayFromClickedNode(southPoint.x, southPoint.y, captureBounds);
    return {
      ...current,
      bankingStep: "move-south-until-yellow",
      bankSouthClicks: current.bankSouthClicks + 1,
      actionLockTicks: BANK_SOUTH_CLICK_LOCK_TICKS,
    };
  }

  if (current.phase === "searching") {
    const greenNode = selectNearestGreenMotherlodeNode(
      capture.greenBoxes,
      captureBounds,
      capture.playerAnchorInCapture,
    );

    if (!greenNode) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} No green node found (boxes=${capture.boxes.length}, green=${capture.greenBoxes.length}).`,
      );
      return current;
    }

    if (current.actionLockTicks > 0) {
      return current;
    }

    const interactionPoint = toNodeInteractionScreenPoint(greenNode, captureBounds);
    const trackingPoint = toNodeTrackingScreenPoint(greenNode, captureBounds);
    const tileRead = await hoverAndReadTile(interactionPoint.x, interactionPoint.y, captureBounds);
    if (!tileRead.tile) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Tile read failed for node (source=${tileRead.source}, raw='${tileRead.rawLine ?? ""}').`,
      );
      return current;
    }

    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Clicking node at tile (${tileRead.tile.x},${tileRead.tile.y},${tileRead.tile.z}) via ${tileRead.source}.`,
    );
    clickScreenPoint(interactionPoint.x, interactionPoint.y);
    moveMouseAwayFromClickedNode(interactionPoint.x, interactionPoint.y, captureBounds);
    return {
      ...current,
      phase: "mining",
      activeTile: tileRead.tile,
      activeScreen: { x: trackingPoint.x, y: trackingPoint.y },
      missingActiveTicks: 0,
      miningWaitTicks: 0,
      activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
      actionLockTicks: NODE_CLICK_LOCK_TICKS,
    };
  }

  if (!current.activeScreen) {
    warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Missing active tracking point; returning to search.`);
    return resetToSearching(current);
  }

  const nearbyAny = findNodeNearActiveScreen(capture.boxes, current.activeScreen, captureBounds);
  if (nearbyAny) {
    if (nearbyAny.color === "yellow") {
      log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node turned yellow. Searching next node.`);
      return resetToSearching(current);
    }

    const miningWaitTicks = current.miningWaitTicks + 1;
    if (miningWaitTicks >= current.activeNodeMaxWaitTicks) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node still ${nearbyAny.color} after ${miningWaitTicks} ticks. Re-searching.`,
      );
      return resetToSearching(current);
    }

    log(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Waiting on active node (${nearbyAny.color}) tick=${miningWaitTicks}/${current.activeNodeMaxWaitTicks}.`,
    );
    return { ...current, miningWaitTicks, missingActiveTicks: 0 };
  }

  const missingActiveTicks = current.missingActiveTicks + 1;
  if (missingActiveTicks <= ACTIVE_NODE_MISSING_GRACE_TICKS) {
    warn(
      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node not detected (${missingActiveTicks}/${ACTIVE_NODE_MISSING_GRACE_TICKS}).`,
    );
    return { ...current, missingActiveTicks };
  }

  log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Lost active node; returning to search.`);
  return resetToSearching(current);
}

async function runLoop(captureBounds: ScreenCaptureBounds): Promise<void> {
  if (isLoopRunning) {
    log(`Automate Bot (${BOT_NAME}): loop already running.`);
    return;
  }

  isLoopRunning = true;
  setAutomateBotCurrentStep(MINING_MOTHERLODE_MINE_V2_BOT_ID);

  let state: BotState = {
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    bagFullState: null,
    depositTriggerStableTicks: 0,
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
    actionLockTicks: 0,
    bankingStep: "find-orange",
    bankSouthClicks: 0,
    bankLadderRecheckCount: 0,
    loopIndex: 0,
  };

  let nextTickAt = Date.now();

  try {
    while (AppState.automateBotRunning) {
      const now = Date.now();
      if (now < nextTickAt) {
        await sleepWithAbort(nextTickAt - now);
        if (!AppState.automateBotRunning) break;
      }

      try {
        state = await runTick(state, captureBounds);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Automate Bot (${BOT_NAME}): #${state.loopIndex + 1} tick error - ${message}`);
      }

      nextTickAt += BASE_TICK_MS;
      const drift = Date.now() - nextTickAt;
      if (drift > BASE_TICK_MS) {
        nextTickAt = Date.now() + BASE_TICK_MS;
      }
    }
  } finally {
    isLoopRunning = false;
    startedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onMotherlodeMineBotV2Start(): void {
  if (!isLoopRunning) {
    startedAtMs = Date.now();
    debugCaptureIndex = 0;
    lastClickPoint = null;
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Automate Bot (${BOT_NAME}) config: tick=${BASE_TICK_MS}ms, hover-before-read=${ENABLE_NODE_HOVER_BEFORE_TILE_READ ? "on" : "off"}, obstacle-red-click=${ENABLE_OBSTACLE_RED_CLICK ? "on" : "off"}, post-click-mouse=${POST_CLICK_MOUSE_MOVE_MODE}.`,
  );

  const window = getRuneLite();
  if (!window) {
    const message = `${BOT_NAME} could not start because the RuneLite window was not found.`;
    warn(`Automate Bot (${BOT_NAME}): ${message}`);
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
    warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
    const message = "Cannot start - RuneLite window has zero size.";
    warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  log(`Automate Bot (${BOT_NAME}): startup camera prep (scroll down + compass north).`);
  moveMouseToWindowCenter(logicalBounds);
  scrollCameraDownToMaximum();
  tapCompassNorth();

  const scaleFactor = getWindowsDisplayScaleFactor(logicalBounds);
  const captureBounds = toPhysicalBounds(logicalBounds, scaleFactor);
  currentWindowsScalePercent = Math.round(scaleFactor * 100);

  void runLoop(captureBounds);
}
