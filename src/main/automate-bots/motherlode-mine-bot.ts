import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { AppState } from "../global-state";
import { CHANNELS } from "../ipcChannels";
import * as logger from "../logger";
import { getRuneLite } from "../runeLiteWindow";
import { MINING_MOTHERLODE_MINE_BOT_ID } from "./definitions";
import { screen } from "robotjs";
import { detectBestPlayerBoxInScreenshot } from "./shared/player-box-detector";
import {
  detectBestMotherlodeMineBoxInScreenshot,
  detectBestGreenMotherlodeMineBoxInScreenshot,
  detectBestYellowMotherlodeMineBoxInScreenshot,
} from "./shared/motherlode-mine-box-detector";
import { screen as electronScreen } from "electron";

const BOT_NAME = "Motherlode Mine";

interface ScreenCaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function getWindowsDisplayMeta(bounds: ScreenCaptureBounds): {
  scaleFactor: number;
} {
  const display = electronScreen.getDisplayMatching({
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  });

  const scaleFactor = Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1;
  return { scaleFactor };
}

function toPhysicalCaptureBounds(bounds: ScreenCaptureBounds, scaleFactor: number): ScreenCaptureBounds {
  const safeScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    x: Math.round(bounds.x * safeScale),
    y: Math.round(bounds.y * safeScale),
    width: Math.max(1, Math.round(bounds.width * safeScale)),
    height: Math.max(1, Math.round(bounds.height * safeScale)),
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

export function onMotherlodeMineBotStart(): void {
  logger.log(`Automate Bot STARTED (${BOT_NAME}).`);
  setAutomateBotCurrentStep(MINING_MOTHERLODE_MINE_BOT_ID);

  const window = getRuneLite();
  if (!window) {
    const message = `${BOT_NAME} could not start because the RuneLite window was not found.`;
    logger.warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.bringToTop();

  // Get window bounds
  const windowBounds = window.getBounds();
  const bounds: ScreenCaptureBounds = {
    x: Number(windowBounds.x),
    y: Number(windowBounds.y),
    width: Number(windowBounds.width),
    height: Number(windowBounds.height),
  };

  // Validate bounds
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value))) {
    const message = "Cannot take screenshot due to invalid RuneLite bounds.";
    logger.warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    const message = "Cannot take screenshot due to invalid RuneLite bounds.";
    logger.warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  // Get display scale factor
  const displayMeta = getWindowsDisplayMeta(bounds);
  const captureBounds = toPhysicalCaptureBounds(bounds, displayMeta.scaleFactor);

  // Capture screenshot
  const bitmap = screen.capture(captureBounds.x, captureBounds.y, captureBounds.width, captureBounds.height);

  // Detect player
  const playerBox = detectBestPlayerBoxInScreenshot(bitmap);
  if (!playerBox) {
    const message = "Could not detect player position.";
    logger.warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  logger.log(`Automate Bot (${BOT_NAME}): Player detected at (${playerBox.centerX}, ${playerBox.centerY}).`);

  // Detect motherlode mine nodes
  const mineBox = detectBestMotherlodeMineBoxInScreenshot(bitmap);
  if (!mineBox) {
    const message = "Could not detect motherlode mine node.";
    logger.warn(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  logger.log(
    `Automate Bot (${BOT_NAME}): Mine node detected at (${mineBox.centerX}, ${mineBox.centerY}) - Color: ${mineBox.color}.`,
  );

  // If the nearest node is yellow, check for a new green node
  let targetNode = mineBox;
  if (mineBox.color === "yellow") {
    logger.log(`Automate Bot (${BOT_NAME}): Nearest node turned yellow, searching for a new green node.`);

    const greenNode = detectBestGreenMotherlodeMineBoxInScreenshot(bitmap);
    if (greenNode) {
      logger.log(`Automate Bot (${BOT_NAME}): Found new green node at (${greenNode.centerX}, ${greenNode.centerY}).`);
      targetNode = greenNode;
    } else {
      logger.warn(`Automate Bot (${BOT_NAME}): No green nodes found, will click on the yellow node.`);
    }
  }

  // Calculate distance from player to mine
  const dx = targetNode.centerX - playerBox.centerX;
  const dy = targetNode.centerY - playerBox.centerY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  logger.log(`Automate Bot (${BOT_NAME}): Distance from player to mine: ${distance.toFixed(2)} pixels.`);

  // Click on the mine node
  const clickX = captureBounds.x + targetNode.centerX;
  const clickY = captureBounds.y + targetNode.centerY;

  logger.log(`Automate Bot (${BOT_NAME}): Clicking mine node at screen coordinates (${clickX}, ${clickY}).`);

  try {
    const robot = require("robotjs");
    robot.moveMouse(clickX, clickY);
    robot.mouseClick("left");
    logger.log(`Automate Bot (${BOT_NAME}): Successfully clicked mine node.`);
  } catch (error) {
    const message = `Failed to click mine node: ${error instanceof Error ? error.message : String(error)}`;
    logger.error(`Automate Bot (${BOT_NAME}): ${message}`);
    notifyUserAndStop(message);
    return;
  }

  logger.log(`Automate Bot (${BOT_NAME}): Completed one mining action.`);
  stopAutomateBot("bot");
}
