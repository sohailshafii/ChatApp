import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { signupRequestSchema } from '@chatapp/shared';
import { ApiError } from '../api/client';
import { signup } from '../api/auth';
import { Field } from '../components/Field';

type FieldName = 'username' | 'email' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_NAMES: readonly FieldName[] = ['username', 'email', 'password'];

function isFieldName(value: unknown): value is FieldName {
  return typeof value === 'string' && (FIELD_NAMES as readonly string[]).includes(value);
}

export function SignupPage() {
  const [values, setValues] = useState<Record<FieldName, string>>({
    username: '',
    email: '',
    password: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  function update(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setAgeError(null);

    const parsed = signupRequestSchema.safeParse(values);
    // Age attestation (REQUIREMENTS.md §6: min age 13). Gated client-side only;
    // it is not part of signupRequestSchema and is not sent to the server.
    const ageOk = ageConfirmed;

    if (!parsed.success || !ageOk) {
      if (!parsed.success) {
        const next: FieldErrors = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path[0];
          if (isFieldName(key) && next[key] === undefined) {
            next[key] = issue.message;
          }
        }
        setFieldErrors(next);
      }
      if (!ageOk) {
        setAgeError('You must confirm you are at least 13 years old.');
      }
      return;
    }

    setSubmitting(true);
    try {
      await signup(parsed.data);
      setSubmittedEmail(parsed.data.email);
    } catch (err) {
      applySubmitError(err, setFieldErrors, setFormError);
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedEmail) {
    return (
      <section className="page" aria-labelledby="signup-success-heading">
        <h1 id="signup-success-heading">Check your email</h1>
        <p>
          We sent a verification link to <strong>{submittedEmail}</strong>. Open
          it to activate your account — the link expires in 24 hours.
        </p>
        <p>
          Didn’t get it? Check your spam folder, or{' '}
          <Link to="/verify-email/resend">request a new link</Link>.
        </p>
      </section>
    );
  }

  return (
    <section className="page" aria-labelledby="signup-heading">
      <h1 id="signup-heading">Create your account</h1>

      <form className="form" onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <Field
          id="username"
          label="Username"
          autoComplete="username"
          value={values.username}
          error={fieldErrors.username}
          onChange={(v) => update('username', v)}
          hint="3–30 characters: letters, numbers, underscore, or hyphen."
        />
        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={values.email}
          error={fieldErrors.email}
          onChange={(v) => update('email', v)}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={values.password}
          error={fieldErrors.password}
          onChange={(v) => update('password', v)}
          hint="At least 8 characters."
        />

        <div className="field-checkbox">
          <label>
            <input
              type="checkbox"
              checked={ageConfirmed}
              aria-invalid={ageError ? true : undefined}
              aria-describedby={ageError ? 'age-error' : undefined}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
            />
            I confirm that I am at least 13 years old.
          </label>
          {ageError && (
            <span id="age-error" className="field-error" role="alert">
              {ageError}
            </span>
          )}
        </div>

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </section>
  );
}

function applySubmitError(
  err: unknown,
  setFieldErrors: (errors: FieldErrors) => void,
  setFormError: (message: string) => void,
) {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'username_taken':
        setFieldErrors({ username: 'That username is already taken.' });
        return;
      case 'email_taken':
        setFieldErrors({ email: 'An account with this email already exists.' });
        return;
      case 'rate_limited':
        setFormError('Too many attempts. Please wait a moment and try again.');
        return;
      case 'validation_error':
        setFormError('Please check your details and try again.');
        return;
      case 'network_error':
        setFormError('Couldn’t reach the server. Check your connection and try again.');
        return;
    }
  }
  setFormError('Something went wrong. Please try again.');
}
