import pytest

from backend.app.llm_setup import LLMError, parse_json_response, truncate_to_token_limit


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        ('{"status":"ok"}', {"status": "ok"}),
        ('```json\n{"status":"ok"}\n```', {"status": "ok"}),
        ('Model preface {"status":"ok"} trailing text', {"status": "ok"}),
    ],
)
def test_parse_json_response_accepts_supported_model_outputs(response, expected):
    assert parse_json_response(response) == expected


@pytest.mark.parametrize("response", ["", "not json", "prefix {broken}"])
def test_parse_json_response_rejects_malformed_output(response):
    with pytest.raises(LLMError, match="valid JSON"):
        parse_json_response(response)


def test_truncate_to_token_limit_preserves_the_requested_word_budget():
    assert truncate_to_token_limit("one two three four", 3) == "one two three"
    assert truncate_to_token_limit("one two", 3) == "one two"
