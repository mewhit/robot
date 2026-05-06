export type GuardianOfTheRiftOverlayMode = "helper" | "optimizer";

const DEFAULT_GUARDIAN_OF_THE_RIFT_OVERLAY_MODE: GuardianOfTheRiftOverlayMode = "optimizer";

function normalizeGuardianOfTheRiftOverlayMode(value: string | undefined): GuardianOfTheRiftOverlayMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "helper") {
    return "helper";
  }

  if (normalized === "optimizer" || normalized === "optimiser") {
    return "optimizer";
  }

  return DEFAULT_GUARDIAN_OF_THE_RIFT_OVERLAY_MODE;
}

export function getGuardianOfTheRiftOverlayMode(): GuardianOfTheRiftOverlayMode {
  return normalizeGuardianOfTheRiftOverlayMode(
    process.env.GUARDIAN_OF_THE_RIFT_OVERLAY_MODE ?? process.env.GOTR_OVERLAY_MODE,
  );
}
