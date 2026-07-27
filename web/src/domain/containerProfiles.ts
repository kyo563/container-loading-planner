import { DEFAULT_CONTAINERS } from "./constants";
import type { ContainerSpec } from "./types";

export const STANDARD_CONTAINER_PROFILE_ID = "loadpilot-standard-v1";
export const STANDARD_CONTAINER_PROFILE_LABEL = "LoadPilot標準コンテナ v1";

const cloneSpecs = (specs: ContainerSpec[]): ContainerSpec[] =>
  specs.map((spec) => ({ ...spec }));

export const containerSpecsForProfile = (profileId: string): ContainerSpec[] => {
  if (profileId !== STANDARD_CONTAINER_PROFILE_ID) {
    throw new Error(`未対応の標準コンテナ定義「${profileId}」です。`);
  }
  return cloneSpecs(DEFAULT_CONTAINERS);
};

export const matchesContainerProfile = (
  specs: ContainerSpec[],
  profileId = STANDARD_CONTAINER_PROFILE_ID,
): boolean => JSON.stringify(specs) === JSON.stringify(containerSpecsForProfile(profileId));
