export const ceilTo = (value: number, quantum: number): number =>
  Math.ceil((value - Number.EPSILON) / quantum) * quantum;

export const ceilCm = (value: number): number => ceilTo(value, 1);
export const ceilM3 = (value: number): number => ceilTo(value, 0.001);
export const roundTo = (value: number, digits = 1): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const fmt = (value: number, digits = 1): string =>
  new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);

export const fmtInt = (value: number): string =>
  new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);

