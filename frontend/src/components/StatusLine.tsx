interface Props {
  text: string;
  isError: boolean;
}

/**
 * Announced to assistive tech; the robot mascot is aria-hidden so this is the
 * single place the desk's state is spoken.
 */
export default function StatusLine({ text, isError }: Props) {
  return (
    <p id="status" className={`status${isError ? " error" : ""}`} role="status">
      {text}
    </p>
  );
}
