import path from "path";
import { Effect, pipe } from "effect";
import { mouseClick, moveMouse, screen } from "robotjs";
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
import { detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";
import { selectNearestGreenMotherlodeNode } from "./shared/motherlode-target-selection";
import { screen as electronScreen } from "electron";
import { detectTileLocationBoxInScreenshot } from "./shared/tile-location-detection";

const BOT_NAME = "Motherlode Mine";
const DEBUG_DIR = "ocr-debug";

// How long to wait after moving the mouse before reading the tile tooltip (ms).
const TOOLTIP_SETTLE_MS = 400;
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

type BotPhase = "searching" | "mining";

interface BotState {
  phase: BotPhase;
  activeTile: TileCoord | null;
  activeScreen: { x: number; y: number } | null;
  missingActivePolls: number;
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

  for (const box of boxes) {
    const dx = box.centerX - activeX;
    const dy = box.centerY - activeY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > ACTIVE_NODE_MATCH_RADIUS_PX) {
      continue;
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      best = box;
    }
  }

  return best;
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
    loopIndex: 0,
  };

  // Keep loop logic self-contained so the phase flow can be read top-to-bottom as a story.
  type CaptureResult = {
    boxes: MotherlodeMineBox[];
    greenBoxes: MotherlodeMineBox[];
    playerAnchorInCapture: { x: number; y: number } | null;
  };

  const resetToSearchingState = (current: BotState): BotState => ({
    ...current,
    phase: "searching",
    activeTile: null,
    activeScreen: null,
    missingActivePolls: 0,
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
        saveBitmapWithMotherlodeMineBoxes(bitmap, boxes, filename, activeTargetInCapture);

        return { boxes, greenBoxes, playerAnchorInCapture };
      },
      catch: toError,
    });

  const hoverAndReadTileEffect = (screenX: number, screenY: number): Effect.Effect<TileCoord | null, Error> =>
    Effect.tryPromise({
      try: async () => {
        moveMouse(screenX, screenY);
        await sleepWithAbort(TOOLTIP_SETTLE_MS);
        if (!AppState.automateBotRunning) return null;

        const bitmap = screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);
        const tileBox = detectTileLocationBoxInScreenshot(bitmap);
        if (!tileBox) return null;

        return parseTileCoord(tileBox.matchedLine);
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

  type SearchNodeStep = {
    current: BotState;
    greenNode: MotherlodeMineBox | null;
  };

  const findMinableNode =
    (story: (src: Effect.Effect<BotState, Error>) => Effect.Effect<SearchNodeStep, Error>) =>
    (source: Effect.Effect<BotState, Error>): Effect.Effect<SearchNodeStep, Error> =>
      story(source);

  const clickStartMining =
    (story: (src: Effect.Effect<SearchNodeStep, Error>) => Effect.Effect<BotState, Error>) =>
    (source: Effect.Effect<SearchNodeStep, Error>): Effect.Effect<BotState, Error> =>
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
                      Effect.map(({ greenBoxes, playerAnchorInCapture }) => ({
                        current,
                        greenNode: selectNearestGreenMotherlodeNode(greenBoxes, captureBounds, playerAnchorInCapture),
                      })),
                    ),
                  ),
                ),
              ),
              clickStartMining((src) =>
                pipe(
                  src,
                  Effect.flatMap(({ current, greenNode }) => {
                    if (!greenNode) {
                      return pipe(
                        warnEffect(`Automate Bot (${BOT_NAME}): #${current.loopIndex} No green node found, retrying…`),
                        Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                        Effect.as(current),
                      );
                    }

                    const nodeScreenX = captureBounds.x + greenNode.centerX;
                    const nodeScreenY = captureBounds.y + greenNode.centerY;

                    return pipe(
                      hoverAndReadTileEffect(nodeScreenX, nodeScreenY),
                      Effect.flatMap((activeTile) => {
                        const nextState: BotState = {
                          ...current,
                          phase: "mining",
                          activeTile,
                          activeScreen: { x: nodeScreenX, y: nodeScreenY },
                          missingActivePolls: 0,
                        };

                        return pipe(
                          activeTile
                            ? logEffect(
                                `Automate Bot (${BOT_NAME}): #${current.loopIndex} Nearest green node at tile (${activeTile.x},${activeTile.y},${activeTile.z}). Clicking.`,
                              )
                            : warnEffect(
                                `Automate Bot (${BOT_NAME}): #${current.loopIndex} Could not read tile for nearest green node. Clicking anyway.`,
                              ),
                          Effect.zipRight(sleepEffect(PRE_CLICK_SETTLE_MS)),
                          Effect.flatMap(() => (AppState.automateBotRunning ? clickNodeEffect() : Effect.void)),
                          Effect.zipRight(sleepEffect(POST_CLICK_SETTLE_MS)),
                          Effect.as(nextState),
                        );
                      }),
                    );
                  }),
                ),
              ),
            ),
          ),
          whenMining((current) =>
            pipe(
              // MINING: keep monitoring the same target until it turns yellow, then go back to searching.
              captureAndDetectEffect("mine", current.activeScreen),
              Effect.flatMap(({ boxes, greenBoxes }) => {
                if (!current.activeScreen) {
                  return pipe(
                    warnEffect(
                      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Missing active screen anchor, re-searching.`,
                    ),
                    Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                    Effect.as(resetToSearchingState(current)),
                  );
                }

                const nearbyGreen = findNodeNearActiveScreen(greenBoxes, current.activeScreen, captureBounds);
                if (nearbyGreen) {
                  return pipe(
                    logEffect(
                      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Waiting for active node to become yellow (player is currently mining).`,
                    ),
                    Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                    Effect.as({ ...current, missingActivePolls: 0 }),
                  );
                }

                const nearbyAny = findNodeNearActiveScreen(boxes, current.activeScreen, captureBounds);
                if (nearbyAny && nearbyAny.color === "yellow") {
                  return pipe(
                    logEffect(
                      `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node is yellow now. Searching for a new green node.`,
                    ),
                    Effect.zipRight(sleepEffect(POLL_INTERVAL_MS)),
                    Effect.as(resetToSearchingState(current)),
                  );
                }

                const missingActivePolls = current.missingActivePolls + 1;
                if (missingActivePolls <= ACTIVE_NODE_MISSING_GRACE_POLLS) {
                  return pipe(sleepEffect(POLL_INTERVAL_MS), Effect.as({ ...current, missingActivePolls }));
                }

                return pipe(
                  logEffect(
                    `Automate Bot (${BOT_NAME}): #${current.loopIndex} Active node not detected after ${missingActivePolls} polls. Re-searching.`,
                  ),
                  Effect.as(resetToSearchingState(current)),
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

  const scaleFactor = getWindowsDisplayScaleFactor(logicalBounds);
  const captureBounds = toPhysicalBounds(logicalBounds, scaleFactor);

  void runLoop(captureBounds);
}
