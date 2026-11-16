import { useDndMonitor } from '@dnd-kit/core';
import type { HyperBoardValue } from './hyperBoardModel';

export function HyperBoardDragMonitor({ value, onOver }: { value: HyperBoardValue; onOver: (id: string | null) => void }) {
  useDndMonitor({ onDragOver: event => {
    const id = event.over ? String(event.over.id) : null;
    onOver(id ? id in value ? id : Object.keys(value).find(group => value[group].includes(id)) ?? null : null);
  } });
  return null;
}
