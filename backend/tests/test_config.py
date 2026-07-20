from backend.app.config import env_int, env_str


def test_env_int_uses_default_for_invalid_value(monkeypatch):
    monkeypatch.setenv("TEST_INTEGER_SETTING", "not-an-integer")

    assert env_int("TEST_INTEGER_SETTING", 42) == 42


def test_env_str_strips_values_and_rejects_blank_values(monkeypatch):
    monkeypatch.setenv("TEST_STRING_SETTING", "  configured  ")
    assert env_str("TEST_STRING_SETTING", "fallback") == "configured"

    monkeypatch.setenv("TEST_STRING_SETTING", "   ")
    assert env_str("TEST_STRING_SETTING", "fallback") == "fallback"
