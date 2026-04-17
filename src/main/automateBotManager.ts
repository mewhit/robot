import { AppState } from "./global-state";
import { onAgilityBotStart } from "./automate-bots/agility-bot";
import { onAttackZamorakWarriorSafeSpotBotStart } from "./automate-bots/attack-zamorak-warrior-safe-spot-bot";
import {
  AGILITY_BOT_ID,
  ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID,
  DEFAULT_AUTOMATE_BOT_ID,
  isAutomateBotId,
} from "./automate-bots/definitions";
import { flushOcrDebugDirectory } from "./automate-bots/shared/ocr-engine";
import { startAutomateBotLogSession, stopAutomateBotLogSession } from "./automateBotLogs";
import { CHANNELS } from "./ipcChannels";

const botStartHandlers = new Map<string, () => void>([
  [AGILITY_BOT_ID, onAgilityBotStart],
  [ATTACK_ZAMORAK_WARRIOR_SAFE_SPOT_BOT_ID, onAttackZamorakWarriorSafeSpotBotStart],
]);

const botStartFromStepHandlers = new Map<string, (stepId: string) => void>();

export function sendAutomateBotState() {
  AppState.mainWindow?.webContents.send(CHANNELS.AUTOMATE_BOT_STATE, {
    selectedBotId: AppState.selectedAutomateBotId,
    isRunning: AppState.automateBotRunning,
    currentStepId: AppState.automateBotCurrentStepId,
  });
}

export function setAutomateBotCurrentStep(stepId: string | null) {
  AppState.automateBotCurrentStepId = stepId;
  sendAutomateBotState();
}

export function setActiveView(view: "clicker" | "automateBot" | "debug") {
  AppState.activeView = view;
}

export function setSelectedAutomateBotId(botId: string | null) {
  const normalized = typeof botId === "string" ? botId.trim() : "";
  AppState.selectedAutomateBotId = isAutomateBotId(normalized) ? normalized : DEFAULT_AUTOMATE_BOT_ID;

  if (AppState.automateBotRunning && AppState.selectedAutomateBotId === null) {
    AppState.automateBotRunning = false;
  }

  sendAutomateBotState();
}

export function stopAutomateBot(source: "f2" | "ui" | "bot") {
  if (!AppState.automateBotRunning) {
    return;
  }

  stopAutomateBotLogSession(source, "bot-stopped");
  AppState.automateBotRunning = false;
  AppState.automateBotCurrentStepId = null;
  sendAutomateBotState();
  console.log(`Automate Bot STOPPED via ${source.toUpperCase()}.`);
}

export function startSelectedAutomateBot(source: "f2" | "ui") {
  if (AppState.automateBotRunning) {
    return;
  }

  const selectedBotId = AppState.selectedAutomateBotId ?? DEFAULT_AUTOMATE_BOT_ID;
  if (!selectedBotId) {
    throw new Error("No Automate Bot is selected.");
  }

  const selectedBotStartHandler = botStartHandlers.get(selectedBotId);
  if (!selectedBotStartHandler) {
    throw new Error(`Unsupported Automate Bot: ${selectedBotId}`);
  }

  flushOcrDebugDirectory();

  startAutomateBotLogSession(selectedBotId, source);
  AppState.automateBotRunning = true;
  sendAutomateBotState();
  selectedBotStartHandler();
}

export function startAutomateBotFromStep(stepId: string) {
  if (AppState.automateBotRunning) {
    return;
  }

  let matchedBotId: string | null = null;
  let matchedHandler: ((stepId: string) => void) | null = null;

  for (const [botId, handler] of botStartFromStepHandlers) {
    if (stepId.startsWith(botId)) {
      matchedBotId = botId;
      matchedHandler = handler;
      break;
    }
  }

  if (!matchedBotId || !matchedHandler) {
    throw new Error(`Unknown step ID: ${stepId}`);
  }

  flushOcrDebugDirectory();

  startAutomateBotLogSession(matchedBotId, "ui");
  AppState.selectedAutomateBotId = matchedBotId;
  AppState.automateBotRunning = true;
  sendAutomateBotState();
  matchedHandler(stepId);
}

export function toggleSelectedAutomateBot(source: "f2" | "ui") {
  if (AppState.automateBotRunning) {
    stopAutomateBot(source);
    return;
  }

  startSelectedAutomateBot(source);
}
