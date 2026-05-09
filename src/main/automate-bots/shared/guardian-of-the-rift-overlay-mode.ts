export type GuardianOfTheRiftOverlayMode = "helper" | "optimizer";

const DEFAULT_GUARDIAN_OF_THE_RIFT_OVERLAY_MODE: GuardianOfTheRiftOverlayMode = "optimizer";

function normalizeGuardianOfTheRiftOverlayMode(_value: string | undefined): GuardianOfTheRiftOverlayMode {
  return DEFAULT_GUARDIAN_OF_THE_RIFT_OVERLAY_MODE;
}

export function getGuardianOfTheRiftOverlayMode(): GuardianOfTheRiftOverlayMode {
  return normalizeGuardianOfTheRiftOverlayMode(
    process.env.GUARDIAN_OF_THE_RIFT_OVERLAY_MODE ?? process.env.GOTR_OVERLAY_MODE,
  );
}
