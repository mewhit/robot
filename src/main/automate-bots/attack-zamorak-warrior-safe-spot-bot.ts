import { keyTap, mouseClick, moveMouse, screen } from "robotjs";
import { Window } from "node-window-manager";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID } from "./definitions";
import { CyanBox, detectBestCyanBoxInScreenshot } from "./shared/cyan-box-detector";
import { AttackBox, detectBestAttackBoxInScreenshot } from "./shared/attack-box-detector";
import { saveBitmap } from "./shared/save-bitmap";
import path from "path";

const BOT_NAME = "Attack Zamorak Warrior SafeSpot";
const LOOP_INTERVAL_MS = 450;
const MIN_CLICK_INTERVAL_MS = 2400;
const CLICK_DELAY_MIN_MS = 80;
const CLICK_DELAY_MAX_MS = 180;
const POST_FOCUS_SETTLE_MS = 200;
const CONTEXT_MENU_SETTLE_MS = 220;
const ATTACK_BOX_DETECT_RETRIES = 4;
const ATTACK_BOX_RETRY_INTERVAL_MS = 80;
const DEBUG_MODE = true;
const DEBUG_DIR = "ocr-debug";

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type LoopState = {
  loopIndex: number;
  lastClickAtMs: number | null;
  hadTargetLastTick: boolean;
};

const initialLoopState: LoopState = {
  loopIndex: 0,
  lastClickAtMs: null,
  hadTargetLastTick: false,
};

let isLoopRunning = false;
let startedAtMs: number | null = null;

function formatElapsedSinceStart(): string {
  if (startedAtMs === null) {
    return "+0ms";
  }

  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
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

function getPlayableBounds(window: Window): Bounds | null {
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

function getSceneBounds(bounds: Bounds): Bounds {
  const left = Math.round(bounds.x + bounds.width * 0.02);
  const top = Math.round(bounds.y + bounds.height * 0.04);
  const right = Math.round(bounds.x + bounds.width * 0.82);
  const bottom = Math.round(bounds.y + bounds.height * 0.78);

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1),
  };
}

let debugCaptureIndex = 0;

function nextDebugIndex(): number {
  debugCaptureIndex += 1;
  return debugCaptureIndex;
}

function detectCyanBoxInScene(sceneBounds: Bounds): CyanBox | null {
  const sceneBitmap = screen.capture(sceneBounds.x, sceneBounds.y, sceneBounds.width, sceneBounds.height);
  if (DEBUG_MODE) {
    const idx = nextDebugIndex();
    saveBitmap(sceneBitmap, path.join(DEBUG_DIR, `${idx}-cyan-scene.png`));
  }
  return detectBestCyanBoxInScreenshot(sceneBitmap);
}

function detectAttackBoxFullScreen(playableBounds: Bounds): AttackBox | null {
  const bitmap = screen.capture(playableBounds.x, playableBounds.y, playableBounds.width, playableBounds.height);
  if (DEBUG_MODE) {
    const idx = nextDebugIndex();
    saveBitmap(bitmap, path.join(DEBUG_DIR, `${idx}-attack-full.png`));
  }
  return detectBestAttackBoxInScreenshot(bitmap);
}

function getCyanClickPoint(sceneBounds: Bounds, cyanBox: CyanBox): { x: number; y: number } {
  const jitterX = Math.min(4, Math.max(1, Math.floor(cyanBox.width * 0.08)));
  const jitterY = Math.min(6, Math.max(1, Math.floor(cyanBox.height * 0.08)));

  return {
    x: sceneBounds.x + cyanBox.centerX + randomIntInclusive(-jitterX, jitterX),
    y: sceneBounds.y + cyanBox.centerY + randomIntInclusive(-jitterY, jitterY),
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

function clickCooldownRemainingMs(lastClickAtMs: number | null, now: number): number {
  if (lastClickAtMs === null) {
    return 0;
  }

  return Math.max(0, MIN_CLICK_INTERVAL_MS - (now - lastClickAtMs));
}

async function runLoop(window: Window): Promise<void> {
  if (isLoopRunning) {
    logWithDelta(`Automate Bot (${BOT_NAME}): loop already running.`);
    return;
  }

  isLoopRunning = true;
  setAutomateBotCurrentStep(ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID);

  try {
    const startupBounds = getPlayableBounds(window);
    if (!startupBounds) {
      const message = `${BOT_NAME} startup failed: invalid RuneLite window bounds.`;
      errorWithDelta(`Automate Bot (${BOT_NAME}): ${message}`);
      notifyUserAndStop(message);
      return;
    }

    await sleepWithAbort(POST_FOCUS_SETTLE_MS);
    if (!AppState.automateBotRunning) {
      return;
    }

    const startupSceneBounds = getSceneBounds(startupBounds);
    const startupCyanBox = detectCyanBoxInScene(startupSceneBounds);
    if (!startupCyanBox) {
      const message = `${BOT_NAME} startup check failed. Missing the cyan target outline. Fix: enable RuneLite NPC Indicators, tag Zamorak Warrior, and keep one visible on screen.`;
      errorWithDelta(`Automate Bot (${BOT_NAME}): ${message}`);
      notifyUserAndStop(message);
      return;
    }

    logWithDelta(
      `Automate Bot (${BOT_NAME}): startup check passed - cyan outline at x=${startupCyanBox.x}, y=${startupCyanBox.y}, size=${startupCyanBox.width}x${startupCyanBox.height}.`,
    );

    let state = initialLoopState;

    while (AppState.automateBotRunning) {
      const tickStartedAt = Date.now();
      const loopIndex = state.loopIndex + 1;
      state = {
        ...state,
        loopIndex,
      };

      try {
        const bounds = getPlayableBounds(window);
        if (!bounds) {
          warnWithDelta(`Automate Bot (${BOT_NAME}): loop #${loopIndex} - invalid RuneLite bounds.`);
          await sleepWithAbort(LOOP_INTERVAL_MS);
          continue;
        }

        const sceneBounds = getSceneBounds(bounds);
        const cyanBox = detectCyanBoxInScene(sceneBounds);
        if (!cyanBox) {
          if (state.hadTargetLastTick) {
            logWithDelta(
              `Automate Bot (${BOT_NAME}): loop #${loopIndex} - target lost, waiting for the cyan outline to return.`,
            );
          }

          state = {
            ...state,
            hadTargetLastTick: false,
          };
          await sleepWithAbort(LOOP_INTERVAL_MS);
          continue;
        }

        if (!state.hadTargetLastTick) {
          logWithDelta(
            `Automate Bot (${BOT_NAME}): loop #${loopIndex} - target acquired at scene (${cyanBox.centerX}, ${cyanBox.centerY}) size=${cyanBox.width}x${cyanBox.height}.`,
          );
        }

        state = {
          ...state,
          hadTargetLastTick: true,
        };

        const cooldown = clickCooldownRemainingMs(state.lastClickAtMs, Date.now());
        if (cooldown > 0) {
          await sleepWithAbort(Math.min(cooldown, LOOP_INTERVAL_MS));
          continue;
        }

        const clickDelayMs = randomIntInclusive(CLICK_DELAY_MIN_MS, CLICK_DELAY_MAX_MS);
        await sleepWithAbort(clickDelayMs);
        if (!AppState.automateBotRunning) {
          break;
        }

        const freshCyanBox = detectCyanBoxInScene(sceneBounds);
        if (!freshCyanBox) {
          logWithDelta(`Automate Bot (${BOT_NAME}): loop #${loopIndex} - target disappeared before click.`);
          state = {
            ...state,
            hadTargetLastTick: false,
          };
          continue;
        }

        const clickPoint = getCyanClickPoint(sceneBounds, freshCyanBox);
        logWithDelta(
          `Automate Bot (${BOT_NAME}): loop #${loopIndex} - right-clicking target at (${clickPoint.x}, ${clickPoint.y}).`,
        );
        moveMouse(clickPoint.x, clickPoint.y);
        mouseClick("right", false);

        // Wait for context menu to appear
        await sleepWithAbort(CONTEXT_MENU_SETTLE_MS);
        if (!AppState.automateBotRunning) {
          break;
        }

        // Detect the Attack context menu and click the Attack option
        let attackBox: AttackBox | null = null;
        for (let attempt = 0; attempt < ATTACK_BOX_DETECT_RETRIES; attempt++) {
          const freshBounds = getPlayableBounds(window);
          if (freshBounds) {
            attackBox = detectAttackBoxFullScreen(freshBounds);
          }
          if (attackBox?.attackOption) {
            break;
          }
          await sleepWithAbort(ATTACK_BOX_RETRY_INTERVAL_MS);
          if (!AppState.automateBotRunning) {
            break;
          }
        }

        if (!AppState.automateBotRunning) {
          break;
        }

        if (!attackBox?.attackOption) {
          warnWithDelta(
            `Automate Bot (${BOT_NAME}): loop #${loopIndex} - attack context menu not found after right-click.`,
          );
          // Dismiss the menu with Escape
          keyTap("escape");
          state = {
            ...state,
            hadTargetLastTick: false,
          };
          continue;
        }

        const currentBounds = getPlayableBounds(window);
        if (!currentBounds) {
          continue;
        }

        const option = attackBox.attackOption;
        const attackClickX = currentBounds.x + option.centerX;
        const attackClickY = currentBounds.y + option.centerY;
        logWithDelta(
          `Automate Bot (${BOT_NAME}): loop #${loopIndex} - clicking Attack option at (${attackClickX}, ${attackClickY}).`,
        );
        moveMouse(attackClickX, attackClickY);
        mouseClick("left", false);

        state = {
          ...state,
          lastClickAtMs: Date.now(),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorWithDelta(`Automate Bot (${BOT_NAME}): loop #${loopIndex} failed - ${message}`);
      }

      const waitToNextTickMs = Math.max(0, LOOP_INTERVAL_MS - (Date.now() - tickStartedAt));
      if (waitToNextTickMs > 0) {
        await sleepWithAbort(waitToNextTickMs);
      }
    }
  } finally {
    isLoopRunning = false;
    startedAtMs = null;
    setAutomateBotCurrentStep(null);
  }
}

export function onAttackZamorakWarriorSafeSpotBotStart(): void {
  if (!isLoopRunning) {
    startedAtMs = Date.now();
    debugCaptureIndex = 0;
  }

  logWithDelta(`Automate Bot STARTED (${BOT_NAME}).`);

  const window = getRuneLite();
  if (!window) {
    const message = `${BOT_NAME} could not start because the RuneLite window was not found.`;
    warnWithDelta(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();
  void runLoop(window);
}
