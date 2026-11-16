import { createContext, useContext } from 'react';
import type { HyperCell, HyperCellMutation, HyperDatabaseViewProps, HyperField } from '../../HyperDatabaseTypes';

export interface HyperGridAddress {
  rowId: string;
  fieldId: string;
  initial?: string;
}

export interface HyperGridContextValue extends HyperDatabaseViewProps {
  fields: HyperField[];
  moveField: (from: string, to: string) => Promise<void>;
  editing: HyperGridAddress | null;
  edit: (address: HyperGridAddress | null, tabDirection?: number) => void;
  write: (rowId: string, fieldId: string, mutation: HyperCellMutation, optimistic?: HyperCell, rejectOnError?: boolean) => Promise<void>;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  expand: (rowId: string) => void;
  cell: (rowId: string, fieldId: string) => HyperCell | undefined;
  deleteRows: (rowIds: string[]) => void;
}

export const HyperGridContext = createContext<HyperGridContextValue | null>(null);

export function useHyperGrid() {
  const context = useContext(HyperGridContext);

  if (!context)
    throw new Error('HyperGrid components require HyperGridContext');

  return context;
}
