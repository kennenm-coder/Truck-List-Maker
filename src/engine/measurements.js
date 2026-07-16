const FRACTION_AT_END = /(?:(\d+(?:\.\d+)?)\s+)?\.?(\d+)\s*\/\s*(\d+)$/;
const DECIMAL_AT_END = /(\d+(?:\.\d+)?)$/;

export function parseMeasurementToken(value) {
  const token = String(value ?? "").trim().replaceAll('"', "").replace(/\s+/g, " ");
  const fraction = token.match(FRACTION_AT_END);
  if (fraction) {
    const denominator = Number(fraction[3]);
    if (!denominator) return null;
    return Number(fraction[1] ?? 0) + Number(fraction[2]) / denominator;
  }
  const decimal = token.match(DECIMAL_AT_END);
  return decimal ? Number(decimal[1]) : null;
}

export function extractWidth(description) {
  const beforeX = String(description ?? "").split(/\s*[xX]\s*/, 1)[0];
  const candidates = beforeX.match(/(?:(?:\d+(?:\.\d+)?)\s+)?\.?(?:\d+\s*\/\s*\d+)|\d+(?:\.\d+)?/g);
  if (!candidates?.length) return null;
  return parseMeasurementToken(candidates.at(-1));
}

