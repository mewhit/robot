import { keyToggle, mouseClick, moveMouse, scrollMouse } from "robotjs";
import { screen as electronScreen } from "electron";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { captureScreenBitmap } from "../windowsScreenCapture";
import { MINING_MOTHERLODE_MINE_V3_BOT_ID } from "./definitions";
import { MotherlodeBagFullState, detectMotherlodeBagFullBoxInScreenshot } from "./shared/motherlode-bag-full-box-detector";
import { MotherlodeDepositBox, detectBestMotherlodeDepositBoxInScreenshot } from "./shared/motherlode-deposit-box-detector";
import { MotherlodeMineBox, detectMotherlodeMineBoxesInScreenshot } from "./shared/motherlode-mine-box-detector";
import { MotherlodeObstacleRedBox, detectBestMotherlodeObstacleRedBoxInScreenshot } from "./shared/motherlode-obstacle-red-detector";
import { PlayerBox, detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";
import { isPlayerCollidingWithObstacle as isPlayerCollidingWithObstacleBox } from "./shared/player-obstacle-collision";
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
const POST_CLICK_MOUSE_MOVE_MODE: PostClickMouseMoveMode = "off";
const POST_CLICK_MOUSE_OFFSET_PX = 200;
const POST_CLICK_CORNER_MARGIN_PX = 6;
const OBSTACLE_PLAYER_COLLISION_PADDING_PX = 4;
const DEPOSIT_TRIGGER_STABLE_TICKS = 2;
const NODE_CLICK_LOCK_TICKS = 3;
const OBSTACLE_CLICK_LOCK_TICKS = 2;
const DEPOSIT_CLICK_LOCK_TICKS = 1;
const ACTIVE_NODE_MISSING_GRACE_TICKS = 2;
const ACTIVE_NODE_MAX_WAIT_TICKS_MIN = 80;
const ACTIVE_NODE_MAX_WAIT_TICKS_MAX = 86;
const ACTIVE_NODE_MATCH_RADIUS_PX = 34;
const ACTIVE_NODE_YELLOW_PREFERENCE_MARGIN_PX = 6;
const BOX_CLICK_INNER_RATIO = 0.75;
const BOX_CLICK_PICK_MAX_ATTEMPTS = 12;
const MOVE_PLAYER_SPEED_TILES_PER_TICK = 2;
const MOVE_TILE_PX_FALLBACK = 64;
const MOVE_TILE_PX_MIN = 24;
const MOVE_TILE_PX_MAX = 96;
const MOVE_WAIT_MAX_TICKS = 10;
const MOVE_WAIT_EXTRA_TICKS = 1;

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
type BotPhase = "searching" | "mining" | "moving" | "depositing";
type EngineFunctionKey = "mine" | "searchOre" | "searchDeposit" | "move" | "deposit";
type MineSearchColor = "green" | "yellow" | "cyan";
type MineTargetBox = MotherlodeMineBox;
type MoveDestinationFunction = Exclude<EngineFunctionKey, "move">;
type PendingMoveTarget = {
  nextPhase: Exclude<BotPhase, "moving">;
  nextFunction: MoveDestinationFunction;
  targetScreen: { x: number; y: number };
};

type HoverTileReadResult = {
  tile: TileCoord | null;
  source: HoverTileReadSource;
  rawLine: string | null;
};

type SharedBotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  latestPhase: BotPhase | null;
  actionLockUntilMs: number;
};

type BotState =
  | (SharedBotState & {
      phase: Exclude<BotPhase, "moving">;
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
    })
  | MovingBotState;

type MovingBotState = SharedBotState & {
  phase: "moving";
  pendingMove: PendingMoveTarget;
};

type MineCaptureResult = {
  bitmap: RobotBitmap;
  boxes: MineTargetBox[];
  obstacleBox: MotherlodeObstacleRedBox | null;
  playerBoxInCapture: PlayerBox | null;
  playerAnchorInCapture: { x: number; y: number } | null;
  bagFullState: MotherlodeBagFullState;
};

type EngineTickCapture = {
  bitmap: RobotBitmap;
  captureBitmap: () => RobotBitmap;
};

let isLoopRunning = false;
let startedAtMs: number | null = null;
let lastClickPoint: { x: number; y: number } | null = null;
let currentWindowsScalePercent = 100;
let currentLogLoopIndex = 0;
let currentLogPhase: BotPhase | "startup" = "startup";

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

function setCurrentLogPhase(phase: BotPhase | null | undefined): void {
  if (phase === "searching" || phase === "mining" || phase === "moving" || phase === "depositing") {
    currentLogPhase = phase;
    return;
  }

  currentLogPhase = "startup";
}

function stripAutomateBotPrefix(message: string): string {
  return message
    .replace(/^Automate Bot\s*\([^)]*\):\s*/, "")
    .replace(/^Automate Bot\s*/, "")
    .trim();
}

function withLoopCountAtBeginning(message: string): string {
  const cleaned = stripAutomateBotPrefix(message);
  const prefixedLoop = cleaned.match(/^#(\d+)\s*(.*)$/);

  if (prefixedLoop) {
    const [, loop, rest] = prefixedLoop;
    return `#${loop} [${currentLogPhase}] ${rest}`.trimEnd();
  }

  return `#${currentLogLoopIndex} [${currentLogPhase}] ${cleaned}`.trimEnd();
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

function isActionLocked(state: Pick<SharedBotState, "actionLockUntilMs">, nowMs: number): boolean {
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

function moveMouseAwayFromClickedNode(clickedScreenX: number, clickedScreenY: number, captureBounds: ScreenCaptureBounds): void {
  const target = resolvePostClickMouseTarget(clickedScreenX, clickedScreenY, captureBounds);
  if (!target) return;
  moveMouse(target.x, target.y);
}

function clickScreenPoint(screenX: number, screenY: number): void {
  moveMouse(screenX, screenY);
  mouseClick("left", false);
  lastClickPoint = { x: screenX, y: screenY };
}

function getNodeUpperBiasedLocalY(node: MineTargetBox): number {
  const upwardBiasPx = Math.max(3, Math.round(node.height * 0.32));
  return Math.max(node.y + 1, node.centerY - upwardBiasPx);
}

function toNodeInteractionScreenPoint(node: MineTargetBox, captureBounds: ScreenCaptureBounds): { x: number; y: number } {
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

function toDepositInteractionScreenPoint(
  depositBox: Pick<MotherlodeDepositBox, "x" | "y" | "width" | "height">,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const innerX = getInnerRange(depositBox.x, depositBox.width, BOX_CLICK_INNER_RATIO);
  const innerY = getInnerRange(depositBox.y, depositBox.height, BOX_CLICK_INNER_RATIO);
  return pickDistinctScreenPointInLocalRange(innerX.min, innerX.max, innerY.min, innerY.max, captureBounds);
}

function detectBestCyanDepositBoxInScreenshot(bitmap: RobotBitmap): MotherlodeDepositBox | null {
  return detectBestMotherlodeDepositBoxInScreenshot(bitmap);
}

function detectBestRedObstacleBoxInScreenshot(bitmap: RobotBitmap): MotherlodeObstacleRedBox | null {
  return detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
}

function detectMineTargetBoxesInScreenshot(bitmap: RobotBitmap): MineTargetBox[] {
  return detectMotherlodeMineBoxesInScreenshot(bitmap).filter((box) => box.color === "green" || box.color === "yellow");
}

function isPlayerCollidingWithObstacle(playerBoxInCapture: PlayerBox | null, obstacleBox: MotherlodeObstacleRedBox | null): boolean {
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

function shouldStartDepositCycle(current: BotState): boolean {
  if (current.phase === "moving" || current.phase === "depositing") {
    return false;
  }

  if (current.depositTriggerStableTicks < DEPOSIT_TRIGGER_STABLE_TICKS) {
    return false;
  }

  return current.bagFullState !== null && isBagAtDepositThreshold(current.bagFullState);
}

function resolveSearchFunctionFromBagState(
  bagFullState: MotherlodeBagFullState | null,
  depositTriggerStableTicks: number,
): "searchOre" | "searchDeposit" {
  if (bagFullState !== null && isBagAtDepositThreshold(bagFullState) && depositTriggerStableTicks >= DEPOSIT_TRIGGER_STABLE_TICKS) {
    return "searchDeposit";
  }

  return "searchOre";
}

function resolvePendingMoveTransition(
  requestedNextPhase: BotPhase,
  color: MineSearchColor,
): { nextPhase: Exclude<BotPhase, "moving">; nextFunction: MoveDestinationFunction } {
  const nextPhase: Exclude<BotPhase, "moving"> = requestedNextPhase === "moving" ? "mining" : requestedNextPhase;

  if (nextPhase === "mining") {
    return {
      nextPhase,
      nextFunction: "mine",
    };
  }

  return {
    nextPhase: color === "cyan" ? "depositing" : nextPhase,
    nextFunction: color === "cyan" ? "deposit" : "searchOre",
  };
}

function updateBagState(current: BotState, nextState: MotherlodeBagFullState): BotState {
  if (current.phase === "moving") {
    return current;
  }

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
    currentFunction: "searchOre",
    phase: "searching",
    latestPhase: "searching",
    actionLockUntilMs: 0,
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
  };
}

function resetToSearching(current: BotState, _function: "searchOre" | "searchDeposit"): BotState {
  const bagFullState = "bagFullState" in current ? current.bagFullState : null;
  const depositTriggerStableTicks = "depositTriggerStableTicks" in current ? current.depositTriggerStableTicks : 0;

  return {
    loopIndex: current.loopIndex,
    currentFunction: _function,
    phase: "searching",
    latestPhase: current.phase,
    actionLockUntilMs: 0,
    activeTile: null,
    activeScreen: null,
    missingActiveTicks: 0,
    miningWaitTicks: 0,
    activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
    bagFullState,
    depositTriggerStableTicks,
    depositNearStableTicks: 0,
    depositRetryTicks: 0,
    depositInFlight: false,
    depositLastDistancePx: null,
  };
}

function captureMineState(bitmap: RobotBitmap): MineCaptureResult {
  const boxes = detectMineTargetBoxesInScreenshot(bitmap);
  const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  const obstacleBox = detectBestRedObstacleBoxInScreenshot(bitmap);
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

function findNodeNearActiveScreen(
  boxes: MineTargetBox[],
  activeScreen: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
): MineTargetBox | null {
  const activeX = activeScreen.x - captureBounds.x;
  const activeY = activeScreen.y - captureBounds.y;

  let best: MineTargetBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCenterDistance = Number.POSITIVE_INFINITY;
  let bestYellow: MineTargetBox | null = null;
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
      (distance < bestYellowDistance || (Math.abs(distance - bestYellowDistance) < 0.001 && centerDistance < bestYellowCenterDistance))
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
  boxes: MineTargetBox[],
  captureBounds: ScreenCaptureBounds,
  anchor: { x: number; y: number } | null,
): MineTargetBox | null {
  if (boxes.length === 0) {
    return null;
  }

  const anchorX = anchor?.x ?? Math.round(captureBounds.width / 2);
  const anchorY = anchor?.y ?? Math.round(captureBounds.height / 2);

  let best: MineTargetBox | null = null;
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

    if (edgeDistance < bestEdgeDistance || (Math.abs(edgeDistance - bestEdgeDistance) < 0.001 && centerDistance < bestCenterDistance)) {
      best = box;
      bestEdgeDistance = edgeDistance;
      bestCenterDistance = centerDistance;
    }
  }

  return best;
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
  const anchorScreenX = captureBounds.x + (playerBoxInCapture?.centerX ?? Math.round(captureBounds.width / 2));
  const anchorScreenY = captureBounds.y + (playerBoxInCapture?.centerY ?? Math.round(captureBounds.height / 2));
  const tilePx = estimateMoveTilePxFromPlayerBox(playerBoxInCapture);
  const dxPx = screenPoint.x - anchorScreenX;
  const dyPx = screenPoint.y - anchorScreenY;
  const distanceTiles = Math.max(Math.abs(dxPx) / tilePx, Math.abs(dyPx) / tilePx);

  return clamp(
    Math.ceil(distanceTiles / MOVE_PLAYER_SPEED_TILES_PER_TICK) + MOVE_WAIT_EXTRA_TICKS,
    NODE_CLICK_LOCK_TICKS,
    MOVE_WAIT_MAX_TICKS,
  );
}

type BotEngineContext<T = BotState> = {
  tickCapture: EngineTickCapture;
  state: T;
  nowMs: number;
  captureBounds: ScreenCaptureBounds;
};

const Osrs = {
  move: ({ captureBounds, state, nowMs, tickCapture }: BotEngineContext<MovingBotState>): BotState => {
    const stateWithLock = state;
    const pendingMove = stateWithLock.pendingMove;
    const currentLockUntilMs = stateWithLock.actionLockUntilMs;

    if (isDeadlineActive(currentLockUntilMs, nowMs)) {
      const collisionState = Osrs.searchSolidColoredTile(
        "green",
        "searching",
      )({
        tickCapture,
        state,
        nowMs,
        captureBounds,
      });
      if (collisionState !== state) {
        return collisionState;
      }

      const remainingMs = Math.max(0, currentLockUntilMs - nowMs);
      const remainingTicks = Math.max(1, Math.ceil(remainingMs / GAME_TICK_MS));
      if (state.loopIndex % 2 === 0) {
        log(
          `Automate Bot (${BOT_NAME}): #${state.loopIndex} [move] Moving to (${pendingMove.targetScreen.x},${pendingMove.targetScreen.y}); waiting ${remainingTicks} more tick(s).`,
        );
      }

      return state;
    }

    if (currentLockUntilMs <= 0) {
      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const moveWaitTicks = estimateMoveTravelTicks(
        { x: pendingMove.targetScreen.x, y: pendingMove.targetScreen.y },
        captureBounds,
        playerBox,
      );

      clickScreenPoint(pendingMove.targetScreen.x, pendingMove.targetScreen.y);
      moveMouseAwayFromClickedNode(pendingMove.targetScreen.x, pendingMove.targetScreen.y, captureBounds);

      log(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} [move] Clicking move target (${pendingMove.targetScreen.x},${pendingMove.targetScreen.y}); eta ~${moveWaitTicks} tick(s).`,
      );

      return {
        ...stateWithLock,
        actionLockUntilMs: deadlineFromNowTicks(moveWaitTicks),
      } as BotState;
    }

    const nextPhase = pendingMove.nextPhase;
    const nextFunction = pendingMove.nextFunction;
    const bagFullState = ("bagFullState" in stateWithLock ? stateWithLock.bagFullState : null) as MotherlodeBagFullState | null;
    const depositTriggerStableTicks = (
      "depositTriggerStableTicks" in stateWithLock ? stateWithLock.depositTriggerStableTicks : 0
    ) as number;

    log(`Automate Bot (${BOT_NAME}): #${state.loopIndex} [move] Movement complete; transitioning to ${nextPhase}/${nextFunction}.`);

    if (nextPhase === "mining") {
      return {
        loopIndex: state.loopIndex,
        phase: "mining",
        latestPhase: "moving",
        currentFunction: "mine",
        actionLockUntilMs: 0,
        activeTile: null,
        // Use the move click target as the active tracking anchor for mining-state matching.
        activeScreen: { x: pendingMove.targetScreen.x, y: pendingMove.targetScreen.y },
        missingActiveTicks: 0,
        miningWaitTicks: 0,
        activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
        bagFullState,
        depositTriggerStableTicks,
        depositNearStableTicks: 0,
        depositRetryTicks: 0,
        depositInFlight: false,
        depositLastDistancePx: null,
      } as BotState;
    }

    if (nextPhase === "depositing" || nextFunction === "deposit") {
      return {
        loopIndex: state.loopIndex,
        phase: "depositing",
        latestPhase: "moving",
        currentFunction: "deposit",
        actionLockUntilMs: deadlineFromNowTicks(DEPOSIT_CLICK_LOCK_TICKS),
        activeTile: null,
        activeScreen: null,
        missingActiveTicks: 0,
        miningWaitTicks: 0,
        activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
        bagFullState,
        depositTriggerStableTicks,
        depositNearStableTicks: 0,
        depositRetryTicks: 0,
        depositInFlight: false,
        depositLastDistancePx: null,
      } as BotState;
    }

    return {
      loopIndex: state.loopIndex,
      phase: "searching",
      latestPhase: "moving",
      currentFunction: "searchOre",
      actionLockUntilMs: 0,
      activeTile: null,
      activeScreen: null,
      missingActiveTicks: 0,
      miningWaitTicks: 0,
      activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
      bagFullState,
      depositTriggerStableTicks,
      depositNearStableTicks: 0,
      depositRetryTicks: 0,
      depositInFlight: false,
      depositLastDistancePx: null,
    } as BotState;
  },
  deposit: ({ tickCapture, state, nowMs }: BotEngineContext): BotState => {
    if (state.phase === "moving") {
      return state;
    }

    const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
    const updatedState = updateBagState(state, bagFullState);

    if (updatedState.phase === "moving") {
      return updatedState;
    }

    const current = updatedState;

    if (isActionLocked(current, nowMs)) {
      return current;
    }

    const bagAtDepositThreshold = current.bagFullState !== null && isBagAtDepositThreshold(current.bagFullState);
    if (!bagAtDepositThreshold) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit] Deposit complete (bag=${current.bagFullState ?? "none"}). Returning to search.`,
      );
      return resetToSearching(current, "searchOre");
    }

    if (current.loopIndex % 3 === 0) {
      warn(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [deposit] Deposit not confirmed yet (bag=${current.bagFullState}). Re-searching cyan deposit.`,
      );
    }

    return resetToSearching(current, "searchDeposit");
  },
  searchBorderedTile:
    (color: MineSearchColor, nextPhase: BotPhase) =>
    ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
      if (color !== "cyan") {
        return state;
      }

      const targetDepositBox = detectBestCyanDepositBoxInScreenshot(tickCapture.bitmap);

      if (!targetDepositBox) {
        if (state.loopIndex % 3 === 0) {
          warn(`Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-bordered] Bag full but cyan deposit target was not found.`);
        }
        return state;
      }

      const interactionPoint = toDepositInteractionScreenPoint(targetDepositBox, captureBounds);
      const transition = resolvePendingMoveTransition(nextPhase, color);

      log(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-bordered] Found cyan deposit at (${interactionPoint.x},${interactionPoint.y}); queueing move -> ${transition.nextPhase}/${transition.nextFunction}.`,
      );

      return {
        ...state,
        phase: "moving",
        latestPhase: state.phase,
        currentFunction: "move",
        pendingMove: {
          nextPhase: transition.nextPhase,
          nextFunction: transition.nextFunction,
          targetScreen: { x: interactionPoint.x, y: interactionPoint.y },
        },
        actionLockUntilMs: 0,
      };
    },
  searchSolidColoredTile:
    (color: MineSearchColor, nextPhase: BotPhase) =>
    ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const obstacleBox = detectBestRedObstacleBoxInScreenshot(tickCapture.bitmap);

      if (!shouldClearRedObstacle(playerBox, obstacleBox)) {
        return state;
      }

      const point = toObstacleInteractionScreenPoint(obstacleBox, captureBounds);
      const bagFullState = detectMotherlodeBagFullBoxInScreenshot(tickCapture.bitmap).state;
      const stateWithDeposit = state as BotState & { depositTriggerStableTicks?: number };
      const previousDepositTicks =
        typeof stateWithDeposit.depositTriggerStableTicks === "number" ? stateWithDeposit.depositTriggerStableTicks : 0;
      const depositTriggerStableTicks = isBagAtDepositThreshold(bagFullState)
        ? Math.min(DEPOSIT_TRIGGER_STABLE_TICKS, previousDepositTicks + 1)
        : 0;
      const searchFunction = resolveSearchFunctionFromBagState(bagFullState, depositTriggerStableTicks);

      warn(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-solid] Clearing red obstacle at (${point.x},${point.y}) [${color} -> ${nextPhase}].`,
      );
      clickScreenPoint(point.x, point.y);
      moveMouseAwayFromClickedNode(point.x, point.y, captureBounds);

      return {
        loopIndex: state.loopIndex,
        currentFunction: searchFunction,
        phase: "searching",
        latestPhase: state.latestPhase ?? state.phase,
        actionLockUntilMs: 0,
        activeTile: null,
        activeScreen: null,
        missingActiveTicks: 0,
        miningWaitTicks: 0,
        activeNodeMaxWaitTicks: randomIntInclusive(ACTIVE_NODE_MAX_WAIT_TICKS_MIN, ACTIVE_NODE_MAX_WAIT_TICKS_MAX),
        bagFullState,
        depositTriggerStableTicks,
        depositNearStableTicks: 0,
        depositRetryTicks: 0,
        depositInFlight: false,
        depositLastDistancePx: null,
      } as BotState;
    },
  searchColoredCircle:
    (color: MineSearchColor, nextPhase: BotPhase) =>
    ({ tickCapture, state, nowMs, captureBounds }: BotEngineContext): BotState => {
      if (color === "cyan") {
        return state;
      }

      const mineColor = color as MineTargetBox["color"];
      const allMineBoxes = detectMineTargetBoxesInScreenshot(tickCapture.bitmap);
      const colorBoxes = allMineBoxes.filter((box) => box.color === mineColor);
      const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
      const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
      const targetNode = selectNearestMineNodeByAnchor(colorBoxes, captureBounds, playerAnchor);

      if (!targetNode) {
        if (state.loopIndex % 3 === 0) {
          warn(
            `Automate Bot (${BOT_NAME}): #${state.loopIndex} search(${mineColor} -> ${nextPhase}) found no target (boxes=${allMineBoxes.length}, color=${colorBoxes.length}).`,
          );
        }
        return state;
      }

      const interactionPoint = toNodeInteractionScreenPoint(targetNode, captureBounds);
      const transition = resolvePendingMoveTransition(nextPhase, mineColor);

      log(
        `Automate Bot (${BOT_NAME}): #${state.loopIndex} [search-colored-circle] Found ${mineColor} node (boxes=${allMineBoxes.length}, color=${colorBoxes.length}) at (${interactionPoint.x},${interactionPoint.y}); queueing move -> ${transition.nextPhase}/${transition.nextFunction}.`,
      );

      return {
        ...state,
        phase: "moving",
        latestPhase: state.phase,
        currentFunction: "move",
        pendingMove: {
          nextPhase: transition.nextPhase,
          nextFunction: transition.nextFunction,
          targetScreen: { x: interactionPoint.x, y: interactionPoint.y },
        },
        actionLockUntilMs: 0,
      };
    },
};

const runMineFunction = createMineFunction<BotState, MineCaptureResult, EngineTickCapture>({
  capture: (state, _nowMs, tickCapture) => {
    setCurrentLogLoopIndex(state.loopIndex);
    setCurrentLogPhase(state.phase);
    const capture = captureMineState(tickCapture.bitmap);
    const current = updateBagState(state, capture.bagFullState);
    return { state: current, capture };
  },
  beforePhase: (current, capture, nowMs, tickCapture) => {
    const isCurrentLocked = current.phase === "moving" ? isActionLocked(current, nowMs) : false;

    if (current.phase !== "moving" && !isCurrentLocked && shouldClearRedObstacle(capture.playerBoxInCapture, capture.obstacleBox)) {
      return Osrs.searchSolidColoredTile(
        "green",
        "searching",
      )({
        tickCapture,
        state: current,
        nowMs,
        captureBounds: captureBoundsRef!,
      });
    }

    return null;
  },

  runMiningPhase: (current, capture, nowMs, tickCapture) => {
    if (current.phase === "searching") {
      return {
        ...current,
        currentFunction: "searchOre",
      } as BotState;
    }

    if (current.phase === "moving") {
      return {
        ...current,
        currentFunction: "move",
      } as BotState;
    }

    if (current.phase === "depositing") {
      return {
        ...current,
        currentFunction: "deposit",
      } as BotState;
    }

    if (shouldStartDepositCycle(current)) {
      log(
        `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Bag-full threshold stable (${current.bagFullState}); switching to searchDeposit.`,
      );
      return resetToSearching(current, "searchDeposit");
    }

    if (!current.activeScreen) {
      warn(`Automate Bot (${BOT_NAME}): #${current.loopIndex} Missing active tracking point; returning to search.`);
      return resetToSearching(current, "searchOre");
    }

    const nearbyAny = findNodeNearActiveScreen(capture.boxes, current.activeScreen, captureBoundsRef!);
    if (nearbyAny) {
      if (nearbyAny.color !== "green") {
        log(`Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node is now ${nearbyAny.color}. Searching next node.`);
        return resetToSearching(current, "searchOre");
      }

      const miningWaitTicks = current.miningWaitTicks + 1;
      if (miningWaitTicks >= current.activeNodeMaxWaitTicks) {
        warn(
          `Automate Bot (${BOT_NAME}): #${current.loopIndex} [mine] Active node still ${nearbyAny.color} after ${miningWaitTicks} ticks. Re-searching.`,
        );
        return resetToSearching(current, "searchOre");
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
    return resetToSearching(current, "searchOre");
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
    await runBotEngine<BotState, EngineFunctionKey, EngineTickCapture>({
      tickMs: BASE_TICK_MS,
      isRunning: () => AppState.automateBotRunning,
      createInitialState: createInitialBotState,
      captureTick: () => ({
        bitmap: captureScreenBitmap(captureBounds),
        captureBitmap: () => captureScreenBitmap(captureBounds),
      }),
      functions: {
        mine: ({ state, nowMs, tickCapture }) => runMineFunction(state, nowMs, tickCapture),
        deposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "depositing") {
            return state.phase === "moving" ? state : resetToSearching(state, "searchDeposit");
          }

          return Osrs.deposit({ tickCapture, state, nowMs, captureBounds });
        },
        searchDeposit: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "searching") {
            return {
              ...state,
              currentFunction: state.phase === "moving" ? "move" : state.phase === "depositing" ? "deposit" : "mine",
            } as BotState;
          }

          return Osrs.searchBorderedTile("cyan", "depositing")({ tickCapture, state, nowMs, captureBounds });
        },
        searchOre: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);

          if (state.phase !== "searching") {
            return {
              ...state,
              currentFunction: state.phase === "moving" ? "move" : state.phase === "depositing" ? "deposit" : "mine",
            } as BotState;
          }

          return Osrs.searchColoredCircle("green", "moving")({ tickCapture, state, nowMs, captureBounds });
        },
        move: ({ state, nowMs, tickCapture }) => {
          setCurrentLogLoopIndex(state.loopIndex);
          setCurrentLogPhase(state.phase);
          return state.phase === "moving" ? Osrs.move({ state, nowMs, captureBounds, tickCapture }) : state;
        },
      },
      onTickError: (error, state) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`#${state.loopIndex} [${state.phase}] tick error - ${message}`);
      },
    });
  } finally {
    captureBoundsRef = null;
    isLoopRunning = false;
    startedAtMs = null;
    setCurrentLogPhase(null);
    setAutomateBotCurrentStep(null);
  }
}

export function onMotherlodeMineBotV3Start(): void {
  setCurrentLogLoopIndex(0);
  setCurrentLogPhase("searching");

  if (!isLoopRunning) {
    startedAtMs = Date.now();
    lastClickPoint = null;
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Automate Bot (${BOT_NAME}) config: engineTick=${BASE_TICK_MS}ms, engineFunctions={searchOre,searchDeposit,move,mine,deposit}, hover-before-read=${ENABLE_NODE_HOVER_BEFORE_TILE_READ ? "on" : "off"}, obstacle-red-click=${ENABLE_OBSTACLE_RED_CLICK ? "on" : "off"}.`,
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
