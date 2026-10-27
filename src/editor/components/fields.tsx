import { useEffect, useState, type ReactNode } from 'react';
import { BRAND_TOKENS, type Brand } from '../../project/schema';
import { resolveColor } from '../../project/colors';

/** A labelled row. Controls inside carry their own aria-label, so this label is visual only. */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <span className="field-label" title={hint}>
        {label}
      </span>
      <div className="field-control">{children}</div>
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-section">
      <header>
        <h3>{title}</h3>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

interface NumberProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Display multiplier, e.g. 100 to edit fractions as percentages. */
  scale?: number;
  unit?: string;
  slider?: boolean;
  hint?: string;
}

/** Numeric input that only commits finite, in-range values; the text box may be mid-edit. */
export function NumberField({ label, value, onChange, min, max, step = 0.01, scale = 1, unit, slider = true, hint }: NumberProps) {
  const display = +(value * scale).toFixed(4);
  const [text, setText] = useState(String(display));
  useEffect(() => setText(String(display)), [display]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return;
    onChange(Math.min(max, Math.max(min, n / scale)));
  };
  return (
    <Field label={label} hint={hint}>
      <div className="number-field">
        {slider && (
          <input
            type="range"
            aria-label={label}
            min={min * scale}
            max={max * scale}
            step={step * scale}
            value={display}
            onChange={(e) => commit(e.target.value)}
          />
        )}
        <input
          type="number"
          aria-label={`${label} value`}
          value={text}
          step={step * scale}
          min={min * scale}
          max={max * scale}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(String(display))}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </Field>
  );
}

export function TextField({ label, value, onChange, multiline, maxLength }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; maxLength?: number }) {
  return (
    <Field label={label}>
      {multiline ? (
        <textarea aria-label={label} value={value} maxLength={maxLength} rows={3} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" aria-label={label} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }> | readonly T[];
  onChange: (v: T) => void;
}) {
  const opts = (options as ReadonlyArray<T | { value: T; label: string }>).map((o) =>
    typeof o === 'object' ? o : { value: o, label: String(o) },
  );
  return (
    <Field label={label}>
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const found = opts.find((o) => String(o.value) === e.target.value);
          if (found) onChange(found.value);
        }}
      >
        {opts.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const TOKEN_LABEL: Record<string, string> = {
  primary: 'Brand primary',
  secondary: 'Brand secondary',
  accent: 'Brand accent',
  background: 'Brand background',
  text: 'Brand text',
};

/** Color picker that can either reference a brand token or hold a literal hex color. */
export function ColorField({ label, value, brand, onChange, allowNone }: { label: string; value: string | null; brand: Brand; onChange: (v: string | null) => void; allowNone?: boolean }) {
  const isToken = value?.startsWith('@') ?? false;
  const resolved = value ? resolveColor(value, brand).slice(0, 7) : '#000000';
  return (
    <Field label={label}>
      <div className="color-field">
        <input
          type="color"
          aria-label={`${label} color`}
          value={resolved}
          disabled={value === null}
          onChange={(e) => onChange(e.target.value)}
        />
        <select
          aria-label={`${label} source`}
          value={value === null ? 'none' : isToken ? value : 'custom'}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'none') onChange(null);
            else if (v === 'custom') onChange(resolved);
            else onChange(v);
          }}
        >
          {allowNone && <option value="none">None</option>}
          {BRAND_TOKENS.map((t) => (
            <option key={t} value={`@${t}`}>
              {TOKEN_LABEL[t]}
            </option>
          ))}
          <option value="custom">Custom {isToken || value === null ? '' : value}</option>
        </select>
      </div>
    </Field>
  );
}
