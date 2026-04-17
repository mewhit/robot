import { AppState } from "./global-state";
import { AGILITY_BOT_ID, onAgilityBotStart } from "./automate-bots/agility-bot";
import { flushOcrDebugDirectory } from "./automate-bots/shared/ocr-engine";
import { startAutomateBotLogSession, stopAutomateBotLogSession } from "./automateBotLogs";
import { CHANNELS } from "./ipcChannels";

const botStartHandlers = new Map<string, () => void>([[AGILITY_BOT_ID, onAgilityBotStart]]);

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
  if (normalized === AGILITY_BOT_ID || normalized.length === 0) {
    AppState.selectedAutomateBotId = AGILITY_BOT_ID;
  } else {
    AppState.selectedAutomateBotId = AGILITY_BOT_ID;
  }

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

  const selectedBotId = AppState.selectedAutomateBotId;
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
