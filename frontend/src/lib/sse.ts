import type { SseMessage } from "../types";

/**
 * Parse a single SSE block (the text between two blank lines).
 * Returns null for blocks that carry no `data:` line or malformed JSON.
 */
export function parseSse<T>(block: string): SseMessage<T> | null {
  let event = "message";
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }

  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) as T };
  } catch {
    return null;
  }
}
