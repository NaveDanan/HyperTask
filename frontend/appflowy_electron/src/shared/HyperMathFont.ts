import font from './math/HyperMathFont.json';

/** Unmodified STIX Two Math, pinned and distributed under the accompanying OFL.
 * The single encoded asset is shared by the renderer, portable export and trusted PDF main. */
export const HYPER_MATH_FONT_FAMILY = font.family;
export const HYPER_MATH_FONT_SHA256 = font.sha256;
export const HYPER_MATH_FONT_BASE64 = font.base64;
export const HYPER_MATH_FONT_DATA_URL = `data:font/woff2;base64,${HYPER_MATH_FONT_BASE64}`;
export const HYPER_MATH_FONT_MARKER = font.marker;
/** Font-face only: PDF removes this URL rule and installs verified binary FontFace bytes. */
export const hyperMathFontCss = () => `@font-face{font-family:${JSON.stringify(HYPER_MATH_FONT_FAMILY)};src:url("${HYPER_MATH_FONT_DATA_URL}") format("woff2");font-style:normal;font-weight:400;font-display:block}`;
/** Kept separate so the PDF renderer retains the family after removing the URL font-face. */
export const HYPER_MATH_FONT_FAMILY_CSS = `.hyper-document-equation math,.hyper-document-inline-equation math{font-family:${JSON.stringify(HYPER_MATH_FONT_FAMILY)},math}`;
