import { cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
}

export function Field({ label, children, hint }: FieldProps) {
  // The control is a sibling of the label, not a child, so the association has
  // to be made explicitly — otherwise a screen reader announces an unnamed
  // input and clicking the label does nothing. Some fields hold a group of
  // controls or a read-only table rather than one input; <label> cannot name
  // those, so they become a labelled group instead.
  const id = useId();
  // Only a real control can carry the id a <label> points at. A component —
  // ListEditor, a readout table — swallows the prop, leaving a label pointing
  // at nothing, which is worse than no label at all.
  const single =
    isValidElement(children) &&
    typeof children.type === 'string' &&
    ['input', 'textarea', 'select'].includes(children.type);
  const text = (
    <>
      {label}
      {hint ? <span style={{ color: 'var(--text-faint)' }}> — {hint}</span> : null}
    </>
  );
  if (single) {
    return (
      <div className="field">
        <label htmlFor={id}>{text}</label>
        {cloneElement(children as ReactElement<{ id?: string }>, { id })}
      </div>
    );
  }
  return (
    <div className="field" role="group" aria-labelledby={`${id}-label`}>
      <span className="field-label" id={`${id}-label`}>
        {text}
      </span>
      {children}
    </div>
  );
}

interface TextProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  list?: string;
}

export function TextField({ label, value, onChange, placeholder, list }: TextProps) {
  return (
    <Field label={label}>
      <input
        value={value}
        list={list}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: TextProps & { rows?: number }) {
  return (
    <Field label={label}>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function Section({
  title,
  children,
  defaultOpen = false,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  return (
    <details className="spec-section" open={defaultOpen}>
      <summary>
        {title}
        {badge ? <span className="chip">{badge}</span> : null}
      </summary>
      <div className="spec-section-content">{children}</div>
    </details>
  );
}

/**
 * How much of a spec section somebody has actually filled in.
 *
 * The app is careful not to guess what a bitmap cannot hold — font families,
 * component inventories, interaction notes — and leaves those blank on
 * purpose. But a blank field and a recorded one looked identical in the
 * drawer, so a spec with two of nine fields written read as a full one, and
 * the gap only showed up in the export, where empty fields are dropped.
 *
 * Strings are the fields. A list counts as one field, filled when it has
 * anything in it: counting a type scale's thirty-five inputs individually
 * would drown the figure that matters.
 */
export function recorded(value: unknown): { filled: number; total: number } {
  if (typeof value === 'string') {
    return { filled: value.trim() ? 1 : 0, total: 1 };
  }
  if (Array.isArray(value)) {
    return { filled: value.length ? 1 : 0, total: 1 };
  }
  if (value && typeof value === 'object') {
    let filled = 0;
    let total = 0;
    for (const inner of Object.values(value)) {
      const count = recorded(inner);
      filled += count.filled;
      total += count.total;
    }
    return { filled, total };
  }
  return { filled: 0, total: 0 };
}

/** "4 of 9 recorded", or nothing at all when a section has no fields to count. */
export function recordedLabel(value: unknown): string | undefined {
  const { filled, total } = recorded(value);
  if (!total) return undefined;
  return `${filled} of ${total} recorded`;
}
