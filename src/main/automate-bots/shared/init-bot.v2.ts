import { mouseClick, moveMouse } from "robotjs";
import { screen as electronScreen } from "electron";
import { Window } from "node-window-manager";
import * as logger from "../../logger";
import { getRuneLite } from "../../runeLiteWindow";
import { stopAutomateBot } from "../../automateBotManager";
import { captureScreenRect } from "../../windowsScreenCapture";
import { detectBestAgilityBoxInScreenshot, AgilityBox } from "./agility-box-detector";
import { detectOverlayBoxInScreenshot, OverlayBox } from "./coordinate-box-detector";
import { detectTileLocationBoxInScreenshot, TileLocationBox } from "./tile-location-detection";
import { AppState } from "../../global-state";
import { CHANNELS } from "../../ipcChannels";

const POST_FOCUS_SETTLE_MS = 200;

type MissingRequirement = "agility" | "tile-location" | "coordinate-box";

type InitBotDetections = {
  agility: AgilityBox | null;
  tileLocation: TileLocationBox | null;
  coordinateBox: OverlayBox | null;
};

export type InitBotResult = {
  ok: boolean;
  window?: Window;
  detections?: InitBotDetections;
  missingRequirements?: MissingRequirement[];
  error?: string;
};

function getPlayableBounds(window: Window): { x: number; y: number; width: number; height: number } | null {
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

function getSceneFocusPoint(bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: Math.round(bounds.x + bounds.width * 0.35),
    y: Math.round(bounds.y + bounds.height * 0.45),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeMissingRequirement(requirement: MissingRequirement): string {
  switch (requirement) {
    case "agility":
      return "agility box";
    case "tile-location":
      return "tile-location text";
    case "coordinate-box":
      return "coordinate-box overlay";
  }
}

function buildMissingRequirementsMessage(missingRequirements: MissingRequirement[]): string {
  const missingText = missingRequirements.map(describeMissingRequirement).join(", ");
  const guidance: string[] = [];

  if (missingRequirements.includes("coordinate-box")) {
    guidance.push("enable the RuneLite 'Word Location' plugin and turn on 'Grid Info'");
  }
  if (missingRequirements.includes("tile-location")) {
    guidance.push("make sure the tile-location text is visible in the game view");
  }
  if (missingRequirements.includes("agility")) {
    guidance.push("make sure an agility highlight box is visible before starting");
  }

  const guidanceText = guidance.length > 0 ? ` Fix: ${guidance.join("; ")}.` : "";
  return `Agility bot v2 startup check failed. Missing: ${missingText}.${guidanceText}`;
}

export async function initAgilityBotV2(): Promise<InitBotResult> {
  const window = getRuneLite();
  if (!window) {
    const message = "RuneLite window not found.";
    logger.error(`Bot Init: ${message}`);
    notifyUserAndStop(message);
    return { ok: false, error: message };
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();

  const bounds = getPlayableBounds(window);
  if (!bounds) {
    const message = "Cannot initialize bot due to invalid RuneLite window bounds.";
    logger.error(`Bot Init: ${message}`);
    notifyUserAndStop(message);
    return { ok: false, error: message };
  }

  const focusPoint = getSceneFocusPoint(bounds);
  logger.info(`Bot Init: focusing RuneLite and clicking at x=${focusPoint.x}, y=${focusPoint.y}.`);
  moveMouse(focusPoint.x, focusPoint.y);
  mouseClick("left", false);

  await sleep(POST_FOCUS_SETTLE_MS);

  const fullBitmap = captureScreenRect(bounds.x, bounds.y, bounds.width, bounds.height);
  const display = electronScreen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });
  const windowsScalePercent = Math.round(
    (Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1) * 100,
  );
  const detections: InitBotDetections = {
    agility: detectBestAgilityBoxInScreenshot(fullBitmap),
    tileLocation: detectTileLocationBoxInScreenshot(fullBitmap),
    coordinateBox: detectOverlayBoxInScreenshot(fullBitmap, windowsScalePercent),
  };
  const missingRequirements: MissingRequirement[] = [];

  if (!detections.coordinateBox) {
    missingRequirements.push("coordinate-box");
  }
  if (!detections.tileLocation) {
    missingRequirements.push("tile-location");
  }
  if (!detections.agility) {
    missingRequirements.push("agility");
  }

  if (missingRequirements.length > 0) {
    const message = buildMissingRequirementsMessage(missingRequirements);
    logger.error(`Bot Init: ${message}`);
    notifyUserAndStop(message);
    return { ok: false, window, detections, missingRequirements, error: message };
  }

  const coordinateBox = detections.coordinateBox!;
  const tileLocation = detections.tileLocation!;
  const agility = detections.agility!;

  logger.info(
    `Bot Init: coordinate-box='${coordinateBox.matchedLine}', tile-location='${tileLocation.matchedLine}', agility=${agility.color} at x=${agility.x}, y=${agility.y}.`,
  );

  return { ok: true, window, detections };
}

function notifyUserAndStop(errorMessage: string): void {
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }

  stopAutomateBot("bot");
}
