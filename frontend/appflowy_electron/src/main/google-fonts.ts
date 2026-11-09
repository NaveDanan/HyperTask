import { net } from 'electron';
import type { GoogleFontFace } from '@shared/api';

// google_fonts runtime loading for the workspace font picker. The renderer's CSP blocks
// fonts.googleapis.com / fonts.gstatic.com, so the main process fetches the CSS and the
// font files; the renderer registers them with the FontFace API.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const cache = new Map<string, Promise<GoogleFontFace[]>>();

export function googleFontsCssUrl(family: string, text?: string): string {
  const query = encodeURIComponent(family).replace(/%20/g, '+');
  return `https://fonts.googleapis.com/css2?family=${query}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
}

export interface ParsedFontFace {
  weight: string;
  style: string;
  unicodeRange?: string;
  url: string;
}

/** The @font-face blocks of a Google Fonts css2 response (fonts.gstatic.com sources only). */
export function parseFontFaces(css: string): ParsedFontFace[] {
  const faces: ParsedFontFace[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1];
    const url = /src:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(body)?.[1];
    if (!url || !url.startsWith('https://fonts.gstatic.com/')) continue;
    faces.push({
      url,
      style: /font-style:\s*([^;]+);/.exec(body)?.[1].trim() ?? 'normal',
      weight: /font-weight:\s*([^;]+);/.exec(body)?.[1].trim() ?? '400',
      unicodeRange: /unicode-range:\s*([^;]+);/.exec(body)?.[1].trim(),
    });
  }
  return faces;
}

async function fetchFaces(family: string, text?: string): Promise<GoogleFontFace[]> {
  const response = await net.fetch(googleFontsCssUrl(family, text), { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const faces = parseFontFaces(await response.text());
  return Promise.all(
    faces.map(async (face) => {
      const file = await net.fetch(face.url, { headers: { 'User-Agent': USER_AGENT } });
      if (!file.ok) throw new Error(`HTTP ${file.status}`);
      const data = new Uint8Array(await file.arrayBuffer());
      return { weight: face.weight, style: face.style, unicodeRange: face.unicodeRange, data };
    }),
  );
}

/** Never throws: a font that cannot be fetched falls back to the default font, as getGoogleFontSafely. */
export function loadGoogleFont(family: string, text?: string): Promise<GoogleFontFace[]> {
  if (!family) return Promise.resolve([]);
  const key = `${family}\u0000${text ?? ''}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchFaces(family, text).catch(() => {
      cache.delete(key);
      return [];
    });
    cache.set(key, pending);
  }
  return pending;
}
