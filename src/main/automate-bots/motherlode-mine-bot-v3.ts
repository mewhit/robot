import { keyToggle, mouseClick, moveMouse, scrollMouse } from "robotjs";
import { screen as electronScreen } from "electron";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap } from "../windowsScreenCapture";
import { MINING_MOTHERLODE_MINE_V3_BOT_ID } from "./definitions";
import { MotherlodeMineBox, detectMotherlodeMineBoxesInScreenshot } from "./shared/motherlode-mine-box-detector";
import {
  MotherlodeBagFullState,
  detectMotherlodeBagFullBoxInScreenshot,
} from "./shared/motherlode-bag-full-box-detector";
import {
  MotherlodeObstacleRedBox,
  detectBestMotherlodeObstacleRedBoxInScreenshot,
} from "./shared/motherlode-obstacle-red-detector";
import { isPlayerCollidingWithObstacle as isPlayerCollidingWithObstacleBox } from "./shared/player-obstacle-collision";
import { PlayerBox, detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";
import { detectTileLocationBoxInScreenshot } from "./shared/tile-location-detection";
import { detectOverlayBoxInScreenshot } from "./shared/coordinate-box-detector";
import { createMineFunction, runBotEngine, sleepWithAbort } from "./engine/bot-engine";
import { RobotBitmap } from "./shared/ocr-engine";

const BOT_NAME = "Motherlode Mine V3";
const CAMERA_SCROLL_TICKS = 35;
const CAMERA_SCROLL_DELTA_Y = 120;
const NORTH_KEY_HOLD_MS = 100;

const GAME_TICK_MS = 600;
const BASE_TICK_MS = GAME_TICK_MS;
const TOOLTIP_SETTLE_MS = 400;
const ENABLE_TILE_LOCATION_DETECTION = false;
const ENABLE_NODE_HOVER_BEFORE_TILE_READ = true;
const ENABLE_OBSTACLE_RED_CLICK = true;
const POST_CLICK_MOUSE_MOVE_MODE: PostClickMouseMoveMode = "offset-200";
const POST_CLICK_MOUSE_OFFSET_PX = 200;
const POST_CLICK_CORNER_MARGIN_PX = 6;
const OBSTACLE_PLAYER_COLLISION_PADDING_PX = 4;
const DEPOSIT_TRIGGER_STABLE_TICKS = 2;
const NODE_CLICK_LOCK_TICKS = 3;
const OBSTACLE_CLICK_LOCK_TICKS = 2;
const ACTIVE_NODE_MISSING_GRACE_TICKS = 2;
const ACTIVE_NODE_MAX_WAIT_TICKS_MIN = 80;
const ACTIVE_NODE_MAX_WAIT_TICKS_MAX = 86;
const ACTIVE_NODE_MATCH_RADIUS_PX = 34;
const ACTIVE_NODE_YELLOW_PREFERENCE_MARGIN_PX = 6;
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
type BotPhase = "searching" | "mining";
type EngineFunctionKey = "mine";

type HoverTileReadResult = {
  tile: TileCoord | null;
  source: HoverTileReadSource;
  rawLine: string | null;
};

type BotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  activeTile: TileCoord | null;
  activeScreen: { x: number; y: number } | null;
  missingActiveTicks: number;
  miningWaitTicks: number;
  activeNodeMaxWaitTicks: number;
  actionLockUntilMs: number;
  bagFullState: MotherlodeBagFullState | null;
  depositTriggerStableTicks: number;
};

type MineCaptureResult = {
  bitmap: RobotBitmap;
  boxes: MotherlodeMineBox[];
  obstacleBox: MotherlodeObstacleRedBox | null;
  playerBoxInCapture: PlayerBox | null;
  playerAnchorInCapture: { x: number; y: number } | null;
  bagFullState: MotherlodeBagFullState;
};

let isLoopRunning = false;
let startedAtMs: number | null = null;
let lastClickPoint: { x: number; y: number } | null = null;
let currentWindowsScalePercent = 100;
let currentLogLoopIndex = 0;

function formatElapsedSinceStart(): string {
  if (startedAtMs === null) return "+0ms";
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const ms = String(elapsedMs % 1000).padStart(3, "0");
  return `+${mm}:${ss}.${ms}`;
}

function setCurrentLogLoopIndex(loopIndex: number): void {
  if (!Number.isFinite(loopIndex) || loopIndex < 0) {
    currentLogLoopIndex = 0;
    return;
  }

  currentLogLoopIndex = Math.floor(loopIndex);
}

function withLoopCountAtBeginning(message: string): string {
  const alreadyPrefixed = message.match(/^#\d+\s/);
  if (alreadyPrefixed) {
    return message;
  }

  const embeddedLoop = message.match(/^(Automate Bot \([^)]*\):)\s*#(\d+)\s*(.*)$/);
  if (embeddedLoop) {
    const [, prefix, loop, rest] = embeddedLoop;
    return `#${loop} ${prefix} ${rest}`.trimEnd();
  }

  return `#${currentLogLoopIndex} ${message}`;
}

function log(message: string): void {
  logger.log(`[${formatElapsedSinceStart()}] ${withLoopCountAtBeginning(message)}`);
}

function warn(message: string): void {
  logger.warn(`[${formatElapsedSinceStart()}] ${withLoopCountAtBeginning(message)}`);
}

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }

  stopAutomateBot("bot");
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

function parseTileCoord(matchedLine: string): TileCoord | null {
  const parts = matchedLine.split(",");
  if (parts.length < 3) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function ticksToMs(ticks: number): number {
  if (!Number.isFinite(ticks) || ticks <= 0) {
    return 0;
  }
  return Math.ceil(ticks * GAME_TICK_MS);
}

function deadlineFromNowTicks(ticks: number): number {
  const durationMs = ticksToMs(ticks);
  return durationMs > 0 ? Date.now() + durationMs : 0;
}

function isDeadlineActive(deadlineMs: number, nowMs: number): boolean {
  return deadlineMs > nowMs;
}

function isActionLocked(state: BotState, nowMs: number): boolean {
  return isDeadlineActive(state.actionLockUntilMs, nowMs);
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

function toObstacleInteractionScreenPoint(
  obstacleBox: MotherlodeObstacleRedBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getInnerRange(obstacleBox.x, obstacleBox.width, BOX_CLICK_INNER_RATIO);
  const innerY = getInnerRange(obstacleBox.y, obstacleBox.height, BOX_CLICK_INNER_RATIO);
  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, innerY.max, captureBounds);
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

function updateBagState(current: BotState, nextState: MotherlodeBagFullState): BotState {
  const stable = isBagAtDepositThreshold(nextState) ? current.depositTriggerStableTicks + 1 : 0;
  return {
    ...current,
    bagFullState: nextState,
    depositTriggerStableTicks: stable,
  };
}

function createInitialBotState(): BotState {
  return {
    loopIndex: 0,
    currentFunction: "mine",
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    actionLockUntilMs: 0,
    bagFullState: null,
    depositTriggerStableTicks: 0,
  };
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
    actionLockUntilMs: 0,
  };
}

function captureMineState(captureBounds: ScreenCaptureBounds): MineCaptureResult {
  const bitmap = captureScreenBitmap(captureBounds);
  const boxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
  const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
  const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;

  return {
    bitmap,
    boxes,
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
    await sleepWithAbort(TOOLTIP_SETTLE_MS, () => AppState.automateBotRunning);
  }

  if (!AppState.automateBotRunning) {
    return { tile: null, source: "none", rawLine: null };
  }

  const bitmap = captureScreenBitmap(captureBounds);
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
  let bestYellow: MotherlodeMineBox | null = null;
  let bestYellowDistance = Number.POSITIVE_INFINITY;
  let bestYellowCenterDistance = Number.POSITIVE_INFINITY;

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

    if (
      box.color === "yellow" &&
      (distance < bestYellowDistance ||
        (Math.abs(distance - bestYellowDistance) < 0.001 && centerDistance < bestYellowCenterDistance))
    ) {
      bestYellowDistance = distance;
      bestYellowCenterDistance = centerDistance;
      bestYellow = box;
    }
  }

  if (bestYellow && (!best || bestYellowDistance <= bestDistance + ACTIVE_NODE_YELLOW_PREFERENCE_MARGIN_PX)) {
    return bestYellow;
  }

  return best;
}

function selectNearestMineNodeByAnchor(
  boxes: MotherlodeMineBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MotherlodeMineBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MotherlodeMineBox | null = null;
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

type OsrsSearchContext = {
  bitmap: RobotBitmap;
  state: BotState;
  nowMs: number;
  captureBounds: ScreenCaptureBounds;
};

const Osrs = {
  search:
    (color: MotherlodeMineBox["color"], nextPhase: BotPhase) =>
    async ({ bitmap, state, nowMs, captureBounds }: OsrsSearchContext): Promise<BotState> => {
      const allMineBoxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
      const colorBoxes = allMineBoxes.filter((box) => box.color === color);
      const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
      const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
      const targetNode = selectNearestMineNodeByAnchor(colorBoxes, captureBounds, playerAnchor);

      if (!targetNode) {
        if (state.loopIndex % 3 === 0) {
          warn(
            `Automate Bot (${BOT_NAME}): #${state.loopIndex} search(${color} -> ${nextPhase}) found no target (boxes=${allMineBoxes.length}, color=${colorBoxes.length}).`,
          );
        }
        return state;
      }

      if (isActionLocked(state, nowMs)) {
        return state;
      }

      const interactionPoint = toNodeInteractionScreenPoint(targetNode, captureBounds);
      const tileRead = await hoverAndReadTile(interactionPoint.x, interactionPoint.y, captureBounds);
      if (!tileRead.tile) {
        warn(
          `Automate Bot (${BOT_NAME}): #${state.loopIndex} search(${color} -> ${nextPhase}) tile read failed (source=${tileRead.source}, raw='${tileRead.rawLine ?? ""}').`,
        );
        return state;
      }

      log(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} search(${color} -> ${nextPhase}) clicking tile (${tileRead.tile.x},${tileRead.tile.y},${tileRead.tile.z}) via ${tileRead.source}.`,
      );
      clickScreenPoint(interactionPoint.x, interactionPoint.y);
      moveMouseAwayFromClickedNode(interactionPoint.x, interactionPoint.y, captureBounds);

      if (nextPhase === "mining") {
        return {
          ...state,
          phase: nextPhase,
          activeTile: tileRead.tile,
          activeScreen: { x: interactionPoint.x, y: interactionPoint.y },
          missingActiveTicks: 0,
          miningWaitTicks: 0,
          activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
          actionLockUntilMs: deadlineFromNowTicks(NODE_CLICK_LOCK_TICKS),
        };
      }

      return {
        ...state,
        phase: nextPhase,
        actionLockUntilMs: deadlineFromNowTicks(NODE_CLICK_LOCK_TICKS),
      };
    },
};

const searchOre = Osrs.search("green", "mining");

const runMineFunction = createMineFunction<BotState, MineCaptureResult>({
  capture: (state) => {
    setCurrentLogLoopIndex(state.loopIndex);
    const capture = captureMineState(captureBoundsRef!);
    const current = updateBagState(state, capture.bagFullState);
    return { state: current, capture };
  },
  beforePhase: (current, capture, nowMs) => {
    if (current.depositTriggerStableTicks === DEPOSIT_TRIGGER_STABLE_TICKS) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full threshold is stable (${current.bagFullState}). Deposit/banking flow is not wired yet in v3; staying in mine function.`,
      );
    }

    if (!isActionLocked(current, nowMs) && shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)) {
      const point = toObstacleInteractionScreenPoint(capture.obstacleBox, captureBoundsRef!);
      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Clearing red obstacle at (${point.x},${point.y}).`);
      clickScreenPoint(point.x, point.y);
      moveMouseAwayFromClickedNode(point.x, point.y, captureBoundsRef!);
      return {
        ...resetToSearching(current),
        bagFullState: current.bagFullState,
        depositTriggerStableTicks: current.depositTriggerStableTicks,
        actionLockUntilMs: deadlineFromNowTicks(OBSTACLE_CLICK_LOCK_TICKS),
      };
    }

    return null;
  },
  runSearchingPhase: (current, capture, nowMs) =>
    searchOre({
      bitmap: capture.bitmap,
      state: current,
      nowMs,
      captureBounds: captureBoundsRef!,
    }),
  runMiningPhase: (current, capture) => {
    if (!current.activeScreen) {
      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Missing active tracking point; returning to search.`);
      return resetToSearching(current);
    }

    const nearbyAny = findNodeNearActiveScreen(capture.boxes, current.activeScreen, captureBoundsRef!);
    if (nearbyAny) {
      if (nearbyAny.color !== "green") {
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node is now ${nearbyAny.color}. Searching next node.`,
        );
        return resetToSearching(current);
      }

      const miningWaitTicks = current.miningWaitTicks + 1;
      if (miningWaitTicks >= current.activeNodeMaxWaitTicks) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node still ${nearbyAny.color} after ${miningWaitTicks} ticks. Re-searching.`,
        );
        return resetToSearching(current);
      }

      if (current.loopIndex % 2 === 0) {
        log(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Waiting on active node (${nearbyAny.color}) tick=${miningWaitTicks}/${current.activeNodeMaxWaitTicks}.`,
        );
      }
      return { ...current, miningWaitTicks, missingActiveTicks: 0 };
    }

    const missingActiveTicks = current.missingActiveTicks + 1;
    if (missingActiveTicks <= ACTIVE_NODE_MISSING_GRACE_TICKS) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node not detected (${missingActiveTicks}/${ACTIVE_NODE_MISSING_GRACE_TICKS}).`,
      );
      return { ...current, missingActiveTicks };
    }

    log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Lost active node; returning to search.`);
    return resetToSearching(current);
  },
});

let captureBoundsRef: ScreenCaptureBounds | null = null;

async function runLoop(captureBounds: ScreenCaptureBounds): Promise<void> {
  if (isLoopRunning) {
    log(`Automate Bot (${BOT_NAME}): loop already running.`);
    return;
  }

  captureBoundsRef = captureBounds;
  isLoopRunning = true;
  setAutomateBotCurrentStep(MINING_MOTHERLODE_MINE_V3_BOT_ID);

  try {
    await runBotEngine<BotState, EngineFunctionKey>({
      tickMs: BASE_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: createInitialBotState,
      functions: {
        mine: ({ state, nowMs }) => runMineFunction(state, nowMs),
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`#${state.loopIndex} Automate Bot (${BOT_NAME}): tick error - ${message}`);
      },
    });
  } finally {
    captureBoundsRef = null;
    isLoopRunning = false;
    startedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onMotherlodeMineBotV3Start(): void {
  setCurrentLogLoopIndex(0);

  if (!isLoopRunning) {
    startedAtMs = Date.now();
    lastClickPoint = null;
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Automate Bot (${BOT_NAME}) config: engineTick=${BASE_TICK_MS}ms, engineFunctions={mine}, hover-before-read=${ENABLE_NODE_HOVER_BEFORE_TILE_READ ? "on" : "off"}, obstacle-red-click=${ENABLE_OBSTACLE_RED_CLICK ? "on" : "off"}.`,
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
