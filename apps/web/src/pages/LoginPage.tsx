import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loginRequestSchema } from '@chatapp/shared';
import { ApiError } from '../api/client';
import { login } from '../api/auth';
import { Field } from '../components/Field';
import { useAuth } from '../auth/AuthContext';

type FieldName = 'username' | 'password';
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_NAMES: readonly FieldName[] = ['username', 'password'];

function isFieldName(value: unknown): value is FieldName {
  return typeof value === 'string' && (FIELD_NAMES as readonly string[]).includes(value);
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  // Where to land after login: the page the user was sent here from, or home.
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [values, setValues] = useState<Record<FieldName, string>>({
    username: '',
    password: '',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function update(field: FieldName, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setUnverified(false);

    const parsed = loginRequestSchema.safeParse(values);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (isFieldName(key) && next[key] === undefined) {
          next[key] = issue.message;
        }
      }
      setFieldErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const { user } = await login(parsed.data);
      setUser(user);
      navigate(from, { replace: true });
    } catch (err) {
      applyLoginError(err, setFormError, setUnverified);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page" aria-labelledby="login-heading">
      <h1 id="login-heading">Log in</h1>

      <form className="form" onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        {unverified && (
          <p className="form-error" role="alert">
            Your email isn’t verified yet. Check your inbox, or{' '}
            <Link to="/verify-email/resend">request a new link</Link>.
          </p>
        )}

        <Field
          id="username"
          label="Username"
          autoComplete="username"
          value={values.username}
          error={fieldErrors.username}
          onChange={(v) => update('username', v)}
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          error={fieldErrors.password}
          onChange={(v) => update('password', v)}
        />

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p>
        <Link to="/password-reset">Forgot your password?</Link>
      </p>
      <p>
        Need an account? <Link to="/signup">Sign up</Link>
      </p>
    </section>
  );
}

function applyLoginError(
  err: unknown,
  setFormError: (message: string) => void,
  setUnverified: (value: boolean) => void,
) {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        // Generic message — don't reveal whether the username exists.
        setFormError('Incorrect username or password.');
        return;
      case 'unverified':
        setUnverified(true);
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
