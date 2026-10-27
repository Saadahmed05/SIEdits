import { useEffect, useState } from 'react';
import type { GenerationReport } from '../ai/generate';
import type { Project } from '../project/schema';
import { api, ApiError, type Health } from './api';
import { Editor } from './components/Editor';
import { Home } from './components/Home';

/** Minimal hash routing: #/ (home) and #/p/<projectId> (editor), so reloads keep the project open. */
function projectIdFromHash(): string | null {
  return window.location.hash.match(/^#\/p\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [open, setOpen] = useState<{ project: Project; report: GenerationReport | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const sync = async () => {
      const id = projectIdFromHash();
      if (!id) {
        setOpen(null);
        return;
      }
      if (open?.project.id === id) return;
      try {
        setOpen({ project: (await api.getProject(id)).project, report: null });
      } catch (e) {
        setError((e as ApiError).message);
        window.location.hash = '#/';
      }
    };
    void sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [open?.project.id]);

  return (
    <>
      {error && (
        <div className="toast error" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {open ? (
        <Editor
          key={open.project.id}
          initial={open.project}
          initialReport={open.report}
          health={health}
          onExit={() => {
            window.location.hash = '#/';
          }}
        />
      ) : (
        <Home
          health={health}
          onOpen={(project, report) => {
            setOpen({ project, report: report ?? null });
            window.location.hash = `#/p/${project.id}`;
          }}
        />
      )}
    </>
  );
}
