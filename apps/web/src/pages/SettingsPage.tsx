import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deleteAccount } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { Field } from '../components/Field';

// Account settings (§6). For now: account summary + the delete-account danger
// zone (re-enter password, immediate hard delete). Data export will follow.
export function SettingsPage() {
  const { user, clearSession } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }

    setDeleting(true);
    try {
      await deleteAccount(password);
      // The server has destroyed the session; drop local state without a
      // doomed /auth/logout and send the (now account-less) visitor to login.
      clearSession();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(deleteErrorMessage(err));
      setDeleting(false);
    }
  }

  return (
    <section className="page" aria-labelledby="settings-heading">
      <h1 id="settings-heading">Account settings</h1>

      {user && (
        <dl className="account-summary">
          <dt>Username</dt>
          <dd>{user.username}</dd>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </dl>
      )}

      <section className="danger-zone" aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete account</h2>
        <p>
          This permanently deletes your account. Your messages to other people
          stay in their conversations but show as “Deleted user”; your
          conversations with bots, your sessions, and notification subscriptions
          are removed. <strong>This cannot be undone.</strong>
        </p>

        <form className="form" onSubmit={handleDelete} noValidate>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <Field
            id="current-password"
            label="Confirm your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I understand this permanently deletes my account.
          </label>

          <button
            type="submit"
            className="btn-danger"
            disabled={deleting || !acknowledged}
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </form>
      </section>
    </section>
  );
}

function deleteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return 'That password is incorrect.';
      case 'validation_error':
        return 'Enter your password to confirm.';
      case 'rate_limited':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'network_error':
        return 'Couldn’t reach the server. Check your connection and try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}
