import * as fs from "fs";
import { AppState, activeModifiers } from "./global-state";
import { showOverlay, hideOverlay } from "./overlay";
import { sendOutputFolderState } from "./csvOperator";
import { DEFAULT_CLICK_RADIUS, DEFAULT_ELAPSED_RANGE } from "./constants";

export function sendRecordingState() {
  AppState.mainWindow?.webContents.send("recording-state", AppState.recording);
}

export function sendReplayState() {
  AppState.mainWindow?.webContents.send("replaying-state", AppState.replaying);
}

export function sendReplayRepeatState() {
  AppState.mainWindow?.webContents.send("replay-repeat-state", AppState.replayRepeatEnabled);
}

export function sendReplayDelayState() {
  AppState.mainWindow?.webContents.send("replay-delay-state", AppState.replayExtraDelayMs);
}

export function sendReplayRowState() {
  AppState.mainWindow?.webContents.send("replay-row-state", AppState.currentReplayRowIndex);
}

export function sendMarkerColorState() {
  AppState.mainWindow?.webContents.send("marker-color-state", {
    color: AppState.markerColor,
    confidence: AppState.markerConfidence,
    point: AppState.markerPoint,
  });
}

export function toggleRecording(source: "f3" | "ui") {
  AppState.recording = !AppState.recording;
  if (AppState.recording) {
    AppState.lastClickTime = null;
    showOverlay();
    console.log(`Recording STARTED via ${source.toUpperCase()} — click anywhere to register positions.`);
  } else {
    hideOverlay();
    console.log(`Recording STOPPED via ${source.toUpperCase()}.`);
  }

  sendRecordingState();
  if (!AppState.recording) {
    sendOutputFolderState();
  }
}

export function recordMouseClick(button: 1 | 2, x: number, y: number) {
  const now = Date.now();
  const elapsedSeconds = AppState.lastClickTime !== null ? ((now - AppState.lastClickTime) / 1000).toFixed(3) : "0.000";
  AppState.lastClickTime = now;
  const action = button === 1 ? "LClick" : "RClick";

  const xMin = x - DEFAULT_CLICK_RADIUS;
  const xMax = x + DEFAULT_CLICK_RADIUS;
  const yMin = y - DEFAULT_CLICK_RADIUS;
  const yMax = y + DEFAULT_CLICK_RADIUS;
  const line = `${action},"(${x}, ${y})",${elapsedSeconds},${DEFAULT_CLICK_RADIUS},${DEFAULT_ELAPSED_RANGE},${xMin},${xMax},${yMin},${yMax},${DEFAULT_ELAPSED_RANGE},${DEFAULT_ELAPSED_RANGE},${action}\n`;
  console.log(`Registered click at: ${line.trim()}`);
  fs.appendFileSync(AppState.outputFilePath, line);
}

export function recordKeyPress(action: string, robotKey: string) {
  const now = Date.now();
  const elapsedSeconds = AppState.lastClickTime !== null ? ((now - AppState.lastClickTime) / 1000).toFixed(3) : "0.000";
  AppState.lastClickTime = now;
  const modParts = [...activeModifiers].sort();
  const fullAction = modParts.length > 0 ? `Key:${modParts.join("+")}+${robotKey}` : `Key:${robotKey}`;
  const line = `${fullAction},"(0, 0)",${elapsedSeconds},0,${DEFAULT_ELAPSED_RANGE},0,0,0,0,${DEFAULT_ELAPSED_RANGE},${DEFAULT_ELAPSED_RANGE},${fullAction}\n`;
  console.log(`Registered keystroke: ${line.trim()}`);
  fs.appendFileSync(AppState.outputFilePath, line);
}
