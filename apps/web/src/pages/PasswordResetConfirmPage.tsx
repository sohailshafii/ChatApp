import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { passwordResetConfirmSchema } from '@chatapp/shared';
import { ApiError } from '../api/client';
import { confirmPasswordReset } from '../api/auth';
import { Field } from '../components/Field';

// Step 2 of password reset (§1): set a new password from the emailed link
// (/password-reset/confirm?token=…). Completing it invalidates all sessions.
export function PasswordResetConfirmPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(undefined);
    setConfirmError(undefined);
    setFormError(null);

    const parsed = passwordResetConfirmSchema.safeParse({ token, newPassword });
    if (!parsed.success) {
      // The token comes from the URL; a token issue here means a malformed link.
      const tokenIssue = parsed.error.issues.find((i) => i.path[0] === 'token');
      const passwordIssue = parsed.error.issues.find((i) => i.path[0] === 'newPassword');
      if (passwordIssue) setPasswordError(passwordIssue.message);
      if (tokenIssue) {
        setFormError('This reset link is invalid or incomplete.');
      }
      if (!tokenIssue && !passwordIssue) return;
    }

    if (newPassword !== confirmPassword) {
      setConfirmError('Passwords don’t match.');
      return;
    }
    if (!parsed.success) return;

    setSubmitting(true);
    try {
      await confirmPasswordReset(parsed.data.token, parsed.data.newPassword);
      setDone(true);
    } catch (err) {
      setFormError(confirmErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <section className="page" aria-labelledby="reset-confirm-heading">
        <h1 id="reset-confirm-heading">Password updated</h1>
        <p>
          Your password has been changed and you’ve been signed out everywhere.
          Log in with your new password.
        </p>
        <p>
          <Link to="/login">Log in</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="page" aria-labelledby="reset-confirm-heading">
      <h1 id="reset-confirm-heading">Choose a new password</h1>

      <form className="form" onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="form-error" role="alert">
            {formError}{' '}
            <Link to="/password-reset">Request a new reset link</Link>.
          </p>
        )}

        <Field
          id="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          error={passwordError}
          onChange={setNewPassword}
          hint="At least 8 characters."
        />
        <Field
          id="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          error={confirmError}
          onChange={setConfirmPassword}
        />

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </section>
  );
}

function confirmErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_token':
      case 'expired_token':
        return 'This reset link is invalid or has expired.';
      case 'rate_limited':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'network_error':
        return 'Couldn’t reach the server. Check your connection and try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}
