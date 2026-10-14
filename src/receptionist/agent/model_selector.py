"""Skill-based model selector: route each question to the smallest capable model.

Instead of a fixed failover chain (fast → main → fallback), choose the model
based on what the question needs:
- Routed FAQ, no workflow → fast model (cheap, quick)
- Workflow or no route → main model (reasoning)
- Khmer detected and fast model is weak at KM → main model
"""

from receptionist.config import Settings


def choose(
    settings: Settings,
    *,
    routed_skill: str | None,
    has_workflow: bool,
    lang: str,
    path: str,
) -> tuple[str, bool]:
    """Return (preferred_model, is_fast_path).

    The caller still falls back through the normal chain if the chosen model
    fails (429/5xx), so this only picks the *first* model to try.
    """
    fast_model = settings.gemini_model_fast
    main_model = settings.gemini_model

    if not routed_skill and path not in ("routed", "knowledge"):
        return main_model, False

    if has_workflow:
        return main_model, False

    if lang == "km" and fast_model:
        return main_model, False

    if path in ("routed", "knowledge") and fast_model:
        return fast_model, True

    return main_model, False
