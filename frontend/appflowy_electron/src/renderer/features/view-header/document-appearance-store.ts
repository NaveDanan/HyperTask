// DocumentAppearanceCubit's font size (plugins/document/application/document_appearance_cubit.dart):
// SharedPreferences double `kDocumentAppearanceFontSize`, default 16, shared by every document.
import { create } from 'zustand';
import { KeyValueStorage } from '@/startup/kv';

export const kDocumentAppearanceFontSize = 'kDocumentAppearanceFontSize';

function readFontSize(): number {
  try {
    const value = Number(KeyValueStorage.get(kDocumentAppearanceFontSize));
    return Number.isFinite(value) && value > 0 ? value : 16;
  } catch {
    return 16;
  }
}

export const useDocumentFontSize = create<{ fontSize: number }>(() => ({ fontSize: readFontSize() }));

/** syncFontSize(fontSize). */
export async function syncFontSize(fontSize: number) {
  useDocumentFontSize.setState({ fontSize });
  // KeyValueStorage keeps strings (and its cache); the file keeps the double Flutter's getDouble reads.
  await KeyValueStorage.set(kDocumentAppearanceFontSize, String(fontSize));
  await window.appflowy.prefs.setDouble(kDocumentAppearanceFontSize, fontSize);
}

/** Re-reads the stored value (a new home mount). */
export function refreshDocumentFontSize() {
  useDocumentFontSize.setState({ fontSize: readFontSize() });
}
