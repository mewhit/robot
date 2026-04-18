import path from "path";
import { Effect, pipe } from "effect";
import { keyToggle, mouseClick, moveMouse, screen, scrollMouse } from "robotjs";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { MINING_MOTHERLODE_MINE_BOT_ID } from "./definitions";
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
import { PlayerBox, detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";
import { selectNearestGreenMotherlodeNode } from "./shared/motherlode-target-selection";
import { screen as electronScreen } from "electron";
import { detectTileLocationBoxInScreenshot } from "./shared/tile-location-detection";
import { detectOverlayBoxInScreenshot } from "./shared/coordinate-box-detector";

const BOT_NAME = "Motherlode Mine";
const DEBUG_DIR = "ocr-debug";
const CAMERA_SCROLL_TICKS = 35;
const CAMERA_SCROLL_DELTA_Y = 120;
const NORTH_KEY_HOLD_MS = 100;

// How long to wait after moving the mouse before reading the tile tooltip (ms).
const TOOLTIP_SETTLE_MS = 400;
// Temporary switch: bypass tile-location OCR and use overlay-only tile reads.
const ENABLE_TILE_LOCATION_DETECTION = false;
// Toggle whether to hover the node before reading tile/overlay text.
const ENABLE_NODE_HOVER_BEFORE_TILE_READ = true;
// Toggle clearing red collision obstacles by clicking the detected red marker.
const ENABLE_OBSTACLE_RED_CLICK = false;
// Move mouse away after clicking so the cursor does not obscure node color detection.
const POST_CLICK_MOUSE_MOVE_MODE: PostClickMouseMoveMode = "offset-200";
const POST_CLICK_MOUSE_OFFSET_PX = 200;
const POST_CLICK_CORNER_MARGIN_PX = 6;
// Short pause between hover/decision logging and the click action.
const PRE_CLICK_SETTLE_MS = 140;
// How often to poll the active node during mining (ms).
const POLL_INTERVAL_MS = 900;
// How long to wait after clicking a node before starting to poll (ms).
const POST_CLICK_SETTLE_MS = 1500;
// Pixel radius around the clicked node center to match the same rock later.
const ACTIVE_NODE_MATCH_RADIUS_PX = 34;
// Allow brief detection dropouts (e.g. low-opacity transition) before re-searching.
const ACTIVE_NODE_MISSING_GRACE_POLLS = 3;
// Failsafe: if the matched active node never flips yellow for too long, force a re-search.
const ACTIVE_NODE_MAX_WAIT_POLLS = 35;
// After clearing a red obstacle, let scene markers settle before next action.
const OBSTACLE_POST_CLICK_SETTLE_MS = 650;
// How long the player must remain near the cyan deposit box before resuming (ms).
const DEPOSIT_PLAYER_NEAR_TICK_MS = 600;
const DEPOSIT_PLAYER_NEAR_RADIUS_PX = 48;
// Treat obstacle as blocking only when it overlaps the detected player highlight box.
const OBSTACLE_PLAYER_COLLISION_PADDING_PX = 4;

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

type HoverTileReadResult = {
  tile: TileCoord | null;
  source: HoverTileReadSource;
  rawLine: string | null;
};

type BotPhase = "searching" | "mining" | "depositing";

interface BotState {
  phase: BotPhase;
  activeTile: TileCoord | null;
  activeScreen: { x: number; y: number } | null;
  missingActivePolls: number;
  miningWaitPolls: number;
  bagFullState: MotherlodeBagFullState | null;
  loopIndex: number;
}

let isLoopRunning = false;
let startedAtMs: number | null = null;
let debugCaptureIndex = 0;

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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return;
  }

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

    if (distance > ACTIVE_NODE_MATCH_RADIUS_PX) {
      continue;
    }

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

function toNodeInteractionScreenPoint(
  node: MotherlodeMineBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  // Ore vein tags can be ring-like; center can land on walkable ground.
  // Bias upward within the box to better hit the vein model.
  const localX = node.centerX;
  const localY = getNodeUpperBiasedLocalY(node);

  return {
    x: captureBounds.x + localX,
    y: captureBounds.y + localY,
  };
}

function getNodeUpperBiasedLocalY(node: MotherlodeMineBox): number {
  const upwardBiasPx = Math.max(3, Math.round(node.height * 0.32));
  return Math.max(node.y + 1, node.centerY - upwardBiasPx);
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
  return {
    x: captureBounds.x + depositBox.centerX,
    y: captureBounds.y + depositBox.centerY,
  };
}

function toObstacleInteractionScreenPoint(
  obstacleBox: MotherlodeObstacleRedBox,
  captureBounds: ScreenCaptureBounds,
): { x: number; y: number } {
  return {
    x: captureBounds.x + obstacleBox.centerX,
    y: captureBounds.y + obstacleBox.centerY,
  };
}

function isDepositTriggerTransition(
  previousState: MotherlodeBagFullState | null,
  nextState: MotherlodeBagFullState,
): boolean {
  if (previousState === null) {
    return false;
  }

  return (previousState === "native" && nextState === "green") || (previousState === "yellow" && nextState === "red");
}

function isPlayerNearDepositBox(
  playerAnchorInCapture: { x: number; y: number } | null,
  depositBox: MotherlodeDepositBox | null,
  radiusPx: number,
): boolean {
  if (!playerAnchorInCapture || !depositBox) {
    return false;
  }

  const nearestX = clamp(playerAnchorInCapture.x, depositBox.x, depositBox.x + depositBox.width - 1);
  const nearestY = clamp(playerAnchorInCapture.y, depositBox.y, depositBox.y + depositBox.height - 1);
  const dx = playerAnchorInCapture.x - nearestX;
  const dy = playerAnchorInCapture.y - nearestY;

  return Math.sqrt(dx * dx + dy * dy) <= radiusPx;
}

function isPlayerCollidingWithObstacle(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): boolean {
  if (!playerBoxInCapture || !obstacleBox) {
    return false;
  }

  const playerLeft = playerBoxInCapture.x;
  const playerTop = playerBoxInCapture.y;
  const playerRight = playerBoxInCapture.x + playerBoxInCapture.width - 1;
  const playerBottom = playerBoxInCapture.y + playerBoxInCapture.height - 1;

  const obstacleLeft = obstacleBox.x - OBSTACLE_PLAYER_COLLISION_PADDING_PX;
  const obstacleTop = obstacleBox.y - OBSTACLE_PLAYER_COLLISION_PADDING_PX;
  const obstacleRight = obstacleBox.x + obstacleBox.width - 1 + OBSTACLE_PLAYER_COLLISION_PADDING_PX;
  const obstacleBottom = obstacleBox.y + obstacleBox.height - 1 + OBSTACLE_PLAYER_COLLISION_PADDING_PX;

  return !(
    playerRight < obstacleLeft ||
    obstacleRight < playerLeft ||
    playerBottom < obstacleTop ||
    obstacleBottom < playerTop
  );
}

function shouldClearRedObstacle(
  playerBoxInCapture: PlayerBox | null,
  obstacleBox: MotherlodeObstacleRedBox | null,
): obstacleBox is MotherlodeObstacleRedBox {
  return ENABLE_OBSTACLE_RED_CLICK && isPlayerCollidingWithObstacle(playerBoxInCapture, obstacleBox);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function axisDistance(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
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

  if (POST_CLICK_MOUSE_MOVE_MODE === "top-left") {
    return { x: minX, y: minY };
  }

  if (POST_CLICK_MOUSE_MOVE_MODE === "offset-200") {
    return {
      x: clamp(clickedScreenX - POST_CLICK_MOUSE_OFFSET_PX, minX, maxX),
      y: clamp(clickedScreenY - POST_CLICK_MOUSE_OFFSET_PX, minY, maxY),
    };
  }

  return null;
}

async function runLoop(captureBounds: ScreenCaptureBounds): Promise<void> {
  if (isLoopRunning) {
    log(`Automate Bot (${BOT_NAME}): loop already running.`);
    return;
  }

  isLoopRunning = true;
  setAutomateBotCurrentStep(MINING_MOTHERLODE_MINE_BOT_ID);

  let state: BotState = {
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActivePolls: 0,
    miningWaitPolls: 0,
    bagFullState: null,
    loopIndex: 0,
  };

  // Keep loop logic self-contained so the phase flow can be read top-to-bottom as a story.
  type CaptureResult = {
    boxes: MotherlodeMineBox[];
    greenBoxes: MotherlodeMineBox[];
    obstacleBox: MotherlodeObstacleRedBox | null;
    playerBoxInCapture: PlayerBox | null;
    playerAnchorInCapture: { x: number; y: number } | null;
    bagFullState: MotherlodeBagFullState;
  };

  type DepositCaptureResult = {
    depositBox: MotherlodeDepositBox | null;
    obstacleBox: MotherlodeObstacleRedBox | null;
    playerBoxInCapture: PlayerBox | null;
    playerAnchorInCapture: { x: number; y: number } | null;
    bagFullState: MotherlodeBagFullState;
  };

  const resetToSearchingState = (current: BotState): BotState => ({
    ...current,
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActivePolls: 0,
    miningWaitPolls: 0,
  });

  const resetToDepositingState = (current: BotState): BotState => ({
    ...current,
    phase: "depositing",
    activeTile: null,
    activeScreen: null,
    missingActivePolls: 0,
    miningWaitPolls: 0,
  });

  const sleepEffect = (ms: number): Effect.Effect<void, Error> =>
    Effect.tryPromise({
      try: () => sleepWithAbort(ms),
      catch: toError,
    });

  const captureAndDetectEffect = (
    label: string,
    activeTargetScreen?: { x: number; y: number } | null,
  ): Effect.Effect<CaptureResult, Error> =>
    Effect.try({
      try: () => {
        const bitmap = screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);
        const boxes = detectMotherlodeMineBoxesInScreenshot(bitmap);
        const greenBoxes = boxes.filter((b) => b.color === "green");
        const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
        const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
        const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
        const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;

        debugCaptureIndex += 1;
        const filename = path.join(DEBUG_DIR, `${debugCaptureIndex}-motherlode-${label}.png`);
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
          obstacleBox,
          playerBoxInCapture: playerBox,
          playerAnchorInCapture,
          bagFullState: bagFullDetection.state,
        };
      },
      catch: toError,
    });

  const captureDepositStateEffect = (label: string): Effect.Effect<DepositCaptureResult, Error> =>
    Effect.try({
      try: () => {
        const bitmap = screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);
        const bagFullDetection = detectMotherlodeBagFullBoxInScreenshot(bitmap);
        const depositBox = detectBestMotherlodeDepositBoxInScreenshot(bitmap);
        const obstacleBox = detectBestMotherlodeObstacleRedBoxInScreenshot(bitmap);
        const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
        const playerAnchorInCapture = playerBox ? { x: playerBox.centerX, y: playerBox.centerY } : null;

        debugCaptureIndex += 1;
        const filename = path.join(DEBUG_DIR, `${debugCaptureIndex}-motherlode-${label}.png`);
        const activeTargetInCapture = depositBox ? { x: depositBox.centerX, y: depositBox.centerY } : null;
        saveBitmapWithMotherlodeMineBoxes(bitmap, [], filename, activeTargetInCapture, playerBox);

        return {
          depositBox,
          obstacleBox,
          playerBoxInCapture: playerBox,
          playerAnchorInCapture,
          bagFullState: bagFullDetection.state,
        };
      },
      catch: toError,
    });

  const clickScreenPointEffect = (screenX: number, screenY: number): Effect.Effect<void, Error> =>
    Effect.try({
      try: () => {
        moveMouse(screenX, screenY);
        mouseClick("left", false);
      },
      catch: toError,
    });

  const clickObstacleEffect = (obstacleBox: MotherlodeObstacleRedBox): Effect.Effect<void, Error> => {
    const clickPoint = toObstacleInteractionScreenPoint(obstacleBox, captureBounds);
    return pipe(
      clickScreenPointEffect(clickPoint.x, clickPoint.y),
      Effect.zipRight(moveMouseAwayFromClickedNodeEffect(clickPoint.x, clickPoint.y)),
    );
  };

  const hoverAndReadTileEffect = (screenX: number, screenY: number): Effect.Effect<HoverTileReadResult, Error> =>
    Effect.tryPromise({
      try: async () => {
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

        // Fallback: use the top-left coordinate overlay detector when tile-location OCR misses.
        const overlayBox = detectOverlayBoxInScreenshot(bitmap);
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
      },
      catch: toError,
    });

  const clickNodeEffect = (): Effect.Effect<void, Error> =>
    Effect.try({
      try: () => {
        // Mouse is already positioned over the node from the preceding hover.
        mouseClick("left", false);
      },
      catch: toError,
    });

  const moveMouseAwayFromClickedNodeEffect = (
    clickedScreenX: number,
    clickedScreenY: number,
  ): Effect.Effect<void, Error> =>
    Effect.try({
      try: () => {
        const target = resolvePostClickMouseTarget(clickedScreenX, clickedScreenY, captureBounds);
        if (!target) {
          return;
        }

        moveMouse(target.x, target.y);
      },
      catch: toError,
    });

  const logEffect = (message: string): Effect.Effect<void> =>
    Effect.sync(() => {
      log(message);
    });

  const warnEffect = (message: string): Effect.Effect<void> =>
    Effect.sync(() => {
      warn(message);
    });

  const whenSearching =
    (story: (current: BotState) => Effect.Effect<BotState, Error>) =>
    (source: Effect.Effect<BotState, Error>): Effect.Effect<BotState, Error> =>
      pipe(
        source,
        Effect.flatMap((current) => (current.phase === "searching" ? story(current) : Effect.succeed(current))),
      );

  const whenMining =
    (story: (current: BotState) => Effect.Effect<BotState, Error>) =>
    (source: Effect.Effect<BotState, Error>): Effect.Effect<BotState, Error> =>
      pipe(
        source,
        Effect.flatMap((current) => (current.phase === "mining" ? story(current) : Effect.succeed(current))),
      );

  const whenDepositing =
    (story: (current: BotState) => Effect.Effect<BotState, Error>) =>
    (source: Effect.Effect<BotState, Error>): Effect.Effect<BotState, Error> =>
      pipe(
        source,
        Effect.flatMap((current) => (current.phase === "depositing" ? story(current) : Effect.succeed(current))),
      );

  type SearchNodeStep = {
    current: BotState;
    greenNode: MotherlodeMineBox | null;
    obstacleBox: MotherlodeObstacleRedBox | null;
    totalBoxCount: number;
    greenBoxCount: number;
    playerBoxInCapture: PlayerBox | null;
    playerAnchorInCapture: { x: number; y: number } | null;
    shouldStartDepositing: boolean;
    nextBagFullState: MotherlodeBagFullState;
    previousBagFullState: MotherlodeBagFullState | null;
  };

  type MiningScanStep = {
    current: BotState;
    boxes: MotherlodeMineBox[];
    greenBoxes: MotherlodeMineBox[];
    obstacleBox: MotherlodeObstacleRedBox | null;
    playerBoxInCapture: PlayerBox | null;
    shouldStartDepositing: boolean;
    nextBagFullState: MotherlodeBagFullState;
    previousBagFullState: MotherlodeBagFullState | null;
  };

  const findMinableNode =
    (story: (src: Effect.Effect<BotState, Error>) => Effect.Effect<SearchNodeStep, Error>) =>
    (source: Effect.Effect<BotState, Error>): Effect.Effect<SearchNodeStep, Error> =>
      story(source);

  const clickStartMining =
    (story: (src: Effect.Effect<SearchNodeStep, Error>) => Effect.Effect<BotState, Error>) =>
    (source: Effect.Effect<SearchNodeStep, Error>): Effect.Effect<BotState, Error> =>
      story(source);

  const scanMiningNodeState =
    (story: (src: Effect.Effect<BotState, Error>) => Effect.Effect<MiningScanStep, Error>) =>
    (source: Effect.Effect<BotState, Error>): Effect.Effect<MiningScanStep, Error> =>
      story(source);

  const resolveMiningNodeState =
    (story: (src: Effect.Effect<MiningScanStep, Error>) => Effect.Effect<BotState, Error>) =>
    (source: Effect.Effect<MiningScanStep, Error>): Effect.Effect<BotState, Error> =>
      story(source);

  try {
    while (AppState.automateBotRunning) {
      const tickState: BotState = { ...state, loopIndex: state.loopIndex + 1 };
      state = await Effect.runPromise(
        pipe(
          Effect.succeed(tickState),
          whenSearching((current) =>
            pipe(
              Effect.succeed(current),
              findMinableNode((src) =>
                pipe(
                  src,
                  Effect.flatMap((current) =>
                    pipe(
                      captureAndDetectEffect("search"),
                      Effect.map(
                        ({
                          boxes,
                          greenBoxes,
                          obstacleBox,
                          playerBoxInCapture,
                          playerAnchorInCapture,
                          bagFullState,
                        }) => {
                          const previousBagFullState = current.bagFullState;
                          const shouldStartDepositing = isDepositTriggerTransition(previousBagFullState, bagFullState);
                          const currentWithBagState: BotState = { ...current, bagFullState };

                          return {
                            current: currentWithBagState,
                            greenNode: selectNearestGreenMotherlodeNode(
                              greenBoxes,
                              captureBounds,
                              playerAnchorInCapture,
                            ),
                            obstacleBox,
                            totalBoxCount: boxes.length,
                            greenBoxCount: greenBoxes.length,
                            playerBoxInCapture,
                            playerAnchorInCapture,
                            shouldStartDepositing,
                            nextBagFullState: bagFullState,
                            previousBagFullState,
                          };
                        },
                      ),
                    ),
                  ),
                ),
              ),
              clickStartMining((src) =>
                pipe(
                  src,
                  Effect.flatMap(
                    ({
                      current,
                      greenNode,
                      obstacleBox,
                      totalBoxCount,
                      greenBoxCount,
                      playerBoxInCapture,
                      playerAnchorInCapture,
                      shouldStartDepositing,
                      nextBagFullState,
                      previousBagFullState,
                    }) => {
                      if (shouldStartDepositing) {
                        if (shouldClearRedObstacle(playerBoxInCapture, obstacleBox)) {
                          const obstacleClickPoint = toObstacleInteractionScreenPoint(obstacleBox, captureBounds);
                          return pipe(
                            logEffect(
                              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full transition ${previousBagFullState ?? "none"}->${nextBagFullState} detected with red obstacle at (${obstacleClickPoint.x},${obstacleClickPoint.y}). Clearing obstacle first, then depositing.`,
                            ),
                            Effect.zipRight(clickObstacleEffect(obstacleBox)),
                            Effect.zipRight(sleepEffect(OBSTACLE_POST_CLICK_SETTLE_MS)),
                            Effect.as(resetToDepositingState(current)),
                          );
                        }

                        return pipe(
                          logEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full transition ${previousBagFullState ?? "none"}->${nextBagFullState} detected. Clicking cyan deposit box next.`,
                          ),
                          Effect.as(resetToDepositingState(current)),
                        );
                      }

                      if (shouldClearRedObstacle(playerBoxInCapture, obstacleBox)) {
                        const obstacleClickPoint = toObstacleInteractionScreenPoint(obstacleBox, captureBounds);
                        return pipe(
                          logEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Red obstacle detected at (${obstacleClickPoint.x},${obstacleClickPoint.y}) while searching. Clearing obstacle before trying to mine.`,
                          ),
                          Effect.zipRight(clickObstacleEffect(obstacleBox)),
                          Effect.zipRight(sleepEffect(OBSTACLE_POST_CLICK_SETTLE_MS)),
                          Effect.as(current),
                        );
                      }

                      if (!greenNode) {
                        return pipe(
                          warnEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} No green node found (boxes=${totalBoxCount}, green=${greenBoxCount}, anchor=${playerAnchorInCapture ? `${playerAnchorInCapture.x},${playerAnchorInCapture.y}` : "none"}). Retrying.`,
                          ),
                          Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                          Effect.as(current),
                        );
                      }

                      const interactionPoint = toNodeInteractionScreenPoint(greenNode, captureBounds);
                      const trackingPoint = toNodeTrackingScreenPoint(greenNode, captureBounds);
                      const nodeScreenX = interactionPoint.x;
                      const nodeScreenY = interactionPoint.y;

                      return pipe(
                        logEffect(
                          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Selected node box center=(${greenNode.centerX},${greenNode.centerY}) size=${greenNode.width}x${greenNode.height} score=${greenNode.score.toFixed(1)} click=(${nodeScreenX},${nodeScreenY}) track=(${trackingPoint.x},${trackingPoint.y}) boxes=${totalBoxCount} green=${greenBoxCount}.`,
                        ),
                        Effect.zipRight(hoverAndReadTileEffect(nodeScreenX, nodeScreenY)),
                        Effect.flatMap((tileRead) => {
                          const activeTile = tileRead.tile;
                          if (!activeTile) {
                            return pipe(
                              warnEffect(
                                `Automate Bot (${BOT_NAME}): #${current.loopIndex} Could not read tile from hover/overlay for nearest green node (source=${tileRead.source}, raw='${tileRead.rawLine ?? ""}'). Skipping click and retrying.`,
                              ),
                              Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                              Effect.as(current),
                            );
                          }

                          const nextState: BotState = {
                            ...current,
                            phase: "mining",
                            activeTile,
                            activeScreen: { x: trackingPoint.x, y: trackingPoint.y },
                            missingActivePolls: 0,
                            miningWaitPolls: 0,
                          };

                          return pipe(
                            logEffect(
                              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Nearest green node at tile (${activeTile.x},${activeTile.y},${activeTile.z}) via ${tileRead.source}. Clicking.`,
                            ),
                            Effect.zipRight(sleepEffect(PRE_CLICK_SETTLE_MS)),
                            Effect.flatMap(() =>
                              AppState.automateBotRunning
                                ? pipe(
                                    clickNodeEffect(),
                                    Effect.zipRight(moveMouseAwayFromClickedNodeEffect(nodeScreenX, nodeScreenY)),
                                  )
                                : Effect.void,
                            ),
                            Effect.zipRight(sleepEffect(POST_CLICK_SETTLE_MS)),
                            Effect.as(nextState),
                          );
                        }),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
          whenMining((current) =>
            pipe(
              Effect.succeed(current),
              scanMiningNodeState((src) =>
                pipe(
                  src,
                  Effect.flatMap((current) =>
                    pipe(
                      // MINING: keep monitoring the same target until it turns yellow, then go back to searching.
                      captureAndDetectEffect("mine", current.activeScreen),
                      Effect.map(({ boxes, greenBoxes, obstacleBox, playerBoxInCapture, bagFullState }) => {
                        const previousBagFullState = current.bagFullState;
                        const shouldStartDepositing = isDepositTriggerTransition(previousBagFullState, bagFullState);
                        const currentWithBagState: BotState = { ...current, bagFullState };

                        return {
                          current: currentWithBagState,
                          boxes,
                          greenBoxes,
                          obstacleBox,
                          playerBoxInCapture,
                          shouldStartDepositing,
                          nextBagFullState: bagFullState,
                          previousBagFullState,
                        };
                      }),
                    ),
                  ),
                ),
              ),
              resolveMiningNodeState((src) =>
                pipe(
                  src,
                  Effect.flatMap(
                    ({
                      current,
                      boxes,
                      greenBoxes,
                      obstacleBox,
                      playerBoxInCapture,
                      shouldStartDepositing,
                      nextBagFullState,
                      previousBagFullState,
                    }) => {
                      if (shouldStartDepositing) {
                        if (shouldClearRedObstacle(playerBoxInCapture, obstacleBox)) {
                          const obstacleClickPoint = toObstacleInteractionScreenPoint(obstacleBox, captureBounds);
                          return pipe(
                            logEffect(
                              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full transition ${previousBagFullState ?? "none"}->${nextBagFullState} detected during mining with red obstacle at (${obstacleClickPoint.x},${obstacleClickPoint.y}). Clearing obstacle first, then depositing.`,
                            ),
                            Effect.zipRight(clickObstacleEffect(obstacleBox)),
                            Effect.zipRight(sleepEffect(OBSTACLE_POST_CLICK_SETTLE_MS)),
                            Effect.as(resetToDepositingState(current)),
                          );
                        }

                        return pipe(
                          logEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Bag-full transition ${previousBagFullState ?? "none"}->${nextBagFullState} detected during mining. Clicking cyan deposit box next.`,
                          ),
                          Effect.as(resetToDepositingState(current)),
                        );
                      }

                      if (!current.activeScreen) {
                        return pipe(
                          warnEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Missing active screen anchor, re-searching.`,
                          ),
                          Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                          Effect.as(resetToSearchingState(current)),
                        );
                      }

                      const nearbyAny = findNodeNearActiveScreen(boxes, current.activeScreen, captureBounds);
                      if (nearbyAny) {
                        if (nearbyAny.color === "yellow") {
                          return pipe(
                            logEffect(
                              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node is yellow now. Searching for a new green node.`,
                            ),
                            Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                            Effect.as(resetToSearchingState(current)),
                          );
                        }

                        const miningWaitPolls = current.miningWaitPolls + 1;
                        if (miningWaitPolls >= ACTIVE_NODE_MAX_WAIT_POLLS) {
                          return pipe(
                            warnEffect(
                              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node stayed ${nearbyAny.color} for ${miningWaitPolls} polls. Re-searching to avoid a stalled mining state.`,
                            ),
                            Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                            Effect.as(resetToSearchingState(current)),
                          );
                        }

                        return pipe(
                          logEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Waiting for active node to become yellow (player is currently mining, match=${nearbyAny.color}, poll=${miningWaitPolls}/${ACTIVE_NODE_MAX_WAIT_POLLS}).`,
                          ),
                          Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                          Effect.as({ ...current, missingActivePolls: 0, miningWaitPolls }),
                        );
                      }

                      const missingActivePolls = current.missingActivePolls + 1;
                      if (missingActivePolls <= ACTIVE_NODE_MISSING_GRACE_POLLS) {
                        return pipe(
                          warnEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node not detected yet (${missingActivePolls}/${ACTIVE_NODE_MISSING_GRACE_POLLS}); waiting briefly.`,
                          ),
                          Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                          Effect.as({ ...current, missingActivePolls }),
                        );
                      }

                      return pipe(
                        logEffect(
                          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node not detected after ${missingActivePolls} polls. Re-searching.`,
                        ),
                        Effect.as(resetToSearchingState(current)),
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
          whenDepositing((current) =>
            pipe(
              captureDepositStateEffect("deposit-scan"),
              Effect.flatMap(({ depositBox, obstacleBox, playerBoxInCapture, playerAnchorInCapture, bagFullState }) => {
                const currentWithBagState: BotState = { ...current, bagFullState };

                if (shouldClearRedObstacle(playerBoxInCapture, obstacleBox)) {
                  const obstacleClickPoint = toObstacleInteractionScreenPoint(obstacleBox, captureBounds);
                  return pipe(
                    logEffect(
                      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Red obstacle detected at (${obstacleClickPoint.x},${obstacleClickPoint.y}) during deposit step. Clearing obstacle before cyan box click.`,
                    ),
                    Effect.zipRight(clickObstacleEffect(obstacleBox)),
                    Effect.zipRight(sleepEffect(OBSTACLE_POST_CLICK_SETTLE_MS)),
                    Effect.as(currentWithBagState),
                  );
                }

                if (!depositBox) {
                  return pipe(
                    warnEffect(
                      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Deposit step active but cyan box was not found. Retrying.`,
                    ),
                    Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                    Effect.as(currentWithBagState),
                  );
                }

                const clickPoint = toDepositInteractionScreenPoint(depositBox, captureBounds);

                return pipe(
                  logEffect(
                    `Automate Bot (${BOT_NAME}): #${current.loopIndex} Clicking cyan deposit box at (${clickPoint.x},${clickPoint.y}) size=${depositBox.width}x${depositBox.height}.`,
                  ),
                  Effect.zipRight(clickScreenPointEffect(clickPoint.x, clickPoint.y)),
                  Effect.zipRight(sleepEffect(DEPOSIT_PLAYER_NEAR_TICK_MS)),
                  Effect.zipRight(captureDepositStateEffect("deposit-verify")),
                  Effect.flatMap(
                    ({
                      depositBox: verifyDepositBox,
                      obstacleBox: verifyObstacleBox,
                      playerBoxInCapture: verifyPlayerBox,
                      playerAnchorInCapture: verifyPlayerAnchor,
                      bagFullState: verifyBagFullState,
                    }) => {
                      const stateAfterVerify: BotState = {
                        ...currentWithBagState,
                        bagFullState: verifyBagFullState,
                      };

                      const playerIsNearDeposit = isPlayerNearDepositBox(
                        verifyPlayerAnchor,
                        verifyDepositBox,
                        DEPOSIT_PLAYER_NEAR_RADIUS_PX,
                      );

                      if (!playerIsNearDeposit) {
                        if (shouldClearRedObstacle(verifyPlayerBox, verifyObstacleBox)) {
                          const obstacleClickPoint = toObstacleInteractionScreenPoint(verifyObstacleBox, captureBounds);

                          return pipe(
                            warnEffect(
                              `Automate Bot (${BOT_NAME}): #${current.loopIndex} Player not near cyan box after ${DEPOSIT_PLAYER_NEAR_TICK_MS}ms and red obstacle detected at (${obstacleClickPoint.x},${obstacleClickPoint.y}). Clearing obstacle before retrying deposit step.`,
                            ),
                            Effect.zipRight(clickObstacleEffect(verifyObstacleBox)),
                            Effect.zipRight(sleepEffect(OBSTACLE_POST_CLICK_SETTLE_MS)),
                            Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                            Effect.as(stateAfterVerify),
                          );
                        }

                        return pipe(
                          warnEffect(
                            `Automate Bot (${BOT_NAME}): #${current.loopIndex} Player not near cyan box after ${DEPOSIT_PLAYER_NEAR_TICK_MS}ms. Retrying deposit step.`,
                          ),
                          Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                          Effect.as(stateAfterVerify),
                        );
                      }

                      return pipe(
                        logEffect(
                          `Automate Bot (${BOT_NAME}): #${current.loopIndex} Player stayed near cyan box for ${DEPOSIT_PLAYER_NEAR_TICK_MS}ms. Resuming mining loop.`,
                        ),
                        Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                        Effect.as(resetToSearchingState(stateAfterVerify)),
                      );
                    },
                  ),
                );
              }),
            ),
          ),
          Effect.catchAll((error) => {
            const typedError = toError(error);
            return pipe(
              Effect.sync(() => {
                logger.error(`Automate Bot (${BOT_NAME}): #${tickState.loopIndex} tick error — ${typedError.message}`);
              }),
              Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
              Effect.as(tickState),
            );
          }),
        ),
      );
    }
  } finally {
    isLoopRunning = false;
    startedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onMotherlodeMineBotStart(): void {
  if (!isLoopRunning) {
    startedAtMs = Date.now();
    debugCaptureIndex = 0;
  }

  log(`Automate Bot STARTED (${BOT_NAME}).`);
  log(
    `Automate Bot (${BOT_NAME}) config: tile-location=${ENABLE_TILE_LOCATION_DETECTION ? "on" : "off"}, hover-before-read=${ENABLE_NODE_HOVER_BEFORE_TILE_READ ? "on" : "off"}, obstacle-red-click=${ENABLE_OBSTACLE_RED_CLICK ? "on" : "off"}, post-click-mouse=${POST_CLICK_MOUSE_MOVE_MODE}, deposit-near-tick-ms=${DEPOSIT_PLAYER_NEAR_TICK_MS}.`,
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
    const message = "Cannot start — invalid RuneLite window bounds.";
    warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  if (logicalBounds.width <= 0 || logicalBounds.height <= 0) {
    const message = "Cannot start — RuneLite window has zero size.";
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

  void runLoop(captureBounds);
}
