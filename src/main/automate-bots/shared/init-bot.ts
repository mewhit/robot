import { screen } from "robotjs";
import { screen as electronScreen } from "electron";
import { Window } from "node-window-manager";
import * as logger from "../../logger";
import { getRuneLite } from "../../runeLiteWindow";
import { stopAutomateBot } from "../../automateBotManager";
import { detectOverlayBoxInScreenshot, OverlayBox } from "./coordinate-box-detector";
import { AppState } from "../../global-state";
import { CHANNELS } from "../../ipcChannels";

const RUNELIT_PLUGIN_ERROR_MESSAGE =
  "Failed to detect coordinates overlay. Please ensure you are using RuneLite Client with the 'Word Location' plugin enabled and the 'Grid Info' option turned on.";

export type InitBotResult = {
  ok: boolean;
  window?: Window;
  overlay?: OverlayBox;
  error?: string;
};

function getPlayableBounds(window: any): { x: number; y: number; width: number; height: number } | null {
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

export function initBotCoordinateDetection(): InitBotResult {
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

  // Capture the full screenshot from RuneLite window
  const fullBitmap = screen.capture(bounds.x, bounds.y, bounds.width, bounds.height);

  const display = electronScreen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });
  const windowsScalePercent = Math.round(
    (Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1) * 100,
  );

  // Detect coordinate overlay in screenshot
  const detectedOverlay = detectOverlayBoxInScreenshot(fullBitmap, windowsScalePercent);

  if (!detectedOverlay) {
    logger.error(`Bot Init: ${RUNELIT_PLUGIN_ERROR_MESSAGE}`);
    notifyUserAndStop(RUNELIT_PLUGIN_ERROR_MESSAGE);
    return { ok: false, error: RUNELIT_PLUGIN_ERROR_MESSAGE };
  }

  logger.info(
    `Bot Init: Coordinates detected - ${detectedOverlay.matchedLine} at x=${detectedOverlay.x}, y=${detectedOverlay.y}`,
  );

  return { ok: true, window, overlay: detectedOverlay };
}

/**
 * Notify the user of an error and stop the bot
 */
function notifyUserAndStop(errorMessage: string): void {
  // Send error notification to UI
  if (AppState.mainWindow?.webContents) {
    AppState.mainWindow.webContents.send(CHANNELS.AUTOMATE_BOT_ERROR, {
      message: errorMessage,
    });
  }

  // Stop the bot
  stopAutomateBot("ui");
}
