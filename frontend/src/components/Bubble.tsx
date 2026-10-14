import type { FeedbackRating, Turn } from "../types";

interface Props {
  turn: Turn;
  onRate: (turnId: string, rating: FeedbackRating) => void;
  onSuggestion?: (text: string) => void;
}

/** One transcript message. Text goes in as a child, never as HTML. */
export default function Bubble({ turn, onRate, onSuggestion }: Props) {
  const className = `${turn.role}${turn.streaming ? " streaming" : ""}`;

  return (
    <li className={className}>
      {turn.note && <small>{turn.note}</small>}
      {turn.text}
      {turn.source && (
        <div className="source-line">From "{turn.source}"</div>
      )}
      {turn.suggestions && turn.suggestions.length > 0 && onSuggestion && (
        <div className="suggestions">
          {turn.suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              onClick={() => onSuggestion(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {turn.turnId && (
        <div className="feedback">
          {turn.rating ? (
            <span>
              {turn.rating === "up"
                ? "Thanks!"
                : "Thanks, staff will review this answer."}
            </span>
          ) : (
            <>
              <button
                type="button"
                className="secondary"
                title="Helpful"
                aria-label="Helpful"
                onClick={() => onRate(turn.turnId!, "up")}
              >
                👍
              </button>
              <button
                type="button"
                className="secondary"
                title="Not helpful"
                aria-label="Not helpful"
                onClick={() => onRate(turn.turnId!, "down")}
              >
                👎
              </button>
              <span>Rate this answer</span>
            </>
          )}
        </div>
      )}
    </li>
  );
}
