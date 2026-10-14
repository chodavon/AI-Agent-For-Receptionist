import { useCallback, useEffect, useRef, useState } from "react";

const MAX_RECORD_MS = 120_000;

/**
 * Hold-to-talk recording. `onClip` receives the finished audio blob.
 * The callback is held in a ref so the MediaRecorder handlers never go stale.
 */
export function useRecorder(onClip: (blob: Blob) => void) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clipRef = useRef(onClip);
  useEffect(() => {
    clipRef.current = onClip;
  }, [onClip]);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | undefined>(undefined);
  /** True between pointerdown and the stream arriving from getUserMedia. */
  const starting = useRef(false);
  /** Set when the button is released before the stream arrives. */
  const released = useRef(false);

  const stop = useCallback(() => {
    // getUserMedia has not resolved yet: nothing to stop, so flag the release
    // and let start() tear the stream down when it lands.
    if (starting.current) released.current = true;
    window.clearTimeout(timer.current);
    const active = recorder.current;
    if (active && active.state === "recording") active.stop();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    if (recorder.current || starting.current) return;
    setError(null);
    starting.current = true;
    released.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // The caller let go while the permission prompt was open. Drop the stream
      // instead of recording with no button held down.
      if (released.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const media = new MediaRecorder(stream);
      recorder.current = media;
      chunks.current = [];

      media.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      media.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        clipRef.current(new Blob(chunks.current, { type: media.mimeType || "audio/webm" }));
      };

      media.start();
      setRecording(true);
      timer.current = window.setTimeout(stop, MAX_RECORD_MS);
    } catch {
      recorder.current = null;
      setRecording(false);
      setError("Microphone not available. Check browser permissions.");
    } finally {
      starting.current = false;
    }
  }, [stop]);

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => stop, [stop]);

  return { recording, error, start, stop };
}
