import { windowManager, Window } from "node-window-manager";
import { screen } from "electron";

export type RuneLiteWindowInfo = { x: number; y: number; width: number; height: number };

const DEFAULT_AUTOMATION_RUNELITE_BOUNDS: RuneLiteWindowInfo = {
  x: 0,
  y: 0,
  width: 1280,
  height: 720,
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

export function getRuneLite(): Window | null {
  const runeLiteWindow = findRuneLiteWindow();
  if (!runeLiteWindow) {
    console.warn("RuneLite window not found; skipping bounds alignment.");
    return null;
  }

  const bounds = runeLiteWindow.getBounds();
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
    runeLiteWindow.restore();
    runeLiteWindow.bringToTop();
  } catch (error) {
    console.error("Could not focus RuneLite window:", error);
  }
}
