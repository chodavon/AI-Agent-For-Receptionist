import type { FeedbackRating, Turn } from "../types";

interface Props {
  turn: Turn;
  onRate: (turnId: string, rating: FeedbackRating) => void;
}

/** One transcript message. Text goes in as a child, never as HTML. */
export default function Bubble({ turn, onRate }: Props) {
  const className = `${turn.role}${turn.streaming ? " streaming" : ""}`;

  return (
    <li className={className}>
      {turn.note && <small>{turn.note}</small>}
      {turn.text}
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
