/** AppFlowy stores colors as 0xaarrggbb; CSS hex stores alpha last. */
export function hyperDocumentColorCss(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (/^0x[\da-f]{8}$/.test(text)) return `#${text.slice(4)}${text.slice(2, 4)}`;
  if (/^#[\da-f]{3,4}$/.test(text)) return `#${Array.from(text.slice(1), digit => digit + digit).join('')}`;
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/.test(text)) return text;
  // Legacy imports contain rgb()/rgba(). Accept numeric channels only, never CSS
  // expressions, variables, URLs or additional declarations.
  const match = /^rgba?\(([\d.,%/ +\-]+)\)$/.exec(text);
  if (!match) return null;
  const parts = match[1].trim().split(/[\s,/]+/);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const values = parts.map((part, index) => {
    if (!/^[+\-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(part)) return NaN;
    const percentage = part.endsWith('%'), value = Number(part.replace('%', ''));
    const maximum = percentage ? 100 : index === 3 ? 1 : 255;
    return Number.isFinite(value) && value >= 0 && value <= maximum ? Math.round(value / maximum * 255) : NaN;
  });
  if (values.some(value => !Number.isFinite(value))) return null;
  return `#${values.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}
export function hyperDocumentColorAttribute(value: string): string {
  const css = hyperDocumentColorCss(value);
  if (!css) throw new Error('Choose a valid color.');
  const digits = css.slice(1);
  return `0x${digits.length === 8 ? digits.slice(6) : 'ff'}${digits.slice(0, 6)}`;
}
