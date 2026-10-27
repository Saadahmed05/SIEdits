/** Transport controls and a scene strip with transitions and a draggable playhead. */
import { useMemo, useRef } from 'react';
import { sceneSpans, totalDuration } from '../../engine/timeline';
import type { Project } from '../../project/schema';
import { formatTime } from './Preview';

interface Props {
  project: Project;
  time: number;
  playing: boolean;
  selectedSceneId: string | null;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onSelectScene: (id: string) => void;
}

export function Timeline({ project, time, playing, selectedSceneId, onSeek, onTogglePlay, onSelectScene }: Props) {
  const spans = useMemo(() => sceneSpans(project.scenes), [project.scenes]);
  const duration = totalDuration(project.scenes);
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(t / duration) * 100}%`;

  const seekFromEvent = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    onSeek(Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration)));
  };

  return (
    <div className="timeline">
      <div className="transport">
        <button className="icon-btn" onClick={() => onSeek(0)} aria-label="Go to start" title="Go to start">
          ⏮
        </button>
        <button className="play-btn" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play/Pause (Space)">
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="timecode" data-testid="timecode">
          {formatTime(time)} <span className="muted">/ {formatTime(duration)}</span>
        </span>
        <span className="muted small">
          {project.settings.width}×{project.settings.height} · {project.settings.fps} fps
        </span>
      </div>
      <div
        className="track"
        ref={trackRef}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromEvent(e.clientX);
        }}
      >
        {spans.map((span) => (
          <div
            key={span.scene.id}
            className={`track-scene ${span.scene.id === selectedSceneId ? 'selected' : ''}`}
            style={{ left: pct(span.start), width: pct(span.end - span.start) }}
            onDoubleClick={() => onSelectScene(span.scene.id)}
            title={`${span.scene.name} — ${span.scene.duration}s`}
          >
            {span.transitionIn > 0 && <div className="track-transition" style={{ width: `${(span.transitionIn / span.scene.duration) * 100}%` }} />}
            <span>{span.scene.name}</span>
          </div>
        ))}
        <div className="playhead" style={{ left: pct(Math.min(time, duration)) }} />
      </div>
    </div>
  );
}
