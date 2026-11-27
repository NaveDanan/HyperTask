// Adapted from t3code (apps/web/src/composer-list-continuation.ts), Copyright (c) 2026 T3 Tools Inc., MIT License. See LICENSE.t3code.
export function nextOrderedMarkerText(marker: string): string {
  const numberText = marker.slice(0, -1);
  const delimiter = marker.slice(-1);
  const number = Number.parseInt(numberText, 10);
  const next = Number.isSafeInteger(number)
    ? String(number + 1).padStart(numberText.length, "0")
    : numberText;
  return `${next}${delimiter}`;
}
