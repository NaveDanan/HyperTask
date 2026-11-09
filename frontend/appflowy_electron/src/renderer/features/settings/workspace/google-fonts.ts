// google_fonts runtime loading: the main process fetches the faces (the renderer CSP blocks
// fonts.googleapis.com), and they are registered with the FontFace API.

const loaded = new Map<string, Promise<boolean>>();

/** Family name used for subset previews, so they never shadow the full font. */
export const previewFamily = (family: string) => `__af_preview__${family}`;

async function register(cssFamily: string, family: string, text?: string): Promise<boolean> {
  try {
    const faces = await window.appflowy.fonts.loadGoogleFont(family, text);
    if (faces.length === 0) return false;
    await Promise.all(
      faces.map(async (face) => {
        const data = face.data.buffer.slice(face.data.byteOffset, face.data.byteOffset + face.data.byteLength) as ArrayBuffer;
        const fontFace = new FontFace(cssFamily, data, {
          weight: face.weight,
          style: face.style,
          ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : null),
        });
        await fontFace.load();
        document.fonts.add(fontFace);
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** getGoogleFontSafely(family) for the workspace font: loads every face once. */
export function ensureGoogleFont(family: string): Promise<boolean> {
  if (!family) return Promise.resolve(false);
  let promise = loaded.get(family);
  if (!promise) {
    promise = register(family, family);
    loaded.set(family, promise);
    // A failure is retried next time (offline at startup, for example).
    void promise.then((ok) => !ok && loaded.delete(family));
  }
  return promise;
}

/** A font subset with just the glyphs of `text`, under previewFamily(family). */
export function ensureGoogleFontPreview(family: string, text: string): Promise<boolean> {
  const key = `${family}\u0000preview`;
  let promise = loaded.get(key);
  if (!promise) {
    promise = register(previewFamily(family), family, text);
    loaded.set(key, promise);
  }
  return promise;
}
