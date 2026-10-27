import type { ReactNode } from 'react';
import {
  addElement,
  createAnimation,
  createElement,
  deleteElement,
  moveElement,
  updateElement,
  updateScene,
  type ElementPatch,
} from '../../project/edit';
import {
  ANIMATION_TYPES,
  EASINGS,
  FONT_FAMILIES,
  TRANSITION_TYPES,
  type Animation,
  type Asset,
  type Background,
  type Brand,
  type Element,
  type ElementType,
  type Project,
  type Scene,
} from '../../project/schema';
import { ColorField, Field, NumberField, Section, SelectField, TextField, Toggle } from './fields';

type Edit = (fn: (p: Project) => Project, key?: string) => void;

const ELEMENT_LABELS: Record<ElementType, string> = {
  text: 'Text',
  shape: 'Shape',
  image: 'Image',
  logo: 'Logo',
  device: 'Screenshot',
  particles: 'Particles',
};

const FONT_OPTIONS = [
  { value: '@heading', label: 'Brand heading font' },
  { value: '@body', label: 'Brand body font' },
  ...FONT_FAMILIES.map((f) => ({ value: f, label: f })),
] as const;

export function elementLabel(el: Element): string {
  if (el.name) return el.name;
  if (el.type === 'text') return el.text.slice(0, 24);
  return ELEMENT_LABELS[el.type];
}

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------

function BackgroundEditor({ bg, brand, onChange }: { bg: Background; brand: Brand; onChange: (bg: Background, key: string) => void }) {
  const stops = bg.type === 'solid' ? null : bg.stops;
  return (
    <>
      <SelectField
        label="Background"
        value={bg.type}
        options={[
          { value: 'solid', label: 'Solid color' },
          { value: 'linear-gradient', label: 'Linear gradient' },
          { value: 'radial-gradient', label: 'Radial gradient' },
        ]}
        onChange={(type) => {
          const first = bg.type === 'solid' ? bg.color : bg.stops[0]!.color;
          const last = bg.type === 'solid' ? '@primary' : bg.stops[bg.stops.length - 1]!.color;
          const twoStops = [
            { offset: 0, color: first },
            { offset: 1, color: last },
          ];
          if (type === 'solid') onChange({ type, color: first }, 'bg-type');
          else if (type === 'linear-gradient') onChange({ type, angle: 135, stops: stops ?? twoStops, rotateSpeed: 0, vignette: 0 }, 'bg-type');
          else onChange({ type, cx: 0.5, cy: 0.5, stops: stops ?? twoStops, vignette: 0.3 }, 'bg-type');
        }}
      />
      {bg.type === 'solid' && <ColorField label="Color" value={bg.color} brand={brand} onChange={(c) => c && onChange({ ...bg, color: c }, 'bg-color')} />}
      {stops &&
        stops.map((s, i) => (
          <ColorField
            key={i}
            label={`Stop ${i + 1}`}
            value={s.color}
            brand={brand}
            onChange={(c) => c && onChange({ ...bg, stops: stops.map((x, j) => (j === i ? { ...x, color: c } : x)) } as Background, `bg-stop-${i}`)}
          />
        ))}
      {bg.type === 'linear-gradient' && (
        <>
          <NumberField label="Angle" value={bg.angle} min={-360} max={360} step={1} unit="°" onChange={(v) => onChange({ ...bg, angle: v }, 'bg-angle')} />
          <NumberField label="Rotate speed" value={bg.rotateSpeed} min={-90} max={90} step={1} unit="°/s" onChange={(v) => onChange({ ...bg, rotateSpeed: v }, 'bg-rot')} />
        </>
      )}
      {bg.type === 'radial-gradient' && (
        <>
          <NumberField label="Center X" value={bg.cx} min={0} max={1} scale={100} step={0.01} unit="%" onChange={(v) => onChange({ ...bg, cx: v }, 'bg-cx')} />
          <NumberField label="Center Y" value={bg.cy} min={0} max={1} scale={100} step={0.01} unit="%" onChange={(v) => onChange({ ...bg, cy: v }, 'bg-cy')} />
        </>
      )}
      {bg.type !== 'solid' && (
        <NumberField label="Vignette" value={bg.vignette} min={0} max={1} scale={100} step={0.01} unit="%" onChange={(v) => onChange({ ...bg, vignette: v } as Background, 'bg-vig')} />
      )}
    </>
  );
}

export function SceneInspector({ project, scene, index, edit, selectedElementId, onSelectElement, assets }: {
  project: Project;
  scene: Scene;
  index: number;
  edit: Edit;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  assets: Asset[];
}) {
  const set = (patch: Parameters<typeof updateScene>[2], key: string) => edit((p) => updateScene(p, scene.id, patch), `${scene.id}-${key}`);
  const add = (type: ElementType) => {
    const el = createElement(type, { assetId: type === 'image' ? assets[0]?.id : undefined });
    edit((p) => addElement(p, scene.id, el));
    onSelectElement(el.id);
  };
  return (
    <>
      <Section title="Scene">
        <TextField label="Name" value={scene.name} maxLength={80} onChange={(v) => set({ name: v }, 'name')} />
        <NumberField label="Duration" value={scene.duration} min={0.5} max={60} step={0.1} unit="s" onChange={(v) => set({ duration: v }, 'duration')} />
        {index > 0 && (
          <>
            <SelectField label="Transition in" value={scene.transition.type} options={TRANSITION_TYPES} onChange={(type) => set({ transition: { ...scene.transition, type, duration: type === 'none' ? 0 : scene.transition.duration || 0.5 } }, 'tr-type')} />
            {scene.transition.type !== 'none' && (
              <NumberField label="Transition length" value={scene.transition.duration} min={0.1} max={Math.min(5, scene.duration)} step={0.05} unit="s" onChange={(v) => set({ transition: { ...scene.transition, duration: v } }, 'tr-dur')} />
            )}
          </>
        )}
        <BackgroundEditor bg={scene.background} brand={project.brand} onChange={(background, key) => set({ background }, key)} />
      </Section>
      <Section
        title="Layers"
        actions={
          <select
            aria-label="Add layer"
            className="add-select"
            value=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value as ElementType);
            }}
          >
            <option value="">+ Add layer</option>
            {(Object.keys(ELEMENT_LABELS) as ElementType[]).map((t) => (
              <option key={t} value={t} disabled={t === 'image' && assets.length === 0}>
                {ELEMENT_LABELS[t]}
                {t === 'image' && assets.length === 0 ? ' (upload an image first)' : ''}
              </option>
            ))}
          </select>
        }
      >
        <ul className="layer-list">
          {[...scene.elements].reverse().map((el) => (
            <li key={el.id} className={el.id === selectedElementId ? 'selected' : ''}>
              <button className="layer-name" aria-label={`Select layer ${elementLabel(el)}`} onClick={() => onSelectElement(el.id)}>
                <span className={`badge badge-${el.type}`}>{ELEMENT_LABELS[el.type]}</span>
                {elementLabel(el)}
              </button>
              <span className="layer-actions">
                <button className="icon-btn" aria-label="Bring forward" title="Bring forward" onClick={() => edit((p) => moveElement(p, scene.id, el.id, 1))}>
                  ↑
                </button>
                <button className="icon-btn" aria-label="Send backward" title="Send backward" onClick={() => edit((p) => moveElement(p, scene.id, el.id, -1))}>
                  ↓
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={`Delete layer ${elementLabel(el)}`}
                  title="Delete"
                  onClick={() => {
                    edit((p) => deleteElement(p, scene.id, el.id));
                    if (el.id === selectedElementId) onSelectElement(null);
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
          {scene.elements.length === 0 && <li className="muted small">No layers. Add one above.</li>}
        </ul>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Element
// ---------------------------------------------------------------------------------------------

function AssetPicker({ label, value, assets, onChange, allowGenerated, generatedLabel }: { label: string; value: string | null; assets: Asset[]; onChange: (id: string | null) => void; allowGenerated?: boolean; generatedLabel?: string }) {
  return (
    <SelectField
      label={label}
      value={value ?? ''}
      options={[
        ...(allowGenerated ? [{ value: '', label: generatedLabel ?? 'None' }] : []),
        ...assets.map((a) => ({ value: a.id, label: a.name })),
      ]}
      onChange={(v) => onChange(v === '' ? null : v)}
    />
  );
}

function GlowEditor({ glow, brand, onChange }: { glow: { color: string; strength: number } | null; brand: Brand; onChange: (g: { color: string; strength: number } | null, key: string) => void }) {
  return (
    <>
      <Toggle label="Glow" checked={glow !== null} onChange={(on) => onChange(on ? { color: '@primary', strength: 0.6 } : null, 'glow-on')} />
      {glow && (
        <>
          <ColorField label="Glow color" value={glow.color} brand={brand} onChange={(c) => c && onChange({ ...glow, color: c }, 'glow-color')} />
          <NumberField label="Glow strength" value={glow.strength} min={0} max={1} scale={100} step={0.01} unit="%" onChange={(v) => onChange({ ...glow, strength: v }, 'glow-str')} />
        </>
      )}
    </>
  );
}

function TypeSpecific({ el, brand, assets, set }: { el: Element; brand: Brand; assets: Asset[]; set: (patch: ElementPatch, key: string) => void }) {
  switch (el.type) {
    case 'text':
      return (
        <>
          <TextField label="Text" multiline value={el.text} maxLength={500} onChange={(text) => set({ text }, 'text')} />
          <SelectField label="Font" value={el.font} options={FONT_OPTIONS} onChange={(font) => set({ font }, 'font')} />
          <SelectField label="Weight" value={el.weight} options={[400, 500, 600, 700, 800] as const} onChange={(weight) => set({ weight }, 'weight')} />
          <NumberField label="Size" value={el.size} min={0.005} max={0.5} step={0.001} scale={100} unit="% h" onChange={(size) => set({ size }, 'size')} />
          <ColorField label="Color" value={el.color} brand={brand} onChange={(c) => c && set({ color: c }, 'color')} />
          <SelectField label="Align" value={el.align} options={['left', 'center', 'right'] as const} onChange={(align) => set({ align }, 'align')} />
          <NumberField label="Letter spacing" value={el.letterSpacing} min={-0.2} max={2} step={0.01} unit="em" onChange={(letterSpacing) => set({ letterSpacing }, 'ls')} />
          <NumberField label="Line height" value={el.lineHeight} min={0.6} max={3} step={0.05} onChange={(lineHeight) => set({ lineHeight }, 'lh')} />
          <NumberField label="Wrap width" value={el.maxWidth} min={0.05} max={1} step={0.01} scale={100} unit="% w" onChange={(maxWidth) => set({ maxWidth }, 'mw')} />
          <Toggle label="Uppercase" checked={el.uppercase} onChange={(uppercase) => set({ uppercase }, 'upper')} />
          <GlowEditor glow={el.glow} brand={brand} onChange={(glow, k) => set({ glow }, k)} />
        </>
      );
    case 'shape':
      return (
        <>
          <SelectField label="Shape" value={el.shape} options={['rect', 'ellipse'] as const} onChange={(shape) => set({ shape }, 'shape')} />
          <NumberField label="Width" value={el.width} min={0} max={3} scale={100} step={0.005} unit="% w" onChange={(width) => set({ width }, 'w')} />
          <NumberField label="Height" value={el.height} min={0} max={3} scale={100} step={0.005} unit="% h" onChange={(height) => set({ height }, 'h')} />
          <ColorField label="Fill" value={el.fill} brand={brand} allowNone onChange={(fill) => set({ fill }, 'fill')} />
          <ColorField label="Stroke" value={el.stroke} brand={brand} allowNone onChange={(stroke) => set({ stroke }, 'stroke')} />
          <NumberField label="Stroke width" value={el.strokeWidth} min={0} max={0.1} scale={100} step={0.001} unit="% h" onChange={(strokeWidth) => set({ strokeWidth }, 'sw')} />
          {el.shape === 'rect' && <NumberField label="Corner radius" value={el.cornerRadius} min={0} max={1} scale={100} step={0.005} unit="% h" onChange={(cornerRadius) => set({ cornerRadius }, 'cr')} />}
          <GlowEditor glow={el.glow} brand={brand} onChange={(glow, k) => set({ glow }, k)} />
        </>
      );
    case 'image':
      return (
        <>
          <AssetPicker label="Image" value={el.assetId} assets={assets} onChange={(id) => id && set({ assetId: id }, 'asset')} />
          <NumberField label="Width" value={el.width} min={0.01} max={3} scale={100} step={0.005} unit="% w" onChange={(width) => set({ width }, 'w')} />
          <NumberField label="Corner radius" value={el.cornerRadius} min={0} max={1} scale={100} step={0.005} unit="% h" onChange={(cornerRadius) => set({ cornerRadius }, 'cr')} />
          <Toggle label="Drop shadow" checked={el.shadow} onChange={(shadow) => set({ shadow }, 'shadow')} />
        </>
      );
    case 'logo':
      return (
        <>
          <AssetPicker label="Logo image" value={el.assetId} assets={assets} allowGenerated generatedLabel="Generated mark" onChange={(assetId) => set({ assetId }, 'asset')} />
          {!el.assetId && <TextField label="Wordmark" value={el.wordmark} maxLength={60} onChange={(wordmark) => set({ wordmark }, 'wordmark')} />}
          <NumberField label="Size" value={el.size} min={0.01} max={1} scale={100} step={0.005} unit="% h" onChange={(size) => set({ size }, 'size')} />
          {!el.assetId && (
            <>
              <ColorField label="Mark color" value={el.markColor} brand={brand} onChange={(c) => c && set({ markColor: c }, 'mark')} />
              <ColorField label="Text color" value={el.color} brand={brand} onChange={(c) => c && set({ color: c }, 'color')} />
              <SelectField label="Font" value={el.font} options={FONT_OPTIONS} onChange={(font) => set({ font }, 'font')} />
            </>
          )}
          <GlowEditor glow={el.glow} brand={brand} onChange={(glow, k) => set({ glow }, k)} />
        </>
      );
    case 'device':
      return (
        <>
          <AssetPicker label="Screenshot" value={el.assetId} assets={assets} allowGenerated generatedLabel="Placeholder UI" onChange={(assetId) => set({ assetId }, 'asset')} />
          <SelectField label="Frame" value={el.frame} options={['browser', 'phone', 'none'] as const} onChange={(frame) => set({ frame }, 'frame')} />
          <NumberField label="Width" value={el.width} min={0.05} max={2} scale={100} step={0.005} unit="% w" onChange={(width) => set({ width }, 'w')} />
          <ColorField label="Accent" value={el.accent} brand={brand} onChange={(c) => c && set({ accent: c }, 'accent')} />
          <Toggle label="Drop shadow" checked={el.shadow} onChange={(shadow) => set({ shadow }, 'shadow')} />
        </>
      );
    case 'particles':
      return (
        <>
          <NumberField label="Count" value={el.count} min={1} max={400} step={1} onChange={(count) => set({ count: Math.round(count) }, 'count')} />
          <ColorField label="Color" value={el.color} brand={brand} onChange={(c) => c && set({ color: c }, 'color')} />
          <NumberField label="Size" value={el.size} min={0.0005} max={0.05} step={0.0005} scale={100} unit="% h" onChange={(size) => set({ size }, 'size')} />
          <NumberField label="Speed" value={el.speed} min={0} max={2} step={0.005} onChange={(speed) => set({ speed }, 'speed')} />
          <NumberField label="Seed" value={el.seed} min={0} max={99999} step={1} slider={false} onChange={(seed) => set({ seed: Math.round(seed) }, 'seed')} />
        </>
      );
  }
}

function AnimationEditor({ anim, onChange, onRemove, textOnlyAllowed }: { anim: Animation; onChange: (a: Animation, key: string) => void; onRemove: () => void; textOnlyAllowed: boolean }) {
  const setField = <K extends string>(k: K, v: unknown) => onChange({ ...anim, [k]: v } as Animation, k);
  const types = ANIMATION_TYPES.filter((t) => textOnlyAllowed || (t !== 'typewriter' && t !== 'tracking-in'));
  let fields: ReactNode = null;
  if ('duration' in anim) {
    fields = (
      <>
        <SelectField label="Anchor" value={anim.anchor} options={[{ value: 'start', label: 'From element start' }, { value: 'end', label: 'Before element end' }]} onChange={(v) => setField('anchor', v)} />
        <NumberField label="Delay" value={anim.delay} min={0} max={60} step={0.05} unit="s" onChange={(v) => setField('delay', v)} />
        <NumberField label="Duration" value={anim.duration} min={0.05} max={60} step={0.05} unit="s" onChange={(v) => setField('duration', v)} />
        <SelectField label="Easing" value={anim.easing} options={EASINGS} onChange={(v) => setField('easing', v)} />
      </>
    );
  }
  return (
    <div className="anim-card">
      <div className="anim-head">
        <select aria-label="Animation type" value={anim.type} onChange={(e) => onChange(createAnimation(e.target.value as Animation['type']), 'type')}>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="icon-btn danger" aria-label={`Remove ${anim.type} animation`} onClick={onRemove}>
          ✕
        </button>
      </div>
      {fields}
      {(anim.type === 'slide-in' || anim.type === 'slide-out') && (
        <>
          <SelectField label="Direction" value={anim.direction} options={['left', 'right', 'up', 'down'] as const} onChange={(v) => setField('direction', v)} />
          <NumberField label="Distance" value={anim.distance} min={0} max={2} scale={100} step={0.005} unit="%" onChange={(v) => setField('distance', v)} />
        </>
      )}
      {(anim.type === 'scale-in' || anim.type === 'zoom' || anim.type === 'tracking-in') && (
        <NumberField label="From" value={anim.from} min={0} max={anim.type === 'tracking-in' ? 2 : 10} step={0.01} onChange={(v) => setField('from', v)} />
      )}
      {anim.type === 'rotate-in' && <NumberField label="From angle" value={anim.from} min={-720} max={720} step={1} unit="°" onChange={(v) => setField('from', v)} />}
      {(anim.type === 'scale-out' || anim.type === 'zoom') && <NumberField label="To" value={anim.to} min={0} max={10} step={0.01} onChange={(v) => setField('to', v)} />}
      {anim.type === 'float' && (
        <>
          <NumberField label="Amplitude" value={anim.amplitude} min={0} max={0.5} scale={100} step={0.001} unit="% h" onChange={(v) => setField('amplitude', v)} />
          <NumberField label="Period" value={anim.period} min={0.1} max={60} step={0.1} unit="s" onChange={(v) => setField('period', v)} />
        </>
      )}
      {anim.type === 'pulse' && (
        <>
          <NumberField label="Amount" value={anim.amount} min={0} max={1} scale={100} step={0.005} unit="%" onChange={(v) => setField('amount', v)} />
          <NumberField label="Period" value={anim.period} min={0.1} max={60} step={0.1} unit="s" onChange={(v) => setField('period', v)} />
        </>
      )}
      {anim.type === 'spin' && <NumberField label="Speed" value={anim.speed} min={-720} max={720} step={1} unit="°/s" onChange={(v) => setField('speed', v)} />}
    </div>
  );
}

export function ElementInspector({ project, scene, element, edit }: { project: Project; scene: Scene; element: Element; edit: Edit }) {
  const set = (patch: ElementPatch, key: string) => edit((p) => updateElement(p, scene.id, element.id, patch), `${element.id}-${key}`);
  const setAnimations = (animations: Animation[], key: string) => set({ animations }, `anim-${key}`);
  return (
    <>
      <Section title={`${ELEMENT_LABELS[element.type]} layer`}>
        <TextField label="Layer name" value={element.name ?? ''} maxLength={80} onChange={(name) => set({ name }, 'name')} />
        <TypeSpecific el={element} brand={project.brand} assets={project.assets} set={set} />
      </Section>
      <Section title="Transform & timing">
        <NumberField label="X" value={element.x} min={-1} max={2} scale={100} step={0.001} unit="%" onChange={(x) => set({ x }, 'x')} />
        <NumberField label="Y" value={element.y} min={-1} max={2} scale={100} step={0.001} unit="%" onChange={(y) => set({ y }, 'y')} />
        <NumberField label="Scale" value={element.scale} min={0} max={10} step={0.01} onChange={(scale) => set({ scale }, 'scale')} />
        <NumberField label="Rotation" value={element.rotation} min={-360} max={360} step={1} unit="°" onChange={(rotation) => set({ rotation }, 'rot')} />
        <NumberField label="Opacity" value={element.opacity} min={0} max={1} scale={100} step={0.01} unit="%" onChange={(opacity) => set({ opacity }, 'op')} />
        <NumberField label="Start" value={element.start} min={0} max={scene.duration - 0.05} step={0.05} unit="s" onChange={(start) => set({ start }, 'start')} />
        <Field label="End">
          <div className="inline">
            <Toggle label="Scene end" checked={element.end === null} onChange={(on) => set({ end: on ? null : scene.duration }, 'end-on')} />
            {element.end !== null && (
              <input
                type="number"
                aria-label="End value"
                value={element.end}
                min={element.start + 0.05}
                max={scene.duration}
                step={0.05}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) set({ end: Math.min(scene.duration, Math.max(element.start + 0.05, v)) }, 'end');
                }}
              />
            )}
          </div>
        </Field>
      </Section>
      <Section
        title="Animations"
        actions={
          <select
            aria-label="Add animation"
            className="add-select"
            value=""
            onChange={(e) => {
              if (e.target.value) setAnimations([...element.animations, createAnimation(e.target.value as Animation['type'])], `add-${Date.now()}`);
            }}
          >
            <option value="">+ Add animation</option>
            {ANIMATION_TYPES.filter((t) => element.type === 'text' || (t !== 'typewriter' && t !== 'tracking-in')).map((t) => (
              <option key={t} value={t} disabled={element.animations.length >= 8}>
                {t}
              </option>
            ))}
          </select>
        }
      >
        {element.animations.length === 0 && <p className="muted small">No animations.</p>}
        {element.animations.map((a, i) => (
          <AnimationEditor
            key={i}
            anim={a}
            textOnlyAllowed={element.type === 'text'}
            onChange={(next, key) => setAnimations(element.animations.map((x, j) => (j === i ? next : x)), `${i}-${key}`)}
            onRemove={() => setAnimations(element.animations.filter((_, j) => j !== i), `rm-${Date.now()}`)}
          />
        ))}
      </Section>
    </>
  );
}
