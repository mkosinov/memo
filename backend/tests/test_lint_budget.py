"""Юнит-тесты чистых функций ``scripts/lint_budget.py`` (GH #306, рахет-гейт).

Покрывают парсинг порогов из текста скрипта, правила сравнения «факт против
порога», парсинг вывода ruff/mypy, режимы базы ветки и запрет роста порогов.
Сабпроцесс-обвязка (запуск ruff/mypy/git) проверяется сценарно, без моков.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import pytest
from lint_budget import (
    MYPY_BUDGET,
    RUFF_BUDGET,
    Budgets,
    Verdict,
    base_mode,
    check_growth,
    compare_ruff_rules,
    compare_tool,
    parse_budgets,
    parse_mypy_total,
    parse_ruff_counts,
)

pytestmark = pytest.mark.pure_unit

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "lint_budget.py"

SAMPLE_SOURCE = '''\
"""Sample budget script."""

from __future__ import annotations

RUFF_BUDGET: dict[str, int] = {
    "I001": 44,
    "F401": 29,
}

MYPY_BUDGET: int = 531
'''


class TestParseBudgets:
    def test_parses_both_constants(self) -> None:
        assert parse_budgets(SAMPLE_SOURCE) == Budgets({"I001": 44, "F401": 29}, 531)

    def test_plain_assign_without_annotations(self) -> None:
        source = 'RUFF_BUDGET = {"I001": 1}\nMYPY_BUDGET = 5\n'
        assert parse_budgets(source) == Budgets({"I001": 1}, 5)

    def test_missing_mypy_constant_returns_none(self) -> None:
        assert parse_budgets('RUFF_BUDGET: dict[str, int] = {"I001": 44}\n') is None

    def test_missing_ruff_constant_returns_none(self) -> None:
        assert parse_budgets("MYPY_BUDGET: int = 531\n") is None

    def test_non_literal_budget_returns_none(self) -> None:
        assert parse_budgets("RUFF_BUDGET = compute()\nMYPY_BUDGET = 5\n") is None

    def test_non_int_ruff_value_returns_none(self) -> None:
        assert parse_budgets('RUFF_BUDGET = {"I001": "44"}\nMYPY_BUDGET = 5\n') is None

    def test_syntax_error_returns_none(self) -> None:
        assert parse_budgets("def broken(:\n") is None

    def test_actual_script_constants_parse_from_own_source(self) -> None:
        parsed = parse_budgets(SCRIPT_PATH.read_text(encoding="utf-8"))
        assert parsed is not None
        assert parsed.ruff == dict(RUFF_BUDGET)
        assert parsed.mypy == MYPY_BUDGET


class TestCompareTool:
    def test_fact_above_threshold_is_red_with_canon_message(self) -> None:
        verdict = compare_tool("ruff I001", fact=46, threshold=44)
        assert verdict == Verdict(False, "ruff I001: PR добавил ошибок: было 44, стало 46")

    def test_fact_below_threshold_demands_lowering(self) -> None:
        verdict = compare_tool("ruff I001", fact=40, threshold=44)
        assert verdict == Verdict(False, "ruff I001: порог разболтался: опусти до 40")

    def test_fact_equal_threshold_is_green(self) -> None:
        verdict = compare_tool("mypy", fact=531, threshold=531)
        assert verdict == Verdict(True, "mypy: 531 — в бюджете")


class TestCompareRuffRules:
    def test_rule_absent_in_budget_has_zero_threshold(self) -> None:
        verdicts = compare_ruff_rules({"E712": 1}, {})
        assert verdicts == [Verdict(False, "ruff E712: PR добавил ошибок: было 0, стало 1")]

    def test_budgeted_rule_absent_in_fact_must_be_lowered_to_zero(self) -> None:
        verdicts = compare_ruff_rules({}, {"I001": 44})
        assert verdicts == [Verdict(False, "ruff I001: порог разболтался: опусти до 0")]

    def test_verdicts_cover_union_of_rules_sorted_by_name(self) -> None:
        verdicts = compare_ruff_rules({"B008": 2}, {"I001": 0, "B008": 2})
        assert verdicts == [
            Verdict(True, "ruff B008: 2 — в бюджете"),
            Verdict(True, "ruff I001: 0 — в бюджете"),
        ]


class TestParseMypyTotal:
    def test_summary_line_with_errors(self) -> None:
        output = (
            "src/x.py:1: error: Function is missing a type annotation [no-untyped-def]\n"
            "Found 531 errors in 49 files (checked 147 source files)\n"
        )
        assert parse_mypy_total(output) == 531

    def test_singular_error_form(self) -> None:
        assert parse_mypy_total("Found 1 error in 1 file (checked 2 source files)") == 1

    def test_success_output_has_no_total(self) -> None:
        assert parse_mypy_total("Success: no issues found in 147 source files") is None

    def test_garbage_output_has_no_total(self) -> None:
        assert parse_mypy_total("something entirely different\n") is None


class TestParseRuffCounts:
    def test_counts_per_rule_code(self) -> None:
        payload = json.dumps(
            [
                {"code": "I001", "filename": "a.py"},
                {"code": "I001", "filename": "b.py"},
                {"code": "F401", "filename": "c.py"},
            ]
        )
        assert parse_ruff_counts(payload) == {"I001": 2, "F401": 1}

    def test_empty_array_is_zero_counts(self) -> None:
        assert parse_ruff_counts("[]") == {}

    def test_invalid_json_raises_value_error(self) -> None:
        with pytest.raises(ValueError):
            parse_ruff_counts("not json at all")

    def test_empty_payload_raises_value_error(self) -> None:
        with pytest.raises(ValueError):
            parse_ruff_counts("")


class TestCheckGrowth:
    def test_equal_budgets_pass(self) -> None:
        base = Budgets({"I001": 44}, 531)
        assert check_growth(base, base) == []

    def test_raised_ruff_threshold_is_violation(self) -> None:
        base = Budgets({"I001": 44}, 531)
        current = Budgets({"I001": 46}, 531)
        assert check_growth(current, base) == [
            "ruff I001: бюджет не растёт — сначала снеси ошибки (было 44, стало 46)",
        ]

    def test_new_nonzero_rule_entry_is_violation(self) -> None:
        assert check_growth(Budgets({"E712": 1}, 531), Budgets({}, 531)) == [
            "ruff E712: бюджет не растёт — сначала снеси ошибки (было 0, стало 1)",
        ]

    def test_new_zero_rule_entry_is_allowed(self) -> None:
        assert check_growth(Budgets({"E712": 0}, 531), Budgets({}, 531)) == []

    def test_lowered_and_removed_rules_are_allowed(self) -> None:
        base = Budgets({"I001": 44, "F401": 29}, 531)
        current = Budgets({"I001": 10}, 531)
        assert check_growth(current, base) == []

    def test_raised_mypy_total_is_violation(self) -> None:
        assert check_growth(Budgets({}, 540), Budgets({}, 531)) == [
            "mypy: бюджет не растёт — сначала снеси ошибки (было 531, стало 540)",
        ]


class TestZeroMypyBudget:
    """Волна 4 (GH #306 Task 7): mypy-порог = 0 — сравнение и запрет роста
    обязаны работать в нулевом режиме без special-case-ловушек."""

    def test_fact_zero_threshold_zero_is_green(self) -> None:
        assert compare_tool("mypy", fact=0, threshold=0) == Verdict(
            True, "mypy: 0 — в бюджете"
        )

    def test_fact_one_threshold_zero_is_red_growth(self) -> None:
        assert compare_tool("mypy", fact=1, threshold=0) == Verdict(
            False, "mypy: PR добавил ошибок: было 0, стало 1"
        )

    def test_actual_script_budget_is_zero(self) -> None:
        # Порог волны 4: 0 (= факту «mypy src = 0 ошибок»).
        assert MYPY_BUDGET == 0

    def test_growth_from_zero_base_to_zero_is_allowed(self) -> None:
        assert check_growth(Budgets({}, 0), Budgets({}, 0)) == []

    def test_growth_from_zero_base_to_one_is_violation(self) -> None:
        assert check_growth(Budgets({}, 1), Budgets({}, 0)) == [
            "mypy: бюджет не растёт — сначала снеси ошибки (было 0, стало 1)",
        ]


class TestBaseMode:
    def test_pull_request_env(self) -> None:
        env = {"GITHUB_BASE_REF": "main", "GITHUB_EVENT_NAME": "pull_request"}
        assert base_mode(env) == "pull_request"

    def test_push_to_main(self) -> None:
        env = {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main"}
        assert base_mode(env) == "main_push"

    def test_push_to_feature_branch_is_local(self) -> None:
        env = {"GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/feat-x"}
        assert base_mode(env) == "local"

    def test_empty_env_is_local(self) -> None:
        assert base_mode({}) == "local"

    def test_blank_base_ref_is_local(self) -> None:
        assert base_mode({"GITHUB_BASE_REF": ""}) == "local"
