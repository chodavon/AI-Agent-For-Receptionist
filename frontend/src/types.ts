/** Shared types for the AICA chat interface. */

export type Role = "user" | "bot";

/** What the caller picked in the language menu. "auto" lets the server decide. */
export type Lang = "auto" | "en" | "km";

/** What the robot mascot is doing — drives its animation. */
export type RobotState = "idle" | "listening" | "thinking" | "speaking";

export type FeedbackRating = "up" | "down";

/** One message in the transcript. */
export interface Turn {
  id: string;
  role: Role;
  text: string;
  /** Small label above the text, e.g. "🎤 voice message" / "routed skill: fees". */
  note?: string;
  /** True while the reply is still arriving, which shows the caret. */
  streaming?: boolean;
  /** Server turn id. Its presence is what makes 👍/👎 available. */
  turnId?: string;
  /** Set once a rating has been sent, so the chips stop being clickable. */
  rating?: FeedbackRating;
  /** Quick-reply suggestions from the matched skill's FAQ. */
  suggestions?: string[];
  /** Skill that sourced the answer, e.g. "fees and payments". */
  source?: string;
}

/** Payload of the SSE `done` event. */
export interface DoneEvent {
  reply: string;
  turn_id?: string;
  lang?: Lang;
  session_reset?: boolean;
  audio_base64?: string;
  suggestions?: string[];
  source?: string;
}

/** Payload of the SSE `delta` event. */
export interface DeltaEvent {
  text: string;
}

export interface ErrorEvent {
  detail?: string;
}

/** One parsed `event:`/`data:` block from the SSE stream. */
export interface SseMessage<T> {
  event: string;
  data: T;
}
