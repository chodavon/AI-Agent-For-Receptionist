import { useCallback, useRef } from "react";
import type { Lang } from "../types";

/** Sentence terminators for English and Khmer (។ ៕). */
const SENTENCE_END = /[.!?។៕\n]/;
const KHMER = /[ក-៿]/;

const supportsSpeech = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;

/** Khmer if the text is Khmer, otherwise the menu choice. */
export function guessLang(text: string, selected: Lang): "en" | "km" {
  if (KHMER.test(text)) return "km";
  return selected === "km" ? "km" : "en";
}

/**
 * Speaks the reply sentence by sentence as it streams, so the caller hears the
 * first sentence while the rest is still being written.
 */
export function useSpeech() {
  const spokenUpTo = useRef(0);

  const speak = useCallback((text: string, lang: "en" | "km") => {
    if (!supportsSpeech() || !text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = lang === "km" ? "km-KH" : "en-US";
    window.speechSynthesis.speak(utterance); // utterances queue up in order
  }, []);

  /** Stop talking and start a fresh reply from the beginning. */
  const reset = useCallback(() => {
    if (supportsSpeech()) window.speechSynthesis.cancel();
    spokenUpTo.current = 0;
  }, []);

  const speakNew = useCallback(
    (fullText: string, lang: "en" | "km", final = false) => {
      const pending = fullText.slice(spokenUpTo.current);
      let cut = -1;

      if (final) {
        cut = pending.length;
      } else {
        for (let i = pending.length - 1; i >= 0; i--) {
          if (SENTENCE_END.test(pending[i])) {
            cut = i + 1;
            break;
          }
        }
      }

      if (cut > 0) {
        speak(pending.slice(0, cut), lang);
        spokenUpTo.current += cut;
      }
    },
    [speak],
  );

  return { speakNew, reset };
}
