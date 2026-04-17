import * as path from "path";
import * as child_process from "child_process";
import { BrowserWindow } from "electron";
import { DEFAULT_OUTPUT_DIR, DEFAULT_OUTPUT_FILE_NAME } from "./constants";
import { DEFAULT_AUTOMATE_BOT_ID } from "./automate-bots/definitions";

// Shared state for recording/replay
export class AppState {
  static activeView: "clicker" | "automateBot" | "debug" = "clicker";
  static selectedAutomateBotId: string | null = DEFAULT_AUTOMATE_BOT_ID;
  static automateBotRunning = false;
  static automateBotCurrentStepId: string | null = null;
  static combatAutoTriggerCount = 0;

  static recording = false;
  static replaying = false;
  static replayStopRequested = false;
  static replayRepeatEnabled = false;
  static replayExtraDelayMs = 0;
  static currentReplayRowIndex: number | null = null;
  static lastClickTime: number | null = null;
  static markerColor: "green" | "red" | "none" = "none";
  static markerConfidence = 0;
  static markerPoint: { x: number; y: number } | null = null;

  // Overlay process management
  static overlayProcess: child_process.ChildProcess | null = null;
  static overlayProcessPid: number | null = null;

  // Window and file management
  static mainWindow: BrowserWindow | null = null;
  static outputFolderPath = DEFAULT_OUTPUT_DIR;
  static outputFilePath = path.join(AppState.outputFolderPath, DEFAULT_OUTPUT_FILE_NAME);
}

// Active modifiers state
export const activeModifiers = new Set<string>();
