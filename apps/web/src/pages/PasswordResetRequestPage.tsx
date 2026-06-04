import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { passwordResetRequestSchema } from '@chatapp/shared';
import { ApiError } from '../api/client';
import { requestPasswordReset } from '../api/auth';
import { Field } from '../components/Field';

// Step 1 of password reset (§1): request a reset link by username or email.
export function PasswordResetRequestPage() {
  const [identifier, setIdentifier] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(undefined);
    setFormError(null);

    const parsed = passwordResetRequestSchema.safeParse({ identifier });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter your username or email.');
      return;
    }

    setSubmitting(true);
    try {
      await requestPasswordReset(parsed.data.identifier);
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'rate_limited') {
        setFormError('Too many attempts. Please wait a moment and try again.');
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    // Generic confirmation — does not reveal whether the account exists.
    return (
      <section className="page" aria-labelledby="reset-heading">
        <h1 id="reset-heading">Check your email</h1>
        <p>
          If an account matches what you entered, we’ve sent a link to reset your
          password. The link expires in 1 hour.
        </p>
        <p>
          <Link to="/login">Back to log in</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="page" aria-labelledby="reset-heading">
      <h1 id="reset-heading">Reset your password</h1>
      <p>Enter your username or email and we’ll send you a reset link.</p>

      <form className="form" onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <Field
          id="identifier"
          label="Username or email"
          autoComplete="username"
          value={identifier}
          error={fieldError}
          onChange={setIdentifier}
        />

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p>
        <Link to="/login">Back to log in</Link>
      </p>
    </section>
  );
}
