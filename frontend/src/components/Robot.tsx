import "./Robot.css";
import type { RobotState } from "../types";

/**
 * AICA's mascot: a small desk robot whose face reflects what the front desk is
 * doing. All motion lives in Robot.css and is keyed off `data-state`, so React
 * only has to report the state.
 *
 * Decorative for assistive tech — the status line announces the same
 * information in words, so announcing this too would just repeat it.
 */
export default function Robot({ state }: { state: RobotState }) {
  return (
    <svg
      className="robot"
      data-state={state}
      viewBox="0 0 72 64"
      aria-hidden="true"
      focusable="false"
    >
      <g className="robot__bob">
        {/* Antenna — the state light that the old orb used to be. */}
        <g className="robot__antenna">
          <rect className="robot__stalk" x="34.6" y="11" width="2.8" height="9" rx="1.4" />
          <circle className="robot__bulb" cx="36" cy="8.5" r="4.2" />
          <circle className="robot__bulb-core" cx="36" cy="8.5" r="1.7" />
        </g>

        <g className="robot__face">
          {/* Side pods — light up while listening. */}
          <rect className="robot__ear" x="3.5" y="32" width="6.5" height="16" rx="3.2" />
          <rect className="robot__ear" x="62" y="32" width="6.5" height="16" rx="3.2" />
          <circle className="robot__ear-dot" cx="6.75" cy="40" r="1.7" />
          <circle className="robot__ear-dot" cx="65.25" cy="40" r="1.7" />

          <rect className="robot__head" x="10" y="18" width="52" height="42" rx="14" />
          <rect className="robot__visor" x="15.5" y="24" width="41" height="23" rx="10" />

          {/* Sweeps the visor while the desk is thinking. Drawn before the eyes
              so the beam reads as passing behind them, not through the face. */}
          <rect className="robot__scan" x="17.5" y="25" width="37" height="2.2" rx="1.1" />

          <g className="robot__eyes">
            <g className="robot__eye">
              {/* Iris groups pupil + highlight so the glint scales with the eye. */}
              <g className="robot__iris">
                <circle className="robot__pupil" cx="27.5" cy="35.5" r="4.4" />
                <circle className="robot__glint" cx="29" cy="34" r="1.2" />
              </g>
              <rect className="robot__lid" x="22.7" y="30.9" width="9.6" height="9.4" rx="3.2" />
            </g>
            <g className="robot__eye">
              <g className="robot__iris">
                <circle className="robot__pupil" cx="44.5" cy="35.5" r="4.4" />
                <circle className="robot__glint" cx="46" cy="34" r="1.2" />
              </g>
              <rect className="robot__lid" x="39.7" y="30.9" width="9.6" height="9.4" rx="3.2" />
            </g>
          </g>

          {/* Speaker grille — animates while AICA is talking. */}
          <g className="robot__mouth">
            <rect x="28.1" y="53" width="2.6" height="4" rx="1.3" />
            <rect x="32.5" y="49" width="2.6" height="8" rx="1.3" />
            <rect x="36.9" y="51.5" width="2.6" height="5.5" rx="1.3" />
            <rect x="41.3" y="50" width="2.6" height="7" rx="1.3" />
          </g>
        </g>
      </g>
    </svg>
  );
}
