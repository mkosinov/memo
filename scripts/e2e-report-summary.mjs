#!/usr/bin/env node
/**
 * e2e-report-summary.mjs — CI-гейт видимости ретрай-флейков e2e (GH #415, спека §3.5).
 *
 * Читает results.json (вывод JSON-репортера Playwright 1.60), печатает сводку
 * по флейкам и возвращает exit-код:
 *   - ≥1 тест со статусом `flaky` → печать строк `FLAKY: <suite> — <title>`,
 *     итоговая строка `Flaky: N`, exit 1 (флейк роняет джобу, мерж блокируется
 *     гейтом зелёного CI — решение пользователя на Gate B, rev3);
 *   - ноль флейков → `Flaky: 0`, exit 0;
 *   - файл отсутствует (прогон не стартовал/убит), битый JSON, незнакомые
 *     статусы (`interrupted`, `didNotRun`, `skipped`, `timedOut`) → ОДНА
 *     предупреждающая строка в stdout, exit 0 — этих случаев флейка нет,
 *     ложное красное недопустимо.
 *
 * Ключ детекции — статус ТЕСТА `flaky` (`specs[].tests[].status`): именно им
 * Playwright помечает «упал в ранней попытке, прошёл в последней» (отдельного
 * статуса «passed с ретраем» нет). Статусы результатов сканируются тоже
 * (belt-and-braces): если хоть один результат несёт `flaky`, тест считается
 * флейком.
 *
 * Окружение:
 *   GITHUB_STEP_SUMMARY (опционально) — Markdown-таблица флейков с итоговой
 *   строкой («Flaky: 0» при пустом списке) дописывается в файл сводки шага;
 *   на каждый флейк — `::warning`-аннотация best-effort (у GitHub есть лимит
 *   аннотаций на шаг/джобу; авторитетный список — таблица в Step Summary).
 *
 * Без зависимостей (plain Node ESM) — CI запускает без install-шага.
 *
 * Usage: node scripts/e2e-report-summary.mjs [путь-к-results.json]
 *   (дефолт `frontend/admin/results.json`; шаг выполняется из корня репо)
 */

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_RESULTS_PATH = 'frontend/admin/results.json';

/**
 * Статусы, которые не считаются «незнакомыми»:
 * - уровень теста (`tests[].status`, = test.outcome()): expected/unexpected —
 *   обычные passed/failed, flaky — сам предмет детекции;
 * - уровень результата (`tests[].results[].status`): passed/failed — норма,
 *   flaky — belt-and-braces (см. шапку).
 * Всё остальное (interrupted, didNotRun, skipped, timedOut, …) — незнакомые.
 */
const KNOWN_TEST_STATUSES = new Set(['expected', 'unexpected', 'flaky']);
const KNOWN_RESULT_STATUSES = new Set(['passed', 'failed', 'flaky']);

/**
 * @typedef {{ suite: string, title: string }} FlakyEntry
 * @typedef {{ flaky: FlakyEntry[], warning: string | null, lines: string[], exitCode: number }} Summary
 */

const isFlakyTest = (test) =>
  test?.status === 'flaky' ||
  (Array.isArray(test?.results) && test.results.some((r) => r?.status === 'flaky'));

/**
 * Чистая суммаризация распарсенного results.json (без I/O) — контракт
 * покрывается юнит-тестом без спавна Node.
 *
 * @param {any} results - распарсенный JSON-отчёт Playwright
 * @returns {Summary}
 */
export function summarize(results) {
  /** @type {FlakyEntry[]} */
  const flaky = [];
  /** @type {Map<string, number>} статус → сколько раз встретился */
  const unknownStatuses = new Map();

  const countUnknown = (status) => {
    if (typeof status !== 'string' || status.length === 0) return;
    unknownStatuses.set(status, (unknownStatuses.get(status) ?? 0) + 1);
  };

  // <suite> в строке FLAKY — заголовок файлового (корневого) suite: это
  // первичный локатор теста для триажа в CI; describe-блоки не раскрываются.
  const visitSuite = (suite, fileTitle) => {
    for (const spec of suite?.specs ?? []) {
      for (const test of spec?.tests ?? []) {
        if (!KNOWN_TEST_STATUSES.has(test?.status)) countUnknown(test?.status);
        for (const result of test?.results ?? []) {
          if (!KNOWN_RESULT_STATUSES.has(result?.status)) countUnknown(result?.status);
        }
        if (isFlakyTest(test)) {
          flaky.push({ suite: fileTitle, title: String(spec?.title ?? '<без заголовка>') });
        }
      }
    }
    for (const nested of suite?.suites ?? []) visitSuite(nested, fileTitle);
  };
  for (const suite of results?.suites ?? []) visitSuite(suite, String(suite?.title ?? '<без suite>'));

  let warning = null;
  if (unknownStatuses.size > 0) {
    const listed = [...unknownStatuses.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([status, count]) => `${status} ×${count}`)
      .join(', ');
    warning = `ПРЕДУПРЕЖДЕНИЕ: незнакомые статусы в отчёте (${listed}) — они не считаются флейками, шаг не блокируется`;
  }

  const lines = [
    ...(warning ? [warning] : []),
    ...flaky.map((f) => `FLAKY: ${f.suite} — ${f.title}`),
    `Flaky: ${flaky.length}`,
  ];

  return { flaky, warning, lines, exitCode: flaky.length > 0 ? 1 : 0 };
}

/**
 * Читает results.json с диска и суммаризирует; ветки «файл отсутствует» и
 * «битый JSON» дают одну предупреждающую строку и exit 0 (см. шапку).
 *
 * @param {string} inputPath
 * @returns {Summary}
 */
export function summarizeFile(inputPath) {
  let raw;
  try {
    raw = readFileSync(inputPath, 'utf8');
  } catch (err) {
    const warning = `ПРЕДУПРЕЖДЕНИЕ: results.json не найден или не читается: ${inputPath} (${err?.code ?? err?.message}) — флейк-гейт пропущен, шаг не блокируется`;
    return { flaky: [], warning, lines: [warning, 'Flaky: 0'], exitCode: 0 };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const warning = `ПРЕДУПРЕЖДЕНИЕ: битый JSON в ${inputPath} (${err?.message}) — флейк-гейт пропущен, шаг не блокируется`;
    return { flaky: [], warning, lines: [warning, 'Flaky: 0'], exitCode: 0 };
  }

  return summarize(parsed);
}

/** Экранирует ячейку Markdown-таблицы (pipe и переводы строк). */
const escapeCell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * Markdown-блок для GITHUB_STEP_SUMMARY: таблица флейков + итоговая строка
 * («Flaky: 0» при пустом списке); предупреждение о незнакомых статусах
 * цитируется, если есть.
 *
 * @param {FlakyEntry[]} flaky
 * @param {string | null} [warning]
 * @returns {string}
 */
export function buildMarkdownSummary(flaky, warning = null) {
  const out = ['### Flaky-сводка e2e', ''];
  if (warning) out.push(`> ⚠️ ${warning}`, '');
  if (flaky.length > 0) {
    out.push('| Suite | Тест |', '| --- | --- |');
    for (const f of flaky) out.push(`| ${escapeCell(f.suite)} | ${escapeCell(f.title)} |`);
    out.push('');
  }
  out.push(`Flaky: ${flaky.length}`);
  return out.join('\n');
}

/**
 * CLI-обёртка: читает файл, печатает строки и аннотации, дописывает Step
 * Summary, выходит с кодом контракта.
 *
 * @param {string[]} argv
 * @returns {number} exit-код
 */
export function main(argv = process.argv.slice(2)) {
  const inputPath = argv[0] ?? DEFAULT_RESULTS_PATH;
  const { flaky, warning, lines, exitCode } = summarizeFile(inputPath);

  for (const line of lines) process.stdout.write(`${line}\n`);

  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummaryPath) {
    try {
      appendFileSync(stepSummaryPath, `${buildMarkdownSummary(flaky, warning)}\n`, 'utf8');
    } catch (err) {
      // best-effort: сбой сводки не должен менять вердикт шага
      process.stdout.write(
        `ПРЕДУПРЕЖДЕНИЕ: не удалось дописать GITHUB_STEP_SUMMARY (${err?.message})\n`,
      );
    }
  }

  // ::warning-аннотации — best-effort: у GitHub лимит аннотаций на шаг/джобу
  for (const f of flaky) {
    process.stdout.write(`::warning title=Flaky::${f.suite} — ${f.title}\n`);
  }

  return exitCode;
}

// Запуск как CLI, но не при импорте из юнит-теста
const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  process.exit(main());
}
