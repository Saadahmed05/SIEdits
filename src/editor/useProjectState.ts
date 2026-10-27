/**
 * Editor state for one project: undo/redo history, live validation and debounced autosave.
 * Only valid projects are saved; validation issues are surfaced to the UI instead.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { parseProject, type Project, type ValidationIssue } from '../project/schema';
import { api, ApiError } from './api';

interface History {
  present: Project;
  past: Project[];
  future: Project[];
  /** Edits with the same key in quick succession (e.g. typing) merge into one undo step. */
  lastKey: string | null;
  lastAt: number;
}

type Action =
  | { type: 'edit'; fn: (p: Project) => Project; key?: string }
  | { type: 'replace'; project: Project; keepHistory: boolean }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX_HISTORY = 100;
const COALESCE_MS = 800;

function reducer(state: History, action: Action): History {
  switch (action.type) {
    case 'edit': {
      const next = action.fn(state.present);
      if (next === state.present) return state;
      const now = Date.now();
      const coalesce = action.key && action.key === state.lastKey && now - state.lastAt < COALESCE_MS;
      return {
        present: next,
        past: coalesce ? state.past : [...state.past, state.present].slice(-MAX_HISTORY),
        future: [],
        lastKey: action.key ?? null,
        lastAt: now,
      };
    }
    case 'replace':
      return action.keepHistory
        ? { present: action.project, past: [...state.past, state.present].slice(-MAX_HISTORY), future: [], lastKey: null, lastAt: 0 }
        : { present: action.project, past: [], future: [], lastKey: null, lastAt: 0 };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return { present: prev, past: state.past.slice(0, -1), future: [state.present, ...state.future], lastKey: null, lastAt: 0 };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { present: next, past: [...state.past, state.present], future: rest, lastKey: null, lastAt: 0 };
    }
  }
}

export type SaveStatus =
  | { kind: 'saved'; at: string }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'invalid'; issues: ValidationIssue[] }
  | { kind: 'error'; message: string; issues: ValidationIssue[] };

export function useProjectState(initial: Project) {
  const [state, dispatch] = useReducer(reducer, { present: initial, past: [], future: [], lastKey: null, lastAt: 0 });
  const [status, setStatus] = useState<SaveStatus>({ kind: 'saved', at: initial.updatedAt });
  const savedRef = useRef<Project>(initial);
  const project = state.present;

  const validation = useMemo(() => parseProject(project), [project]);

  useEffect(() => {
    if (project === savedRef.current) return;
    if (!validation.ok) {
      setStatus({ kind: 'invalid', issues: validation.issues });
      return;
    }
    setStatus({ kind: 'dirty' });
    const handle = window.setTimeout(async () => {
      setStatus({ kind: 'saving' });
      try {
        const { project: saved } = await api.saveProject(validation.value);
        savedRef.current = project;
        setStatus({ kind: 'saved', at: saved.updatedAt });
      } catch (err) {
        const e = err as ApiError;
        setStatus({ kind: 'error', message: e.message, issues: e.issues ?? [] });
      }
    }, 600);
    return () => window.clearTimeout(handle);
  }, [project, validation]);

  const edit = useCallback((fn: (p: Project) => Project, key?: string) => dispatch({ type: 'edit', fn, key }), []);
  const replace = useCallback((p: Project, opts: { saved?: boolean; keepHistory?: boolean } = {}) => {
    if (opts.saved) {
      savedRef.current = p;
      setStatus({ kind: 'saved', at: p.updatedAt });
    }
    dispatch({ type: 'replace', project: p, keepHistory: opts.keepHistory ?? true });
  }, []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  /** Wait for pending edits to be saved (used before rendering). Returns false if not savable. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (project === savedRef.current) return true;
    if (!validation.ok) return false;
    setStatus({ kind: 'saving' });
    try {
      const { project: saved } = await api.saveProject(validation.value);
      savedRef.current = project;
      setStatus({ kind: 'saved', at: saved.updatedAt });
      return true;
    } catch (err) {
      const e = err as ApiError;
      setStatus({ kind: 'error', message: e.message, issues: e.issues ?? [] });
      return false;
    }
  }, [project, validation]);

  return {
    project,
    validProject: validation.ok ? validation.value : null,
    issues: validation.ok ? [] : validation.issues,
    status,
    edit,
    replace,
    undo,
    redo,
    flush,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
