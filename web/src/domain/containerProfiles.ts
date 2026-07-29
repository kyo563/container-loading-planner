import { DEFAULT_CONTAINERS } from "./constants";
import type { ContainerSpec } from "./types";

export const STANDARD_CONTAINER_PROFILE_ID = "loadpilot-standard-v1";
export const STANDARD_CONTAINER_PROFILE_LABEL = "LoadPilot標準コンテナ v1";

const cloneSpecs = (specs: ContainerSpec[]): ContainerSpec[] =>
  specs.map((spec) => ({ ...spec }));

const sameSpec = (left: ContainerSpec, right: ContainerSpec): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

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

export const isStandardContainerType = (type: string): boolean =>
  DEFAULT_CONTAINERS.some((spec) => spec.type === type);

export const effectiveContainerSpecs = (customSpecs: ContainerSpec[]): ContainerSpec[] => {
  const customByType = new Map(customSpecs.map((spec) => [spec.type, spec]));
  return [
    ...DEFAULT_CONTAINERS.map((spec) => ({ ...(customByType.get(spec.type) ?? spec) })),
    ...customSpecs
      .filter((spec) => !isStandardContainerType(spec.type))
      .map((spec) => ({ ...spec })),
  ];
};

export const customContainerSpecsFromEffective = (specs: ContainerSpec[]): ContainerSpec[] => {
  const standardByType = new Map(DEFAULT_CONTAINERS.map((spec) => [spec.type, spec]));
  return specs
    .filter((spec) => {
      const standard = standardByType.get(spec.type);
      return !standard || !sameSpec(spec, standard);
    })
    .map((spec) => ({ ...spec }));
};
