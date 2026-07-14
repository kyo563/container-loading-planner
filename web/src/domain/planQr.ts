import QRCode from "qrcode";

import { buildSharedPlanUrl, type ShareablePlanState } from "./sharedPlan";

export interface PlanQrData {
  url: string;
  dataUrl: string;
}

export const createPlanQrData = async (plan: ShareablePlanState, width = 320): Promise<PlanQrData> => {
  const url = await buildSharedPlanUrl(plan);
  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "L",
    margin: 2,
    width,
    color: { dark: "#0b2239", light: "#ffffff" },
  });
  return { url, dataUrl };
};
