// Labeled text input with hint + error wiring, shared across auth forms.
// Associates label, hint, and error to the input for screen readers
// (aria-describedby / aria-invalid) per WCAG 2.1 AA.
export interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  // Mobile keyboards capitalize/autocorrect by default, which is wrong for
  // identifiers like usernames and emails — callers opt out via these.
  autoCapitalize?: string;
  autoCorrect?: string;
  spellCheck?: boolean;
}

export function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete,
  autoCapitalize,
  autoCorrect,
  spellCheck,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
