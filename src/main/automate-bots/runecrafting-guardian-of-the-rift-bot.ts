import * as logger from "../logger";
import { setAutomateBotCurrentStep, stopAutomateBot } from "../automateBotManager";
import { RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID } from "./definitions";

export function onRunecraftingGuardianOfTheRiftBotStart(): void {
  setAutomateBotCurrentStep(RUNECRAFTING_GUARDIAN_OF_THE_RIFT_BOT_ID);
  logger.log("Automate Bot STARTED (Runecrafting - Guardian of the Rift).");
  logger.warn(
    "Automate Bot (Runecrafting - Guardian of the Rift): placeholder only; bot logic is not implemented yet.",
  );

  stopAutomateBot("bot");
}
