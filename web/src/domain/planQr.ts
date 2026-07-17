import QRCode from "qrcode";

import { buildSharedPlanUrl, type ShareablePlanState } from "./sharedPlan";

export interface PlanQrData {
  url: string;
  dataUrl: string;
}

export const PRINT_QR_PX = 768;
export const QR_QUIET_ZONE_MODULES = 4;

export const createPlanQrData = async (plan: ShareablePlanState, width = 320): Promise<PlanQrData> => {
  const url = await buildSharedPlanUrl(plan);
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "L",
    margin: QR_QUIET_ZONE_MODULES,
    width,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return { url, dataUrl };
};
