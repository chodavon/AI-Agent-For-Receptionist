import { useCallback, useState } from "react";
import Composer from "./components/Composer";
import LangSelect from "./components/LangSelect";
import Robot from "./components/Robot";
import StatusLine from "./components/StatusLine";
import Transcript from "./components/Transcript";
import { useChat } from "./hooks/useChat";
import { useRecorder } from "./hooks/useRecorder";
import type { Lang, RobotState } from "./types";

export default function App() {
  const [lang, setLang] = useState<Lang>("auto");
  const chat = useChat();

  const handleClip = useCallback(
    (blob: Blob) => {
      void chat.sendVoice(blob, lang);
    },
    [chat, lang],
  );
  const recorder = useRecorder(handleClip);

  // What the mascot should be doing, most immediate state first: someone
  // talking beats a reply arriving beats waiting on the server.
  const robotState: RobotState = recorder.recording
    ? "listening"
    : chat.streamingId
      ? "speaking"
      : chat.busy
        ? "thinking"
        : "idle";

  const status = recorder.recording
    ? "Recording… release to send."
    : (recorder.error ?? chat.status);
  const statusError =
    !recorder.recording && (Boolean(recorder.error) || chat.statusError);

  return (
    <main className="shell">
      <header className="desk">
        <div className="brand">
          <span className="robot-slot">
            <Robot state={robotState} />
          </span>
          <span className="brand-text">
            <span className="wordmark">AICA</span>
            <span className="tagline">Academy School · front desk</span>
          </span>
        </div>
        <LangSelect value={lang} onChange={setLang} />
      </header>

      <p className="note">
        AICA is an AI assistant. Please don’t share passwords, ID numbers, or
        payment details.
      </p>

      <Transcript turns={chat.turns} onRate={chat.rate} />

      <Composer
        busy={chat.busy}
        recording={recorder.recording}
        onSend={(text) => void chat.send(text, lang)}
        onRecordStart={() => {
          if (!chat.busy) void recorder.start();
        }}
        onRecordStop={recorder.stop}
      />

      <StatusLine text={status} isError={statusError} />
    </main>
  );
}
