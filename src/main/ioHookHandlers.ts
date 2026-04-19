import { UiohookKey, uIOhook } from "uiohook-napi";
import { AppState, activeModifiers } from "./global-state";
import { toggleRecording, recordMouseClick, recordKeyPress } from "./recordingManager";
import { requestReplayStop, replayActiveCsv } from "./replayManager";
import { UIOHOOK_KEY_TO_ROBOTJS, MODIFIER_KEYCODES } from "./constants";
import { toggleSelectedAutomateBot } from "./automateBotManager";
import { findRuneLiteWindow, RuneLiteWindowInfo } from "./runeLiteWindow";
import { CHANNELS } from "./ipcChannels";
import { runAgilityScreenshotCapture } from "./automate-bots/shared/screenshot-capture";
import { getSavedScreenshotNameSuffix, getSavedScreenshotSavePath } from "./csvOperator";

export function setupIoHookHandlers() {
  uIOhook.on("keydown", (e) => {
    if (e.keycode === UiohookKey.F3) {
      if (AppState.activeView === "automateBot" || AppState.automateBotRunning) {
        AppState.combatAutoTriggerCount += 1;
        return;
      }

      toggleRecording("f3");
      return;
    }

    if (e.keycode === UiohookKey.F4) {
      if (AppState.activeView === "automateBot" || AppState.automateBotRunning) {
        try {
          toggleSelectedAutomateBot("f4");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Could not toggle automate bot: ${message}`);
        }
        return;
      }
    }

    if (e.keycode === UiohookKey.F2) {
      if (AppState.activeView === "debug") {
        const result = runAgilityScreenshotCapture({
          targetFilePath: getSavedScreenshotSavePath() ?? undefined,
          fileNameSuffix: getSavedScreenshotNameSuffix() ?? undefined,
        });
        if (!result.ok) {
          console.error(`Could not capture screenshot: ${result.error ?? "Screenshot capture failed."}`);
        }
        return;
      }

      if (AppState.replaying) {
        requestReplayStop("f2");
        return;
      }

      void replayActiveCsv().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Could not replay csv: ${message}`);
      });
      return;
    }

    const isModifier = MODIFIER_KEYCODES.has(e.keycode);

    if (isModifier) {
      if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) activeModifiers.add("ctrl");
      else if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) activeModifiers.add("alt");
      else if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) activeModifiers.add("shift");
      else if (e.keycode === UiohookKey.Meta || e.keycode === UiohookKey.MetaRight) activeModifiers.add("meta");
      return;
    }

    if (AppState.recording) {
      const robotKey = UIOHOOK_KEY_TO_ROBOTJS[e.keycode];
      if (robotKey !== undefined) {
        recordKeyPress(`Key:${robotKey}`, robotKey);
      }
    }
  });

  uIOhook.on("keyup", (e) => {
    if (e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight) activeModifiers.delete("ctrl");
    else if (e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight) activeModifiers.delete("alt");
    else if (e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight) activeModifiers.delete("shift");
    else if (e.keycode === UiohookKey.Meta || e.keycode === UiohookKey.MetaRight) activeModifiers.delete("meta");
  });

  uIOhook.on(
    "mousemove",
    (() => {
      let lastSent = 0;
      return (e: { x: number; y: number }) => {
        const now = Date.now();
        if (now - lastSent < 50) return;
        lastSent = now;
        const runLiteWindow = getRunLiteWindowInfo();
        AppState.mainWindow?.webContents.send(CHANNELS.CURSOR_POS, { x: e.x, y: e.y, runLiteWindow });
      };
    })(),
  );

  uIOhook.on("mousedown", (e) => {
    const runLiteWindow = getRunLiteWindowInfo();
    AppState.mainWindow?.webContents.send(CHANNELS.CURSOR_POS, { x: e.x, y: e.y, runLiteWindow });
    if (!AppState.recording) return;
    if (e.button === 1 || e.button === 2) {
      recordMouseClick(e.button as 1 | 2, e.x, e.y);
    }
  });
}

function isRuneLiteRunning(): boolean {
  const now = Date.now();
  if (now - lastRuneLiteCheckAt < RUNELITE_CHECK_INTERVAL_MS) {
    return lastRuneLiteRunning;
  }

  lastRuneLiteCheckAt = now;

  try {
    if (process.platform !== "win32") {
      console.warn("RuneLite process detection only supported on Windows");
      return false;
    }

    const isRunning = findRuneLiteWindow() !== null;
    if (isRunning !== lastRuneLiteRunning) {
      console.log("RuneLite running:", isRunning);
    }

    lastRuneLiteRunning = isRunning;
    return isRunning;
  } catch (error) {
    console.log("RuneLite check failed:", error);
    return lastRuneLiteRunning;
  }
}

export function getRunLiteWindowInfo(): RuneLiteWindowInfo | null {
  try {
    if (!isRuneLiteRunning()) {
      lastRuneLiteWindowInfo = null;
      return null;
    }

    const now = Date.now();
    if (now - lastRuneLiteWindowCheckAt < RUNELITE_WINDOW_CHECK_INTERVAL_MS) {
      return lastRuneLiteWindowInfo;
    }

    lastRuneLiteWindowCheckAt = now;
    const resolvedBounds = queryRuneLiteWindowInfo();
    if (resolvedBounds) {
      lastRuneLiteWindowInfo = resolvedBounds;
    }

    return lastRuneLiteWindowInfo;
  } catch (error) {
    console.error("Error getting RuneLite window info:", error);
  }
  return null;
}

function queryRuneLiteWindowInfo(): RuneLiteWindowInfo | null {
  if (process.platform !== "win32") {
    return null;
  }

  const runeLiteWindow = findRuneLiteWindow();
  if (!runeLiteWindow) {
    return null;
  }

  const bounds = runeLiteWindow.getBounds();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    return null;
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

const RUNELITE_CHECK_INTERVAL_MS = 1000;
const RUNELITE_WINDOW_CHECK_INTERVAL_MS = 500;
let lastRuneLiteCheckAt = 0;
let lastRuneLiteRunning = false;
let lastRuneLiteWindowCheckAt = 0;
let lastRuneLiteWindowInfo: RuneLiteWindowInfo | null = null;
