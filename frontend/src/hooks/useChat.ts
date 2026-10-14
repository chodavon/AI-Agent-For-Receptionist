import { useCallback, useRef, useState } from "react";
import { parseSse } from "../lib/sse";
import type {
  DeltaEvent,
  DoneEvent,
  ErrorEvent,
  FeedbackRating,
  Lang,
  Turn,
} from "../types";
import { guessLang, useSpeech } from "./useSpeech";

const GREETING =
  "Hello! I'm AICA, the school's receptionist. Ask me about admissions, fees, " +
  "or opening hours. សួស្តី! អ្នកអាចសួរជាភាសាខ្មែរបាន។";

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** One conversation per browser tab. */
export function useChat() {
  const [turns, setTurns] = useState<Turn[]>([
    { id: newId(), role: "bot", text: GREETING },
  ]);
  const [status, setStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  const sessionId = useRef(newId());
  const { speakNew, reset: resetSpeech } = useSpeech();

  const fail = useCallback((message: string) => {
    setStatus(message);
    setStatusError(true);
  }, []);

  /** POST the message and stream the reply back over SSE. */
  const streamReply = useCallback(
    async (message: string, selectedLang: Lang) => {
      const payload: { session_id: string; message: string; lang?: "en" | "km" } = {
        session_id: sessionId.current,
        message,
      };
      if (selectedLang === "en" || selectedLang === "km") payload.lang = selectedLang;

      let res: Response;
      try {
        res = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(payload),
        });
      } catch {
        fail("Network error. Please try again.");
        return;
      }

      if (!res.ok || !res.body) {
        let detail = "Something went wrong.";
        try {
          const body = await res.json();
          if (typeof body.detail === "string") detail = body.detail;
        } catch {
          /* keep the default detail */
        }
        fail(res.status === 429 ? "Too many requests, please wait a moment." : detail);
        return;
      }

      resetSpeech();
      const botId = newId();
      let added = false;
      let text = "";
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value.replace(/\r\n/g, "\n");

          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const msg = parseSse<unknown>(buffer.slice(0, sep));
            buffer = buffer.slice(sep + 2);
            if (!msg) continue;

            if (msg.event === "delta") {
              const delta = msg.data as DeltaEvent;
              if (!added) {
                added = true;
                setStreamingId(botId);
                setStatus("");
                setStatusError(false);
                setTurns((prev) => [
                  ...prev,
                  { id: botId, role: "bot", text: "", streaming: true },
                ]);
              }
              text += delta.text;
              setTurns((prev) =>
                prev.map((t) => (t.id === botId ? { ...t, text } : t)),
              );
              speakNew(text, guessLang(text, selectedLang));
            } else if (msg.event === "done") {
              const done = msg.data as DoneEvent;
              setTurns((prev) => {
                const next = done.session_reset
                  ? [...prev, { id: newId(), role: "bot" as const, text: "(Starting a new conversation.)" }]
                  : [...prev];
                const final: Turn = {
                  id: botId,
                  role: "bot",
                  text: done.reply,
                  ...(done.turn_id ? { turnId: done.turn_id } : {}),
                  ...(done.suggestions?.length ? { suggestions: done.suggestions } : {}),
                  ...(done.source ? { source: done.source } : {}),
                };
                const at = next.findIndex((t) => t.id === botId);
                if (at === -1) next.push(final);
                else next[at] = final; // drops `streaming`, which removes the caret
                return next;
              });
              setStreamingId(null);
              setStatus("");
              setStatusError(false);

              if (done.audio_base64) {
                void new Audio(`data:audio/wav;base64,${done.audio_base64}`)
                  .play()
                  .catch(() => {});
              } else {
                speakNew(done.reply, done.lang === "km" ? "km" : "en", true);
              }
            } else if (msg.event === "error") {
              const err = msg.data as ErrorEvent;
              // Never leave a half-written reply shimmering forever.
              setTurns((prev) =>
                prev.map((t) => (t.id === botId ? { ...t, streaming: false } : t)),
              );
              setStreamingId(null);
              fail(typeof err.detail === "string" ? err.detail : "Something went wrong.");
            }
          }
        }
      } catch {
        // The connection dropped mid-reply; keep whatever text arrived.
        fail("Network error. Please try again.");
      } finally {
        setStreamingId(null);
        setTurns((prev) =>
          prev.map((t) => (t.id === botId && t.streaming ? { ...t, streaming: false } : t)),
        );
      }
    },
    [fail, resetSpeech, speakNew],
  );

  const send = useCallback(
    async (raw: string, selectedLang: Lang) => {
      const message = raw.trim();
      if (!message || busy) return;
      setTurns((prev) => [...prev, { id: newId(), role: "user", text: message }]);
      setStatus("Thinking…");
      setStatusError(false);
      setBusy(true);
      try {
        await streamReply(message, selectedLang);
      } finally {
        setBusy(false);
      }
    },
    [busy, streamReply],
  );

  /** Voice message: transcribe first, then stream the reply like a typed one. */
  const sendVoice = useCallback(
    async (blob: Blob, selectedLang: Lang) => {
      if (blob.size < 1000) {
        fail("Recording too short.");
        return;
      }
      setStatus("Listening…");
      setStatusError(false);
      setBusy(true);

      const form = new FormData();
      form.append("lang", selectedLang);
      form.append("audio", blob, "voice.webm");

      try {
        const res = await fetch("/api/transcribe", { method: "POST", body: form });
        let body: { detail?: unknown; transcript?: string; lang?: Lang } = {};
        try {
          body = await res.json();
        } catch {
          /* non-JSON error body */
        }

        if (!res.ok) {
          const detail =
            typeof body.detail === "string"
              ? body.detail
              : "Could not understand the recording.";
          fail(res.status === 429 ? "Too many requests, please wait a moment." : detail);
          return;
        }

        setTurns((prev) => [
          ...prev,
          {
            id: newId(),
            role: "user",
            text: body.transcript ?? "",
            note: "🎤 voice message",
          },
        ]);
        setStatus("Thinking…");
        await streamReply(body.transcript ?? "", body.lang ?? selectedLang);
      } catch {
        fail("Network error. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [fail, streamReply],
  );

  /** Rate a reply so staff can review it. */
  const rate = useCallback(async (turnId: string, rating: FeedbackRating) => {
    setTurns((prev) => prev.map((t) => (t.turnId === turnId ? { ...t, rating } : t)));
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId.current, turn_id: turnId, rating }),
      });
    } catch {
      /* the chip stays marked; nothing useful to say here */
    }
  }, []);

  return {
    turns,
    status,
    statusError,
    busy,
    streamingId,
    send,
    sendVoice,
    rate,
  };
}
