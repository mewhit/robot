import { UiohookKey, uIOhook } from "uiohook-napi";
import { windowManager, Window } from "node-window-manager";
import { AppState, activeModifiers } from "./global-state";
import { toggleRecording, recordMouseClick, recordKeyPress } from "./recordingManager";
import { requestReplayStop, replayActiveCsv } from "./replayManager";
import { UIOHOOK_KEY_TO_ROBOTJS, MODIFIER_KEYCODES } from "./constants";

export type RuneLiteWindowInfo = { x: number; y: number; width: number; height: number };
const DEFAULT_AUTOMATION_RUNELITE_BOUNDS: RuneLiteWindowInfo = { x: 0, y: 0, width: 1280, height: 720 };

export function setupIoHookHandlers() {
  uIOhook.on("keydown", (e) => {
    if (e.keycode === UiohookKey.F3) {
      if (!AppState.recording) {
        ensureRuneLiteWindowBoundsForAutomation();
      }
      toggleRecording("f3");
      return;
    }

    if (e.keycode === UiohookKey.F2) {
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
        AppState.mainWindow?.webContents.send("cursor-pos", { x: e.x, y: e.y, runLiteWindow });
      };
    })()
  );

  uIOhook.on("mousedown", (e) => {
    const runLiteWindow = getRunLiteWindowInfo();
    AppState.mainWindow?.webContents.send("cursor-pos", { x: e.x, y: e.y, runLiteWindow });
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

export function ensureRuneLiteWindowBoundsForAutomation() {
  if (process.platform !== "win32") {
    return;
  }

  const runeLiteWindow = findRuneLiteWindow();
  if (!runeLiteWindow) {
    console.warn("RuneLite window not found; skipping bounds alignment.");
    return;
  }

  const targetBounds = getAutomationRuneLiteWindowBounds();
  try {
    runeLiteWindow.setBounds(targetBounds);
  } catch (error) {
    console.error("Could not align RuneLite bounds:", error);
  }
}

function findRuneLiteWindow(): Window | null {
  const windows = windowManager.getWindows();
  let bestMatch: { window: Window; score: number } | null = null;

  for (const currentWindow of windows) {
    if (!currentWindow.isWindow() || !currentWindow.isVisible()) {
      continue;
    }

    const title = currentWindow.getTitle().trim().toLowerCase();
    const executablePath = String(currentWindow.path ?? "").toLowerCase();
    if (!title) {
      continue;
    }

    if (title.includes("jump list")) {
      continue;
    }

    const hasRuneLiteTitle = title.includes("runelite");
    const isRuneLiteGameTitle = /^runelite\s*-\s*/.test(title);
    const hasRuneLiteExe = executablePath.endsWith("\\runelite.exe") || executablePath.includes("/runelite.exe");
    const isJavaWindowWithRuneLiteTitle =
      (executablePath.endsWith("\\javaw.exe") || executablePath.includes("/javaw.exe")) && hasRuneLiteTitle;

    if (!hasRuneLiteTitle && !hasRuneLiteExe && !isJavaWindowWithRuneLiteTitle) {
      continue;
    }

    let score = 0;
    if (isRuneLiteGameTitle) score += 100;
    if (hasRuneLiteTitle) score += 30;
    if (hasRuneLiteExe) score += 20;
    if (isJavaWindowWithRuneLiteTitle) score += 10;

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { window: currentWindow, score };
    }
  }

  return bestMatch?.window ?? null;
}

function getAutomationRuneLiteWindowBounds(): RuneLiteWindowInfo {
  const raw = process.env.RUNELITE_FORCE_BOUNDS?.trim();
  if (!raw) {
    return DEFAULT_AUTOMATION_RUNELITE_BOUNDS;
  }

  const values = raw.split(",").map((part) => Number(part.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return DEFAULT_AUTOMATION_RUNELITE_BOUNDS;
  }

  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) {
    return DEFAULT_AUTOMATION_RUNELITE_BOUNDS;
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
