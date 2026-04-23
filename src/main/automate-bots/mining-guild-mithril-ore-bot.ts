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
import { detectMithrilActiveMarkerBoxesInScreenshot, MithrilActiveMarkerBox } from "./shared/mithril-active-marker-detector";
import { detectMithrilOreBoxesInScreenshot, MithrilOreBox } from "./shared/mithril-ore-detector";
import { RobotBitmap } from "./shared/ocr-engine";
import { detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";

const BOT_NAME = "Mining Guild Mithril Ore";
const GAME_TICK_MS = 600;
const CAMERA_PITCH_HOLD_MS = 2400;
const NORTH_KEY_HOLD_MS = 100;
const STARTUP_SETTLE_MS = 180;
const ORE_RECLICK_COOLDOWN_TICKS = 10;
const MOVE_MAX_WAIT_TICKS = 18;
const MOVE_TARGET_LOST_GRACE_TICKS = 4;
const ACTIVE_MARKER_MATCH_RADIUS_PX = 96;
const SAME_ORE_MATCH_RADIUS_PX = 56;
const TARGET_ORE_MATCH_RADIUS_PX = 110;
const PLAYER_ORE_MAX_EDGE_DISTANCE_PX = 500;
const POST_CLICK_MOUSE_OFFSET_PX = 200;
const POST_CLICK_CORNER_MARGIN_PX = 6;

type ScreenCaptureBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type BotPhase = "searching" | "moving";
type EngineFunctionKey = "searchOre" | "move";

type BotState = {
  loopIndex: number;
  currentFunction: EngineFunctionKey;
  phase: BotPhase;
  actionLockUntilMs: number;
  lastClickedOreScreen: { x: number; y: number } | null;
  targetScreen: { x: number; y: number } | null;
  moveWaitTicks: number;
};

type TickCapture = {
  bitmap: RobotBitmap;
};

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

function setCurrentLogPhase(phase: BotPhase | null | undefined): void {
  if (phase === "searching" || phase === "moving") {
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

function isSameOreScreenTarget(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
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

function findActiveMarkerNearTargetScreen(
  boxes: MithrilActiveMarkerBox[],
  targetScreen: { x: number; y: number },
  captureBounds: ScreenCaptureBounds,
): MithrilActiveMarkerBox | null {
  const localX = targetScreen.x - captureBounds.x;
  const localY = targetScreen.y - captureBounds.y;

  let best: MithrilActiveMarkerBox | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const distance = distanceToBox(localX, localY, box);
    if (distance > ACTIVE_MARKER_MATCH_RADIUS_PX) {
      continue;
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      best = box;
    }
  }

  return best;
}

function toOreInteractionScreenPoint(
  oreBox: MithrilOreBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  const upwardBiasPx = Math.max(2, Math.round(oreBox.height * 0.22));
  return {
    x: captureBounds.x + oreBox.centerX,
    y: captureBounds.y + Math.max(oreBox.y + 1, oreBox.centerY - upwardBiasPx),
  };
}

function toOreTrackingScreenPoint(
  oreBox: MithrilOreBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return {
    x: captureBounds.x + oreBox.centerX,
    y: captureBounds.y + oreBox.centerY,
  };
}

function clickScreenPoint(screenX: number, screenY: number): void {
  moveMouse(screenX, screenY);
  mouseClick("left", false);
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

  if (minX > maxX || minY > maxY) {
    return null;
  }

  return {
    x: clamp(clickedScreenX - POST_CLICK_MOUSE_OFFSET_PX, minX, maxX),
    y: clamp(clickedScreenY - POST_CLICK_MOUSE_OFFSET_PX, minY, maxY),
  };
}

function moveMouseAwayFromClickedTarget(
  clickedScreenX: number,
  clickedScreenY: number,
  captureBounds: ScreenCaptureBounds,
): void {
  const target = resolvePostClickMouseTarget(clickedScreenX, clickedScreenY, captureBounds);
  if (!target) {
    return;
  }

  moveMouse(target.x, target.y);
}

function deadlineFromNowTicks(ticks: number): number {
  return Date.now() + Math.max(0, ticks) * GAME_TICK_MS;
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
    targetScreen: null,
    moveWaitTicks: 0,
  };
}

function createInitialState(): BotState {
  return {
    loopIndex: 0,
    currentFunction: "searchOre",
    phase: "searching",
    actionLockUntilMs: 0,
    lastClickedOreScreen: null,
    targetScreen: null,
    moveWaitTicks: 0,
  };
}

function runSearchOreTick(state: BotState, nowMs: number, tickCapture: TickCapture, captureBounds: ScreenCaptureBounds): BotState {
  const oreBoxes = detectMithrilOreBoxesInScreenshot(tickCapture.bitmap);
  const playerBox = detectBestPlayerBoxInScreenshot(tickCapture.bitmap);
  const playerAnchor = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;
  const sameOreLocked = isActionLocked(state, nowMs) && !!state.lastClickedOreScreen;
  const selectableOreBoxes =
    sameOreLocked && state.lastClickedOreScreen
      ? oreBoxes.filter((box) => {
          const trackingPoint = toOreTrackingScreenPoint(box, captureBounds);
          return !isSameOreScreenTarget(trackingPoint, state.lastClickedOreScreen!);
        })
      : oreBoxes;
  const selectedOre = selectNearestMithrilOre(selectableOreBoxes, tickCapture.bitmap, playerAnchor);

  if (sameOreLocked && selectableOreBoxes.length === 0) {
    if (state.loopIndex % 2 === 0) {
      log(`Waiting ${remainingLockTicks(state, nowMs)} tick(s) before re-clicking the same ore.`);
    }
    return state;
  }

  if (!selectedOre) {
    if (state.loopIndex % 3 === 0) {
      warn(
        `No mithril ore found (boxes=${oreBoxes.length}, selectable=${selectableOreBoxes.length}, anchor=${playerAnchor ? `${playerAnchor.x},${playerAnchor.y}` : "none"}).`,
      );
    }
    return state;
  }

  const interactionPoint = toOreInteractionScreenPoint(selectedOre, captureBounds);
  const trackingPoint = toOreTrackingScreenPoint(selectedOre, captureBounds);
  const edgeDistance = playerAnchor ? distanceToBox(playerAnchor.x, playerAnchor.y, selectedOre) : null;

  log(
    `Selected mithril ore center=(${selectedOre.centerX},${selectedOre.centerY}) size=${selectedOre.width}x${selectedOre.height} blue=${selectedOre.blueDominance.toFixed(1)} edge=${edgeDistance ?? "?"}; clicking (${interactionPoint.x},${interactionPoint.y}).`,
  );

  clickScreenPoint(interactionPoint.x, interactionPoint.y);
  moveMouseAwayFromClickedTarget(interactionPoint.x, interactionPoint.y, captureBounds);

  return {
    ...state,
    phase: "moving",
    currentFunction: "move",
    actionLockUntilMs: deadlineFromNowTicks(ORE_RECLICK_COOLDOWN_TICKS),
    lastClickedOreScreen: trackingPoint,
    targetScreen: trackingPoint,
    moveWaitTicks: 0,
  };
}

function runMoveTick(state: BotState, nowMs: number, tickCapture: TickCapture, captureBounds: ScreenCaptureBounds): BotState {
  if (!state.targetScreen) {
    warn(`Missing target screen while moving; returning to search.`);
    return resetToSearchingState(state);
  }

  const activeMarkers = detectMithrilActiveMarkerBoxesInScreenshot(tickCapture.bitmap);
  const matchedMarker = findActiveMarkerNearTargetScreen(activeMarkers, state.targetScreen, captureBounds);
  if (matchedMarker) {
    log(
      `Active yellow marker detected at (${matchedMarker.centerX},${matchedMarker.centerY}) after ${state.moveWaitTicks} move tick(s); mithril is mined, searching next ore.`,
    );

    return resetToSearchingState(state, state.actionLockUntilMs);
  }

  const oreBoxes = detectMithrilOreBoxesInScreenshot(tickCapture.bitmap);
  const nearbyOre = findOreNearTargetScreen(oreBoxes, state.targetScreen, captureBounds);
  const moveWaitTicks = state.moveWaitTicks + 1;

  if (!nearbyOre && moveWaitTicks >= MOVE_TARGET_LOST_GRACE_TICKS) {
    warn(`Target ore disappeared before active marker appeared after ${moveWaitTicks} tick(s); re-searching.`);
    return resetToSearchingState(state, state.actionLockUntilMs);
  }

  if (moveWaitTicks >= MOVE_MAX_WAIT_TICKS) {
    warn(`No active marker near target after ${moveWaitTicks} tick(s); re-searching.`);
    return resetToSearchingState(state, state.actionLockUntilMs);
  }

  if (state.loopIndex % 2 === 0) {
    log(`Waiting for movement/mining start (tick=${moveWaitTicks}/${MOVE_MAX_WAIT_TICKS}, markers=${activeMarkers.length}, ore-near=${nearbyOre ? "yes" : "no"}).`);
  }

  return {
    ...state,
    moveWaitTicks,
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
  log(`Config: engineTick=${GAME_TICK_MS}ms, startup='hold-w+north', player-ore-max-edge=${PLAYER_ORE_MAX_EDGE_DISTANCE_PX}px.`);

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
