import { useState } from 'react';

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}

/** Chip-style editor for tags, style keywords and component lists. */
export function ListEditor({ values, onChange, placeholder, suggestions = [] }: Props) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const value = raw.trim().replace(/,+$/, '');
    if (!value) return;
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) return;
    onChange([...values, value]);
  };

  const remove = (value: string) => onChange(values.filter((v) => v !== value));

  const unused = suggestions.filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="field">
      <div className="list-editor">
        {values.map((value) => (
          <span className="chip" key={value}>
            {value}
            <button type="button" onClick={() => remove(value)} aria-label={`Remove ${value}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={values.length ? '' : placeholder}
          onChange={(e) => {
            // Typing or pasting a comma commits the value — quick bulk entry.
            if (e.target.value.includes(',')) {
              e.target.value.split(',').forEach(add);
              setDraft('');
            } else {
              setDraft(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
              setDraft('');
            } else if (e.key === 'Backspace' && !draft && values.length) {
              remove(values[values.length - 1]);
            }
          }}
          onBlur={() => {
            add(draft);
            setDraft('');
          }}
        />
      </div>
      {unused.length > 0 && (
        <div className="suggestions">
          {unused.slice(0, 12).map((s) => (
            <button type="button" key={s} onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
