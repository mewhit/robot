import * as robot from "robotjs";
import { windowManager, Window } from "node-window-manager";
import { AppState } from "./global-state";
import { CsvRow } from "./types";
import { getReplayTargetPoint, wait } from "./utils";
import { readActiveFileRows, normalizeReplayKey } from "./csvOperations";
import { sendReplayState, sendReplayRowState } from "./recordingManager";
import { REPLAY_KEY_PRESS_MS, REPLAY_FOCUS_DELAY_MS } from "./constants";

export function requestReplayStop(source: "f2" | "ui") {
  if (!AppState.replaying) {
    return;
  }

  AppState.replayStopRequested = true;
  console.log(`Replay stop requested via ${source.toUpperCase()}.`);
}

function easeInOutQuad(progress: number): number {
  if (progress < 0.5) {
    return 2 * progress * progress;
  }

  return 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

async function moveMouseWithElapsedDuration(targetX: number, targetY: number, durationMs: number) {
  const clampedDurationMs = Math.max(0, durationMs);
  if (clampedDurationMs <= 0) {
    robot.moveMouse(targetX, targetY);
    return;
  }

  const start = robot.getMousePos();
  const deltaX = targetX - start.x;
  const deltaY = targetY - start.y;
  const startedAt = Date.now();

  while (true) {
    if (AppState.replayStopRequested) {
      return;
    }

    const elapsedMs = Date.now() - startedAt;
    const progress = Math.min(1, elapsedMs / clampedDurationMs);
    const easedProgress = easeInOutQuad(progress);
    const nextX = Math.round(start.x + deltaX * easedProgress);
    const nextY = Math.round(start.y + deltaY * easedProgress);
    robot.moveMouse(nextX, nextY);

    if (progress >= 1) {
      return;
    }

    const remainingMs = clampedDurationMs - elapsedMs;
    await wait(Math.max(1, Math.min(16, remainingMs)));
  }
}

async function pressReplayKey(key: string, modifiers: string[]) {
  if (modifiers.length > 0) {
    robot.keyTap(key, modifiers);
    return;
  }

  if (typeof robot.keyToggle === "function") {
    robot.keyToggle(key, "down");
    await wait(REPLAY_KEY_PRESS_MS);
    robot.keyToggle(key, "up");
    return;
  }

  robot.keyTap(key);
}

function getReplayDelaySeconds(row: CsvRow): number {
  const baseDelay = Math.max(0, row.elapsedSeconds);
  const hasMin = row.elapsedMin !== null && Number.isFinite(row.elapsedMin);
  const hasMax = row.elapsedMax !== null && Number.isFinite(row.elapsedMax);

  let resolvedDelay = baseDelay;

  if (hasMin || hasMax) {
    const rawMin = hasMin ? Math.max(0, row.elapsedMin as number) : baseDelay;
    const rawMax = hasMax ? Math.max(0, row.elapsedMax as number) : rawMin;
    const minDelay = Math.min(rawMin, rawMax);
    const maxDelay = Math.max(rawMin, rawMax);
    const mode = row.elapsedRange.trim().toLowerCase();

    if (mode === "min") {
      resolvedDelay = minDelay;
    } else if (mode === "max") {
      resolvedDelay = maxDelay;
    } else if (mode === "exact" || mode === "base") {
      resolvedDelay = Math.min(maxDelay, Math.max(minDelay, baseDelay));
    } else {
      resolvedDelay = minDelay + Math.random() * (maxDelay - minDelay);
    }
  }

  const extraDelaySeconds = Math.max(0, AppState.replayExtraDelayMs) / 1000;
  if (extraDelaySeconds <= 0) {
    return resolvedDelay;
  }

  return resolvedDelay + Math.random() * extraDelaySeconds;
}

function findRuneLiteWindowForReplay(): Window | null {
  const windows = windowManager.getWindows();
  let bestMatch: { window: Window; score: number } | null = null;

  for (const currentWindow of windows) {
    if (!currentWindow.isWindow() || !currentWindow.isVisible()) {
      continue;
    }

    const title = currentWindow.getTitle().trim().toLowerCase();
    const executablePath = String(currentWindow.path ?? "").toLowerCase();
    if (!title || title.includes("jump list")) {
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

function ensureRuneLiteWindowForReplay() {
  if (process.platform !== "win32") {
    return;
  }

  const runeLiteWindow = findRuneLiteWindowForReplay();
  if (!runeLiteWindow) {
    throw new Error("RuneLite window was not found.");
  }
}

export async function replayActiveCsv(options?: { fromUi?: boolean; fromRowIndex?: number }) {
  if (AppState.replaying) {
    throw new Error("Replay is already running");
  }

  if (AppState.recording) {
    throw new Error("Stop recording before replaying");
  }

  ensureRuneLiteWindowForReplay();

  const allRows = readActiveFileRows();
  if (allRows.length === 0) {
    throw new Error("Active CSV has no replayable rows");
  }

  const startIndex = options?.fromRowIndex ?? 0;
  const initialRows = startIndex > 0 ? allRows.filter((r) => r.index >= startIndex) : allRows;
  let isFirstCycle = true;

  AppState.replayStopRequested = false;
  AppState.replaying = true;
  AppState.currentReplayRowIndex = null;
  sendReplayState();
  sendReplayRowState();

  if (options?.fromUi && AppState.mainWindow && !AppState.mainWindow.isDestroyed()) {
    await wait(REPLAY_FOCUS_DELAY_MS);
  }

  console.log(`Replay started: ${AppState.outputFilePath} (${initialRows.length} rows)`);

  try {
    while (!AppState.replayStopRequested) {
      const rows = isFirstCycle ? initialRows : allRows;
      isFirstCycle = false;

      for (const row of rows) {
        if (AppState.replayStopRequested) {
          console.log("Replay stopped.");
          break;
        }

        AppState.currentReplayRowIndex = row.index;
        sendReplayRowState();

        const delayMs = Math.max(0, getReplayDelaySeconds(row) * 1000);

        if (row.action.startsWith("Key:")) {
          await wait(delayMs);

          if (AppState.replayStopRequested) {
            console.log("Replay stopped.");
            break;
          }

          const keySpec = row.action.slice(4);
          const parts = keySpec.split("+");
          const key = normalizeReplayKey(parts[parts.length - 1]);
          const modifiers = parts.slice(0, parts.length - 1).map((mod) => (mod === "ctrl" ? "control" : mod === "meta" ? "command" : mod));
          try {
            await pressReplayKey(key, modifiers);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Skipping unsupported replay key "${key}": ${message}`);
          }
        } else {
          const targetPoint = getReplayTargetPoint(row);
          await moveMouseWithElapsedDuration(targetPoint.x, targetPoint.y, delayMs);

          if (AppState.replayStopRequested) {
            console.log("Replay stopped.");
            break;
          }

          if (row.action === "LClick") {
            robot.mouseClick("left");
          } else if (row.action === "RClick") {
            robot.mouseClick("right");
          }
        }
      }

      if (!AppState.replayRepeatEnabled || AppState.replayStopRequested) {
        break;
      }

      console.log("Replay cycle complete, restarting because repeat is enabled.");
    }

    if (!AppState.replayStopRequested) {
      console.log("Replay completed.");
    }
  } finally {
    AppState.replaying = false;
    AppState.replayStopRequested = false;
    AppState.currentReplayRowIndex = null;
    sendReplayState();
    sendReplayRowState();
  }
}
