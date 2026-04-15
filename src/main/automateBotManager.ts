import { AppState } from "./global-state";
import { FALADOR_ROOFTOP_BOT_ID, onFaladorRooftopStart, onFaladorRooftopStartFromStep } from "./automateBots/faladorRooftop";

const botStartHandlers = new Map<string, () => void>([[FALADOR_ROOFTOP_BOT_ID, onFaladorRooftopStart]]);

const botStartFromStepHandlers = new Map<string, (stepId: string) => void>([[FALADOR_ROOFTOP_BOT_ID, onFaladorRooftopStartFromStep]]);

export function sendAutomateBotState() {
  AppState.mainWindow?.webContents.send("automate-bot-state", {
    selectedBotId: AppState.selectedAutomateBotId,
    isRunning: AppState.automateBotRunning,
    currentStepId: AppState.automateBotCurrentStepId,
  });
}

export function setAutomateBotCurrentStep(stepId: string | null) {
  AppState.automateBotCurrentStepId = stepId;
  sendAutomateBotState();
}

export function setActiveView(view: "clicker" | "automateBot") {
  AppState.activeView = view;
}

export function setSelectedAutomateBotId(botId: string | null) {
  const normalized = typeof botId === "string" ? botId.trim() : "";
  AppState.selectedAutomateBotId = normalized.length > 0 ? normalized : null;

  if (AppState.automateBotRunning && AppState.selectedAutomateBotId === null) {
    AppState.automateBotRunning = false;
  }

  sendAutomateBotState();
}

export function stopAutomateBot(source: "f2" | "ui") {
  if (!AppState.automateBotRunning) {
    return;
  }

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
