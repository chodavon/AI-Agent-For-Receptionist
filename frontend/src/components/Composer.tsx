import { useState } from "react";
import type { FormEvent } from "react";

interface Props {
  busy: boolean;
  recording: boolean;
  onSend: (text: string) => void;
  onRecordStart: () => void;
  onRecordStop: () => void;
}

export default function Composer({
  busy,
  recording,
  onSend,
  onRecordStart,
  onRecordStop,
}: Props) {
  const [value, setValue] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setValue("");
    onSend(text);
  }

  return (
    <form id="form" className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="text">
        Your message
      </label>
      <input
        id="text"
        type="text"
        maxLength={1000}
        autoComplete="off"
        placeholder="Ask about admissions, fees, or opening hours…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />

      <button
        type="button"
        id="mic"
        className={recording ? "recording" : undefined}
        title="Hold to talk"
        aria-label="Hold to record a voice message"
        aria-pressed={recording}
        disabled={busy}
        onPointerDown={(e) => {
          e.preventDefault(); // keep focus in the composer
          onRecordStart();
        }}
        onPointerUp={onRecordStop}
        onPointerLeave={onRecordStop}
        onPointerCancel={onRecordStop}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path
            d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.4V21"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button type="submit" disabled={busy}>
        Send
      </button>
    </form>
  );
}
