import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { resendVerificationRequestSchema } from '@chatapp/shared';
import { ApiError } from '../api/client';
import { resendVerification } from '../api/auth';
import { Field } from '../components/Field';

// Request a fresh verification email (§1). Reachable from signup's
// "check your email" state and the login "unverified" notice.
export function ResendVerificationPage() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(undefined);
    setFormError(null);

    const parsed = resendVerificationRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      await resendVerification(parsed.data.email);
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
    // Generic confirmation — does not reveal whether the address has a pending
    // account (avoids account enumeration).
    return (
      <section className="page" aria-labelledby="resend-heading">
        <h1 id="resend-heading">Check your email</h1>
        <p>
          If that address has an account awaiting verification, a new link is on
          its way. The link expires in 24 hours.
        </p>
        <p>
          <Link to="/login">Back to log in</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="page" aria-labelledby="resend-heading">
      <h1 id="resend-heading">Resend verification email</h1>
      <p>Enter your email and we’ll send a fresh verification link.</p>

      <form className="form" onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}

        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          error={fieldError}
          onChange={setEmail}
        />

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Sending…' : 'Send link'}
        </button>
      </form>

      <p>
        <Link to="/login">Back to log in</Link>
      </p>
    </section>
  );
}
