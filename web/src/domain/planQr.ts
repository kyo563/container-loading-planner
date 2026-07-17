import QRCode from "qrcode";

import { buildSharedQrBundle, type ShareablePlanState } from "./sharedPlan";

export interface PlanQrData {
  url: string;
  dataUrl: string;
}

export interface PlanQrBundleData {
  plan: PlanQrData;
  specs?: PlanQrData;
  bundleId?: string;
}

export const PRINT_QR_PX = 768;
export const QR_QUIET_ZONE_MODULES = 4;

const createQr = async (url: string, width: number): Promise<PlanQrData> => {
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "L",
    margin: QR_QUIET_ZONE_MODULES,
    width,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return { url, dataUrl };
};

export const createPlanQrBundleData = async (plan: ShareablePlanState, width = 320): Promise<PlanQrBundleData> => {
  const bundle = await buildSharedQrBundle(plan);
  return {
    plan: await createQr(bundle.planUrl, width),
    ...(bundle.specsUrl ? { specs: await createQr(bundle.specsUrl, width), bundleId: bundle.bundleId } : {}),
  };
};

export const createPlanQrData = async (plan: ShareablePlanState, width = 320): Promise<PlanQrData> =>
  (await createPlanQrBundleData(plan, width)).plan;
