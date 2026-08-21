import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
}

export function Field({ label, children, hint }: FieldProps) {
  return (
    <div className="field">
      <label>
        {label}
        {hint ? <span style={{ color: 'var(--text-faint)' }}> — {hint}</span> : null}
      </label>
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
