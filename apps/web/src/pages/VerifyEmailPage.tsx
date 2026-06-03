import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verifyEmailRequestSchema } from '@chatapp/shared';
import { ApiError } from '../api/client';
import { verifyEmail } from '../api/auth';

type Status = 'verifying' | 'success' | 'error';

// Landing page for the emailed verification link (/verify-email?token=…, §1).
// Consumes the token automatically on load and reports the outcome.
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMessage, setErrorMessage] = useState('');
  // The token is single-use, so guard against the double-invoke of effects
  // under React StrictMode — we must POST exactly once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const parsed = verifyEmailRequestSchema.safeParse({ token });
    if (!parsed.success) {
      setStatus('error');
      setErrorMessage('This verification link is invalid or incomplete.');
      return;
    }

    verifyEmail(parsed.data.token)
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setErrorMessage(verifyErrorMessage(err));
      });
  }, [token]);

  if (status === 'verifying') {
    return (
      <section className="page" aria-labelledby="verify-heading">
        <h1 id="verify-heading">Verifying your email…</h1>
        <p className="loading" role="status">
          One moment.
        </p>
      </section>
    );
  }

  if (status === 'success') {
    return (
      <section className="page" aria-labelledby="verify-heading">
        <h1 id="verify-heading">Email verified</h1>
        <p>Your account is now active. You can log in.</p>
        <p>
          <Link to="/login">Log in</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="page" aria-labelledby="verify-heading">
      <h1 id="verify-heading">Couldn’t verify your email</h1>
      <p className="form-error" role="alert">
        {errorMessage}
      </p>
      <p>
        <Link to="/verify-email/resend">Request a new verification link</Link>.
      </p>
    </section>
  );
}

function verifyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_token':
      case 'expired_token':
        return 'This verification link is invalid or has expired.';
      case 'rate_limited':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'network_error':
        return 'Couldn’t reach the server. Check your connection and try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}
