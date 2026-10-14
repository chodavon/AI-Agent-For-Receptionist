import { useEffect, useRef } from "react";
import type { FeedbackRating, Turn } from "../types";
import Bubble from "./Bubble";

interface Props {
  turns: Turn[];
  onRate: (turnId: string, rating: FeedbackRating) => void;
}

export default function Transcript({ turns, onRate }: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the newest message in view as the reply streams in.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns]);

  return (
    <ol id="log" className="log" aria-live="polite" ref={listRef}>
      {turns.map((turn) => (
        <Bubble key={turn.id} turn={turn} onRate={onRate} />
      ))}
    </ol>
  );
}
