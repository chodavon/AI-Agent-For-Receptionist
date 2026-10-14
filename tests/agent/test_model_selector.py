"""Tests for the skill-based model selector."""

from unittest.mock import MagicMock

from receptionist.agent.model_selector import choose


def _settings(fast="gemini-3.5-flash-lite", main="gemini-3.8-flash"):
    s = MagicMock()
    s.gemini_model_fast = fast
    s.gemini_model = main
    return s


def test_routed_faq_uses_fast():
    model, fast = choose(
        _settings(), routed_skill="fees", has_workflow=False, lang="en", path="routed",
    )
    assert model == "gemini-3.5-flash-lite"
    assert fast is True


def test_knowledge_path_uses_fast():
    model, fast = choose(
        _settings(), routed_skill="fees", has_workflow=False, lang="en", path="knowledge",
    )
    assert model == "gemini-3.5-flash-lite"
    assert fast is True


def test_workflow_uses_main():
    model, fast = choose(
        _settings(), routed_skill="admissions", has_workflow=True, lang="en", path="routed",
    )
    assert model == "gemini-3.8-flash"
    assert fast is False


def test_no_route_uses_main():
    model, fast = choose(
        _settings(), routed_skill=None, has_workflow=False, lang="en", path="none",
    )
    assert model == "gemini-3.8-flash"
    assert fast is False


def test_khmer_uses_main():
    model, fast = choose(
        _settings(), routed_skill="fees", has_workflow=False, lang="km", path="routed",
    )
    assert model == "gemini-3.8-flash"
    assert fast is False


def test_no_fast_model_uses_main():
    model, fast = choose(
        _settings(fast=""), routed_skill="fees", has_workflow=False, lang="en", path="routed",
    )
    assert model == "gemini-3.8-flash"
    assert fast is False
