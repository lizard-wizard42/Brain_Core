import { createContext, useContext } from 'react';
import type { SharedPageSummary } from '../../types';

export interface SharedPagesState {
  received: SharedPageSummary[];
  sent: SharedPageSummary[];
  loading: boolean;
  error: string | null;
  sentError: string | null;
  byId: Map<string, SharedPageSummary>;
  getEntry: (id: string | null | undefined) => SharedPageSummary | undefined;
  refresh: () => void;
}

export const EMPTY_SHARED_PAGES: SharedPagesState = {
  received: [],
  sent: [],
  loading: false,
  error: null,
  sentError: null,
  byId: new Map(),
  getEntry: () => undefined,
  refresh: () => undefined,
};

export const SharedPagesContext = createContext<SharedPagesState>(EMPTY_SHARED_PAGES);

export function useSharedPages(): SharedPagesState {
  return useContext(SharedPagesContext);
}
