import type { DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperPlainText } from '../document/HyperDocumentModel';

export interface HyperDocumentHeading {
  id: string;
  title: string;
  level: number;
  ancestorIds: string[];
}
export interface HyperDocumentOutlineData { headings: HyperDocumentHeading[]; invalid: boolean }

/** Follow the live document tree. Canvas children and detached blocks belong to other views. */
export function hyperDocumentOutline(document: DocumentDataPB | null): HyperDocumentOutlineData {
  if (!document) return { headings: [], invalid: false };
  try {
    const headings: HyperDocumentHeading[] = [], stack = [document.pageId];
    const parents = new Map<string, string | null>([[document.pageId, null]]);
    while (stack.length) {
      const id = stack.pop()!, block = document.blocks[id];
      if (!block || block.id !== id) throw new Error('Missing or mismatched block');
      const parent = parents.get(id);
      if (parent !== null && block.parentId !== parent) throw new Error('Mismatched block parent');
      if (block.ty === 'hyper_canvas') continue;
      if (block.ty === 'heading') {
        const rawLevel = Number(hyperBlockData(block).level ?? 1);
        const level = Number.isFinite(rawLevel) ? Math.min(6, Math.max(1, Math.trunc(rawLevel))) : 1;
        const ancestorIds: string[] = [];
        for (let parent = parents.get(id); parent; parent = parents.get(parent)) ancestorIds.push(parent);
        headings.push({ id, title: hyperPlainText(hyperBlockText(document, block)).replace(/\s+/g, ' ').trim(), level, ancestorIds: ancestorIds.reverse() });
      }
      const children = hyperChildren(document, block);
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (parents.has(child)) throw new Error('Repeated block');
        parents.set(child, id); stack.push(child);
      }
    }
    return { headings, invalid: false };
  } catch { return { headings: [], invalid: true }; }
}
