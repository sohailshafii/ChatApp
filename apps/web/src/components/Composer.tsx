import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { MESSAGE_CONTENT_MAX } from '@chatapp/shared';

// Message composer: a growing textarea + send. Enter sends, Shift+Enter inserts
// a newline. Send is disabled while the socket is down or the draft is empty/too
// long (length checked by code points to match the server, §3).
export function Composer({
  onSend,
  disabled = false,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const tooLong = [...text].length > MESSAGE_CONTENT_MAX;
  const canSend = !disabled && !tooLong && text.trim() !== '';

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        className="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message…"
        rows={1}
        aria-label="Message"
        aria-invalid={tooLong || undefined}
      />
      <button type="submit" className="btn-primary" disabled={!canSend}>
        Send
      </button>
      {tooLong && (
        <span className="field-error" role="alert">
          Message is too long (max 20,000 characters).
        </span>
      )}
    </form>
  );
}
