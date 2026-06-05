import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usernameSchema, type Bot } from '@chatapp/shared';
import { ApiError } from '../api/client';
import { startConversation } from '../api/conversations';
import { listBots } from '../api/bots';
import { Field } from '../components/Field';

// Start a conversation (§2): message a person by exact username, or pick a bot.
export function NewConversationPage() {
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [userError, setUserError] = useState<string | undefined>();
  const [startingHuman, setStartingHuman] = useState(false);

  const [bots, setBots] = useState<Bot[] | null>(null);
  const [botsError, setBotsError] = useState(false);
  const [busyBotId, setBusyBotId] = useState<string | null>(null);
  const [botActionError, setBotActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listBots()
      .then((r) => active && setBots(r.bots))
      .catch(() => active && setBotsError(true));
    return () => {
      active = false;
    };
  }, []);

  async function startWithHuman(event: FormEvent) {
    event.preventDefault();
    setUserError(undefined);

    const parsed = usernameSchema.safeParse(username.trim());
    if (!parsed.success) {
      setUserError(parsed.error.issues[0]?.message ?? 'Enter a valid username.');
      return;
    }

    setStartingHuman(true);
    try {
      const { conversation } = await startConversation({
        peerKind: 'human',
        username: parsed.data,
      });
      navigate(`/conversations/${conversation.id}`);
    } catch (err) {
      setUserError(humanStartError(err));
    } finally {
      setStartingHuman(false);
    }
  }

  async function startWithBot(botId: string) {
    setBotActionError(null);
    setBusyBotId(botId);
    try {
      const { conversation } = await startConversation({ peerKind: 'bot', botId });
      navigate(`/conversations/${conversation.id}`);
    } catch {
      setBusyBotId(null);
      setBotActionError('Couldn’t start that conversation. Please try again.');
    }
  }

  return (
    <section className="page" aria-labelledby="new-conversation-heading">
      <header className="conversation-header">
        <Link to="/" className="back-link" aria-label="Back to chats">
          ←
        </Link>
        <h1 id="new-conversation-heading">New conversation</h1>
      </header>

      <h2 className="section-title">Message someone</h2>
      <form className="form" onSubmit={startWithHuman} noValidate>
        <Field
          id="username"
          label="Username"
          autoComplete="off"
          value={username}
          error={userError}
          onChange={setUsername}
          hint="Enter the exact username of the person you want to message."
        />
        <button type="submit" className="btn-primary" disabled={startingHuman}>
          {startingHuman ? 'Starting…' : 'Start chat'}
        </button>
      </form>

      <h2 className="section-title">Chat with a bot</h2>
      {botsError && (
        <p className="form-error" role="alert">
          Couldn’t load bots. Please refresh to try again.
        </p>
      )}
      {botActionError && (
        <p className="form-error" role="alert">
          {botActionError}
        </p>
      )}
      {bots === null && !botsError ? (
        <p className="loading" role="status">
          Loading bots…
        </p>
      ) : (
        <ul className="bot-list">
          {bots?.map((bot) => (
            <li key={bot.id} className="bot-item">
              <span className="bot-info">
                <span className="bot-name">{bot.name}</span>
                {bot.description && (
                  <span className="bot-description">{bot.description}</span>
                )}
              </span>
              <button
                type="button"
                className="btn-primary"
                onClick={() => startWithBot(bot.id)}
                disabled={busyBotId !== null}
              >
                {busyBotId === bot.id ? 'Starting…' : 'Start'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function humanStartError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'not_found':
        // Generic — does not distinguish "doesn't exist" from "unverified" (§2).
        return 'No such user.';
      case 'rate_limited':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'validation_error':
        return 'That username doesn’t look right.';
      case 'network_error':
        return 'Couldn’t reach the server. Check your connection and try again.';
    }
  }
  return 'Couldn’t start the conversation. Please try again.';
}
