import { windowManager, Window } from "node-window-manager";
import { screen } from "electron";
import {
  AutomateBotId,
  MINING_GUILD_COAL_ORE_BOT_ID,
  MINING_GUILD_MITHRIL_ORE_BOT_ID,
  RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID,
  RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID,
} from "./automate-bots/definitions";

export type RuneLiteWindowInfo = { x: number; y: number; width: number; height: number };
type RuneLiteTargetCaptureSize = { width: number; height: number };

const DEFAULT_AUTOMATION_RUNELITE_BOUNDS: RuneLiteWindowInfo = {
  x: 0,
  y: 0,
  width: 1280,
  height: 720,
};

const TESTED_CAPTURE_SIZE_BY_BOT_ID: Partial<Record<AutomateBotId, RuneLiteTargetCaptureSize>> = {
  [MINING_GUILD_COAL_ORE_BOT_ID]: { width: 1298, height: 1549 },
  [MINING_GUILD_MITHRIL_ORE_BOT_ID]: { width: 1600, height: 1549 },
  [RUNECRAFTING_ARCEUUS_BLOOD_RUNE_BOT_ID]: { width: 1335, height: 1549 },
  [RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID]: { width: 1298, height: 1549 },
};

function getWindowsDPIScalingFactor(): number {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor;
    console.log(`Detected Windows DPI scaling: ${scaleFactor}x (${Math.round(scaleFactor * 100)}%)`);
    return scaleFactor;
  } catch (error) {
    console.warn(`Could not detect DPI scaling, using 1x:`, error);
    return 1;
  }
}

function getWindowDisplayScaleFactor(bounds: RuneLiteWindowInfo): number {
  try {
    const display = screen.getDisplayMatching({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    });
    return Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
  } catch (error) {
    console.warn("Could not detect RuneLite display scale, using 1x:", error);
    return 1;
  }
}

function getValidRuneLiteWindowBounds(window: Window): RuneLiteWindowInfo | null {
  const bounds = window.getBounds();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function findRuneLiteWindow(): Window | null {
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

function parseRuneLiteForceBounds(): RuneLiteWindowInfo | null {
  const raw = process.env.RUNELITE_FORCE_BOUNDS?.trim();
  if (!raw) {
    return null;
  }

  const values = raw.split(",").map((part) => Number(part.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const [x, y, width, height] = values;
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

function getAutomationRuneLiteWindowBounds(): RuneLiteWindowInfo {
  return parseRuneLiteForceBounds() ?? DEFAULT_AUTOMATION_RUNELITE_BOUNDS;
}

function getTestedRuneLiteBoundsForBot(window: Window, botId: string): RuneLiteWindowInfo | null {
  const targetCaptureSize = TESTED_CAPTURE_SIZE_BY_BOT_ID[botId as AutomateBotId];
  if (!targetCaptureSize) {
    return null;
  }

  const currentBounds = getValidRuneLiteWindowBounds(window);
  if (!currentBounds) {
    return null;
  }

  const scaleFactor = getWindowDisplayScaleFactor(currentBounds);
  return {
    x: currentBounds.x,
    y: currentBounds.y,
    width: Math.max(1, Math.round(targetCaptureSize.width / scaleFactor)),
    height: Math.max(1, Math.round(targetCaptureSize.height / scaleFactor)),
  };
}

export function getRuneLite(): Window | null {
  const runeLiteWindow = findRuneLiteWindow();
  if (!runeLiteWindow) {
    console.warn("RuneLite window not found; skipping bounds alignment.");
    return null;
  }

  const bounds = runeLiteWindow.getBounds();
  console.log(bounds);
  if (
    !bounds ||
    typeof bounds.x !== "number" ||
    typeof bounds.y !== "number" ||
    typeof bounds.width !== "number" ||
    typeof bounds.height !== "number"
  ) {
    console.warn("Invalid window bounds, returning original window");
    return runeLiteWindow;
  }

  console.log(
    `getRuneLite() found window: title="${runeLiteWindow.getTitle()}", raw bounds: x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}`,
  );

  // Use raw bounds directly without DPI scaling
  // robotjs captures at pixel level, DPI scaling causes coordinate mismatch

  return runeLiteWindow;
}

export function alignRuneLiteWindowBoundsForAutomateBot(botId: string): Window | null {
  if (process.platform !== "win32") {
    return findRuneLiteWindow();
  }

  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    return null;
  }

  const forcedBounds = parseRuneLiteForceBounds();
  const targetBounds = forcedBounds ?? getTestedRuneLiteBoundsForBot(runeLiteWindow, botId);
  if (!targetBounds) {
    return runeLiteWindow;
  }

  try {
    const beforeBounds = getValidRuneLiteWindowBounds(runeLiteWindow);
    runeLiteWindow.setBounds(targetBounds);
    const afterBounds = getValidRuneLiteWindowBounds(runeLiteWindow);
    const targetCaptureSize = TESTED_CAPTURE_SIZE_BY_BOT_ID[botId as AutomateBotId];
    const targetText = forcedBounds
      ? "RUNELITE_FORCE_BOUNDS"
      : targetCaptureSize
        ? `testedCapture=${targetCaptureSize.width}x${targetCaptureSize.height}`
        : "default";
    console.log(
      `RuneLite bounds aligned for bot=${botId} source=${targetText} before=${beforeBounds ? `${beforeBounds.width}x${beforeBounds.height}@${beforeBounds.x},${beforeBounds.y}` : "unknown"} after=${afterBounds ? `${afterBounds.width}x${afterBounds.height}@${afterBounds.x},${afterBounds.y}` : "unknown"}.`,
    );
  } catch (error) {
    console.error(`Could not align RuneLite bounds for bot=${botId}:`, error);
  }

  return runeLiteWindow;
}

export function ensureRuneLiteWindowBoundsForAutomation() {
  if (process.platform !== "win32") {
    return;
  }

  const runeLiteWindow = getRuneLite();
  if (!runeLiteWindow) {
    return;
  }

  const targetBounds = getAutomationRuneLiteWindowBounds();
  try {
    runeLiteWindow.setBounds(targetBounds);
  } catch (error) {
    console.error("Could not align RuneLite bounds:", error);
  }
}

export function focusRuneLiteWindowForAutomation() {
  if (process.platform !== "win32") {
    return;
  }

  const runeLiteWindow = findRuneLiteWindow();
  if (!runeLiteWindow) {
    console.warn("RuneLite window not found; skipping focus.");
    return;
  }

  try {
    if (!runeLiteWindow.isVisible()) {
      runeLiteWindow.show();
    }
    runeLiteWindow.bringToTop();
  } catch (error) {
    console.error("Could not focus RuneLite window:", error);
  }
}
