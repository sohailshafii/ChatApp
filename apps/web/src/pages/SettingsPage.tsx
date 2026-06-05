import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deleteAccount, requestDataExport } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { Field } from '../components/Field';

// Account settings (§6): account summary, data export, and the delete-account
// danger zone (re-enter password, immediate hard delete).
export function SettingsPage() {
  const { user, clearSession } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Data export is fire-and-forget: a request, then "check your email".
  type ExportState = 'idle' | 'requesting' | 'requested' | 'error';
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    if (exportState === 'requesting') return;
    setExportState('requesting');
    setExportError(null);
    try {
      await requestDataExport();
      setExportState('requested');
    } catch (err) {
      setExportError(exportErrorMessage(err));
      setExportState('error');
    }
  }

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

      <section aria-labelledby="export-heading">
        <h2 id="export-heading">Export your data</h2>
        <p>
          Request a copy of your data — your profile, conversation details, and
          the full message content from your conversations. We’ll prepare it and
          email you a download link, which expires after a short time.
        </p>

        {exportState === 'requested' ? (
          <p className="form-success" role="status">
            Your export is being prepared. We’ll email a download link to{' '}
            {user ? <strong>{user.email}</strong> : 'your address'} when it’s
            ready.
          </p>
        ) : (
          <>
            {exportState === 'error' && exportError && (
              <p className="form-error" role="alert">
                {exportError}
              </p>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={handleExport}
              disabled={exportState === 'requesting'}
            >
              {exportState === 'requesting' ? 'Requesting…' : 'Request data export'}
            </button>
          </>
        )}
      </section>

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

function exportErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'rate_limited':
        return 'You’ve recently requested an export. Check your email, or try again later.';
      case 'network_error':
        return 'Couldn’t reach the server. Check your connection and try again.';
    }
  }
  return 'Couldn’t start your export. Please try again.';
}
