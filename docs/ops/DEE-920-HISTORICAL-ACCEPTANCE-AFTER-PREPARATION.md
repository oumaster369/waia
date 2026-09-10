# DEE-920: приёмка после текущей научной подготовки

Статус: **инструкция, не свидетельство выполнения или PASS**. Проверка исходников: 2026-09-10.

Исполняемый контракт ниже проверен на `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67` (далее S).
Исходный документ подготовлен поверх main `9c976bdadded0f7de0bdfe891dc0573aac3be70c`.
Повторная проверка ссылок DEE-980: main `5aee44883454551760c889129577615737aa5b80` (далее M).
Наличие изменений в M не означает их развёртывания. DEE-960/961 и подключение HTX не являются
зависимостями этого исторического пути. Никакие серверные команды при подготовке документа не выполнялись.

## 1. Сначала установить факты, не запускать расчёт повторно

Следующие значения взяты из локальной памятки `trader-resume-after-manual-pause-2026-09-08.md`
за пределами репозитория. Это **last-known**, а не повторная проверка production:

| Поле | Ожидаемое значение для существующей попытки |
| --- | --- |
| Release SHA | `90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67` |
| Organization | `3c50b4e9-1138-43a5-a29f-e65088124cfc` |
| Campaign run | `fhv-v2-90de233a-rehearsal-20260908-01` |
| Authenticated request ID | `5179d1fb-0fd3-4d49-a1c9-8474cb790d30` |
| Request digest | `07a20d0b9242fa84517f42ba1aad4a686e11f1db1bf46d49095bd37263d1a4da` |
| Extent | initial record `525600`, `35` cycles, last record `525634` |
| Dataset directory | `/opt/waia/fhv-work/datasets/fhv-v2-5f36d8c8-20260901` |
| Dataset digest | `0787b47537ee7c9d1a10610f1b101c24c743a833a7dd408224266bd8632898dc` |
| Runtime receipt digest | `4adc2a959ffddc31bec850cf27e47a8f388024d3ce4f467a5d3170dffa1a3049` |
| Attempt / service / container | `/opt/waia/90de233a-proposal-attempt-01` / `waia-historical-proposal-90de233a-01.service` / `waia-scientific-90de233a-01` |
| Verified modeled account ID | **НЕ УСТАНОВЛЕН этим документом**; взять из persisted proposal `launchPlan.accountId` |
| Proposal ID / proposal digest / ratification ID | **НЕ УСТАНОВЛЕНЫ этим документом** |

По последнему наблюдению памятки, 2026-09-09 23:33:30 UTC процесс ещё работал,
restart count был 0, `exit-status` отсутствовал. Объём checkpoints и длительность не дают ни PASS, ни ETA.

Разрешённая следующая проверка — только чтение состояния существующей попытки. Примеры для оператора
**на execution-server**, не команды запуска и не повод открывать новый процесс расчёта:

```sh
systemctl show waia-historical-proposal-90de233a-01.service --property=ActiveState,SubState,Result,ExecMainStatus
docker inspect --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.RestartCount}}' waia-scientific-90de233a-01
if test -f /opt/waia/90de233a-proposal-attempt-01/exit-status; then
  head -c 64 /opt/waia/90de233a-proposal-attempt-01/exit-status
else
  printf '%s\n' 'NO_TERMINAL_MARKER'
fi
```

Не читать/печатать env-файлы, credentials или `.seal-key`; не выгружать полные логи в чат.
Существующий журнал сохранять целиком приватно; извлекать только проверенные технические события без секретов.
`SCIENTIFIC_PREPARATION`, `SURFACE_LOAD`, `FORECAST_ANCHORS`, `VALIDATION_RESAMPLES`,
`TECHNICAL_CANDIDATE_COMPLETE`, `PROPOSAL_PERSISTED`, `FINALIZATION_REPLAY` — диагностические фазы,
не торговые полномочия и не отдельный успешный тест ([S: observer](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/historical-simulation-v2/technical-preparation-observer-v2.ts#L1)).

**Gate A:** одновременно подтвердить завершение именно этой попытки без ошибки и persisted proposal:

- CLI result `waia.trader.historical_technical_proposal_cli_result.v2` содержит `proposalId`
  и `proposalContentDigestHex`; сравнить их с аутентифицированным review API/Admin.
- В review существует предложение для exact SHA/org/run (`PROPOSAL_AVAILABLE`), а не только записанный request.
- Проверить qualification receipt, неизменность корпуса/границ, четыре научные поверхности и их digests.
  Отрицательная квалификация — сохранённый научный результат, не разрешение менять критерии.
- Отсутствующий marker, ненулевой exit, несовпадение digest или отсутствие durable proposal оставляют Gate A открытым.
  Не перезапускать `prepare-proposal`, не удалять checkpoint или историю ошибок.

Источник CLI: [S: prepare-proposal, строки 19–50](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/scripts/trader/historical-simulation-v2-prepare-proposal.ts#L19).

## 2. Точное Human-подтверждение — отдельно от подготовки

**Gate B, действие оператора:** в аутентифицированной Admin Console сравнить с Gate A:

- Proposal ID, proposal digest и technical evidence digest; exact SHA, org и run.
- `launchPlan.accountId`, symbol/horizon, modeled starting cash/quantity и extent `525600…525634` / 35.
- Четыре поверхности: family/package/generation/anchor/volume receipt digests и qualification receipt digest.
- `capitalAuthority=NONE`, `liveTradingAuthority=NONE`,
  `blindHoldoutAuthority=FORBIDDEN_NOT_PRESENT_NOT_ACCESSED`.

Только после совпадения нажать **Ratify this exact proposal** один раз. Зафиксировать ID/digest ответа
ratification и проверить `Exact proposal ratified`. Эта кнопка **не запускает вычисления автоматически**:
UI прямо сообщает, что execution host теперь может выполнить finalize/bootstrap/queue/consume.
Runner не подписывает Human-решение и не подменяет operator ID. API проверяет сессию, полномочия и CSRF.

Источники: [S: ceremony, строки 248–279](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/components/trader/admin/historical-ratification-ceremony-v2.tsx#L248),
[S: ratification handler, строки 114–155](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/historical-simulation-v2/ratification-admin-handler-v2.ts#L114).

## 3. Канонический запуск утверждённой исторической цепочки

**Gate C — изменение production, только в пределах отдельного разрешения.** Не активировать его, пока
текущая научная попытка не завершена и Gate A/B не подтверждены. Проверить exact образ, release,
ресурсы, owner/0700 checkpoint directory и сохранённые файлы, активный container target и порт.
Не заменять контейнер текущего расчёта; не вводить live/HTX secrets.

**Остановиться перед этой командой, если требуется независимый повтор без новой науки.**
Текущий CLI выполняет finalize → bootstrap → consume без паузы для архива начального состояния.
Описанный в §7 export/resume wrapper ещё не реализован. Сначала необходимо реализовать и проверить
точку сохранения и весь dependency closure либо явно согласовать показ только первого run с открытым Gate E.
Не выполнять monolithic launch в надежде снять исходное состояние после него.

Проверенный шаблон существующего guarded deployment, из checkout S **на execution-server**.
Переменные ниже должны быть заранее установлены оператором по проверенным данным, не догадками.
`VERIFIED_OPERATOR_ENV_FILE` — существующий приватный файл конфигурации утверждённого historical consumer,
не произвольно выбранный proposal env. Проверить его exact org/run приватно, без вывода содержимого.

```sh
EXECUTION_SERVER_CONTAINER_NAME="${VERIFIED_CONSUMER_CONTAINER_NAME:?verify non-scientific target first}" \
EXECUTION_SERVER_HOST_PORT="${VERIFIED_CONSUMER_HOST_PORT:?verify unused consumer port first}" \
./scripts/ops/execution-server-deploy.sh \
  --target-sha 90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67 \
  --image-tag "${VERIFIED_IMAGE_TAG:?verify immutable image and release first}" \
  --operator "${VERIFIED_HUMAN_OPERATOR_ID:?authenticated Human operator required}" \
  --secrets-env-file "${VERIFIED_OPERATOR_ENV_FILE:?private approved historical runtime configuration required}" \
  --dataset-root /opt/waia/fhv-work \
  --checkpoint-root /var/lib/waia/scientific-checkpoints \
  --runtime-mode historical-v2-ratified-one-shot \
  --confirm
```

Это не read-only команда: она выполняет проверки образа/среды/хранилища, заменяет выбранный runtime container
и активирует исторический consumer. Не вызывать её «проверкой готовности». `--dry-run`/отсутствие `--confirm`
не доказывают прохождение всех фактических runtime preflight.
**`--dry-run` не отменяет `--confirm`: вместе эти флаги всё равно допускают deployment.**
Container/port задаются указанными переменными окружения, не выдуманными CLI-флагами. Target контейнера
должен быть отличен от `waia-scientific-90de233a-01`; существующее содержимое target будет заменено.
Перед запуском сверить также актуальные [Execution Surfaces](EXECUTION-SURFACES.md) и
[Execution Server Runbook, §4.1–6](EXECUTION-SERVER-RUNBOOK.md).
Источник параметров: [S: deploy, строки 7–110](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/scripts/ops/execution-server-deploy.sh#L7).

Фактическая последовательность: sealed proposal + matching Human ratification → finalization →
bootstrap durable lifecycle → queue/lease → consumer. Finalization проверяет точное соответствие
proposal/approval/extent/operator. При первой materialization повторно строится scientific candidate
для сравнения с утверждённым; уже существующая authority пропускает эту materialization.
Совместимые checkpoints могут использоваться; **мгновенное завершение и отсутствие дальнейших вычислений не обещаются**.
Этот `FINALIZATION_REPLAY` не является независимым повтором полного Forecast→Decision→Execution→accounting run.

Источники: [S: finalization, строки 599–730](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/historical-simulation-v2/ratification-split-v2.ts#L599),
[S: candidate replay, строки 2171–2205](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts#L2171).

**Gate D — первый run:** прочитать `/health` на проверенном runtime port (по умолчанию localhost:8080)
и durable lifecycle. HTTP 200/`idle`/`CONNECTED · observation only` не означают запуск.
Требуется exact release, consumer mode `historical-v2-ratified-one-shot`, затем наблюдаемая committed history
и terminal `COMPLETED`, `committedCycles=qualifiedTotalCycles=35`, без errorCode. Сопоставить scope с approved proposal.
CLI сохраняет authorityId/org/account/run/phase/counts/error в `waia.trader.historical_approved_launch_cli_result.v2`.
Повторный вызов для уже COMPLETED run возвращает существующее состояние: это idempotency, не второй эксперимент.

Источники: [S: approved launch result, строки 150–170](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/scripts/trader/historical-simulation-v2-launch-approved.ts#L150),
[S: pipeline/idempotency, строки 143–174](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/historical-simulation-v2/ratification-execution-cli-v2.ts#L143).

## 4. Независимый повтор — отдельный незакрытый acceptance gate

**Gate E сейчас НЕ доказан.** В проверенных deployed `scripts/`, `docs/ops/` не найден готовый
production runbook/driver независимого полного повтора с проверенным semantic comparator.
`tests/helpers/historical-independent-repeat.ts` допускает только свежие именованные loopback test-БД,
TEST_ONLY synthetic scenario; экспорт явно возвращает `qualification=false`, `semanticRepeatPass=false`.
Он не подходит для production-приёмки и не должен получать production connection string.

До объявления deterministic repeat PASS интегратор должен зафиксировать отдельный проверенный протокол:

1. Изолированное второе исполнение без использования уже COMPLETED lifecycle первого run;
   frozen source/data/initial knowledge/policy/economics/extent равны первому эксперименту.
2. Отдельное законное разрешение изолированного исполнения; требования scope/authority/ratification
   должны быть установлены для выбранного пути, включая сохранение canonical experiment identity по §7.
   Существующие записи и Human gates сохраняются.
   Новый run нельзя получить переименованием первого или SQL-копированием результата.
3. Полные durable evidence обоих исполнений и проверенный comparator; различия идентификаторов/времён
   допускаются только по заранее обоснованной явной нормализации, не удалением несовпавших полей.
   Сравнить Forecast/Decision/refusals/Risk/effects/accounting/outcomes/knowledge и весь extent.
4. Реальный результат сравнения и его ограничения. Checkpoint cache hit, candidate finalization,
   одинаковый PnL или два скриншота одной БД этот gate не закрывают.

Это конкретный пробел процедуры приёмки, не основание немедленно переписывать алгоритм или повторно
запускать текущую научную подготовку. Объём реализации comparator/isolated repeat ещё требует отдельной проверки.
Первую наблюдаемую репетицию можно показать честно как первый run, но полную приёмку до Gate E не объявлять.
Источник: [S: local repeat helper, строки 1–39 и 96–134](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/tests/helpers/historical-independent-repeat.ts#L1).

## 5. Admin / tenant parity: открыть до старта, проверить во время и после

**Gate F:** заполнить `<ACTUAL_MODELED_ACCOUNT_ID>` только из утверждённого proposal/lifecycle;
это не HTX account ID и не organization ID. Ниже шаблоны маршрутов, не проверенные live ссылки:

```text
https://trader.waia.life/admin/fhv-operations?campaign_run_id=fhv-v2-90de233a-rehearsal-20260908-01&organization_id=3c50b4e9-1138-43a5-a29f-e65088124cfc&release_sha=90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67
https://trader.waia.life/trader?campaign_run_id=fhv-v2-90de233a-rehearsal-20260908-01&account_id=<ACTUAL_MODELED_ACCOUNT_ID>
```

Tenant API выводит organization из аутентифицированного user (`personalOrganizationIdFromUserId`),
а не доверяет URL org. **Проверить совпадение этого org с org run до демонстрации**. Аккаунт партнёра
с другой personal organization не получает доступ к этому run одной ссылкой; не ослаблять изоляцию.
В Admin есть ссылка `Open account-scoped user observation`, уже включающая реальный account_id,
но она появляется только после возникновения account projection и не выдаёт дополнительных прав пользователю.

Проверить на одном committed cycle/ledger head и том же account (Admin aggregate может включать больше счетов):

- Автоматическое SSE либо fallback polling без Sync/refresh; actual scope, lifecycle, progress,
  last committed replay bar и journal. Времена доставки могут отличаться, экономическое состояние — нет.
- Forecast direction/confidence, Decision/refusals, Portfolio, Risk, Guardian, modeled orders/fills,
  pending orders, открытые/закрытые позиции и объяснение отсутствия сделок, если так решил алгоритм.
- Cash/equity, gross/net realized/unrealized PnL, комиссии/slippage в durable evidence;
  графики и accounting совпадают. UI drawdown — display-only по наблюдаемой истории,
  а buy-and-hold — **gross без комиссий**, не доказательство net outperformance.
- Outcome/calibration/knowledge evidence, reason journal, stages/snapshots; эффект знания только будущим циклам.
  Нет обещания завершённого адаптивного самообучения. Не форсировать сделки ради демонстрации.
- После `COMPLETED` проверить все 35 committed cycles и retained pending/open state: конец реплея
  сам по себе не доказывает закрытие всех позиций. Если жизненный цикл открытия/закрытия не встретился,
  соответствующий критерий не объявлять проверенным.

Источники: [S: Admin routing](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/app/%28trader%29/admin/fhv-operations/page.tsx#L11),
[S: tenant scope, строки 9–19](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/app/api/trader/historical-v2/stream/route.ts#L9),
[S: dashboard, строки 27–49](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/components/trader/historical-v2-observation-dashboard.tsx#L27),
[S: chart limitations](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/components/trader/historical-v2-account-charts.tsx#L9).

Admin URL выбирает org/run, а не фильтрует account. Сопоставлять нужно карточку точного modeled account.
До появления projection ссылку tenant собирать из проверенного `proposal.launchPlan.accountId`.

## 6. Что передать в Linear после фактического выполнения

Для каждого Gate A–F: `NOT CHECKED / PASS / FAIL`, время наблюдения UTC, exact deployed SHA,
org/run/account, request/proposal/ratification/authority IDs и digests, exit/error, counts,
прямые проверенные ссылки обеих панелей и путь к приватному evidence packet без секретов.
Отдельно: первый run, independent repeat и интерфейсная приёмка. Не закрывать DEE-920 по одному CLI exit0.
Историческая приёмка не выдаёт live authority, не разрешает реальный капитал и не доказывает прибыльность.

Проверка этого документа: ссылки/параметры сверены с S; перечисленные исторические source files
не изменены между S и M, кроме `components/trader/trader-workspace.tsx` (добавления наблюдения
DEE-960/961 требуют отдельного review и не используются как доказательство deployed historical PASS).
Ни один production/scientific запуск, Human ratification или gate результата этим документом не выполнен.

## 7. Минимальный следующий пакет: independent-repeat protocol, пока только проект

### Что уже есть и чего нет

| Возможность | Проверенный код S | Предел |
| --- | --- | --- |
| Отдельный authenticated request для нового run | `ratification-split-v2.ts:216–267`; Admin handler | Request фиксирует extent, но **не принимает account/initial knowledge и не клонирует состояние**. |
| Новый modeled account в launch plan | `ratification-execution-cli-v2.ts:78–114`; `production-first-cycle-bootstrap-v2.ts:1153–1180` | Account задаётся серверной конфигурацией до отдельного Human-подтверждения exact proposal. Это не reuse исходного approval. |
| Пустое исходное forecast-outcome knowledge | `production-first-cycle-bootstrap-v2.ts:1084–1097`; `knowledge-snapshot-binding-v2.ts:266–285` | Проверяется run-scoped resolved evidence. Prerun scientific knowledge остаётся отдельно авторизованным; нельзя копировать конечное knowledge первого run как начальное. |
| Accounting inception | `accounting-inception-v2.ts:184–235` | Новый исходный frontier из starting cash; существующий должен совпасть byte-for-byte. Нет API reset/delete старого run. |
| Научные checkpoints | `scientific-checkpoint-store-v1.ts:83–105,129–178` | Ключ = format/release/Node version/OS/arch/stage/**полный input**; HMAC и payload проверяются. Наличие директории не доказывает hit. |
| Повтор полного production run и comparator | Не обнаружены в проверенных `scripts/`, `docs/ops/` | Нужен отдельный ограниченный пакет, не переименование synthetic helper. |

### Почему новый run не обеспечивает «никакой повторной науки»

В [S: scientific surface builder, строки 1526–1612](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts#L1526)
`evaluationPartitionReceiptDigestHex` включает `runId`; этот digest входит в ключ `wf-forecast-batch-v1`
и anchor IDs. `comparisonFamilyId=wf-predictive:<runId>:<surface>` вместе с partition digest входит
в `wf-predictive-terminal-v1`. Смена run означает другие inputs и cache miss для этих стадий.

Это не просто имена файлов: [S: harness trial identity](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1.ts#L76)
включает comparison family, partition и anchor set; trial digest передаётся в validation bootstrap
на строках 195–200. Поэтому новый run не является буквальным повтором того же статистического испытания.
Кэш package/KM может быть совместим при совпадении **всех** своих inputs, но это не компенсирует WF misses.
Источник KM input и cache stages: [S: KM bootstrap, строки 139–144 и 384–411](https://github.com/oumaster369/waia/blob/90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2.ts#L139).

**Вывод:** существующий separately-ratified новый run доступен как путь нового эксперимента,
но не отвечает требованию гарантированного reuse всей научной подготовки. Нельзя вырезать runId из ключа,
переподписать старые receipts или изменить trial seed в рамках документации/малого comparator-пакета.

### Предпочтительный кандидат на реализацию: независимое состояние, та же идентичность эксперимента

Это **проект**, не готовый инструмент и не выданное разрешение на экспорт/импорт или второй запуск.
Минимум научных изменений даёт отдельная изолированная БД и процесс с теми же source/data/org/run/account,
экономикой и начальным состоянием, а не новый run в текущей production-БД. Изоляция обозначается отдельным
`replay_attempt_id` в операторском evidence envelope, **не** изменением canonical run identity.

1. **До первого economic bootstrap:** после завершения подготовки и законной Human ratification/finalization
   определить и сохранить согласованный initial-state archive. Это отдельная заранее проверенная точка
   между finalization и bootstrap: текущий approved-launch CLI проходит её автоматически и такого экспортного
   checkpoint API не предоставляет. Нужен маленький операторский orchestration wrapper над настоящими
   exported production functions, без TEST_ONLY dependencies и без изменения алгоритма S.
2. Экспортировать только полный необходимый граф исходных authority/proposal/ratification/dataset/scientific
   records и зависимостей, не credentials/пользовательские профили/все production-схемы с данными.
   **Allowlist и FK/semantic dependency closure ещё нужно определить и проверить**; список synthetic helper
   не объявляется достаточным. Архив обязан исключить экономические результаты и resolved outcomes будущих циклов.
3. Отдельно Human-разрешить изолированное replay существующего exact утверждённого эксперимента.
   Сохранённые реальные ratification/authority bytes не подделываются и не означают автоматически разрешения
   новой среды. Не создавать фиктивное подтверждение оператором; если действующий контракт требует нового
   ratification event/среды, сначала реализовать этот шаг через настоящий authenticated gate.
4. Восстановить архив в новую выделенную БД с той же схемой и constrained LOGIN/RLS; доказать отсутствие
   run-start/lifecycle/lease/resume/economic results, отсутствие live credentials и невозможность подключиться
   к production из replay worker. Сначала тестировать только на синтетической PostgreSQL 17.
5. Запустить новый процесс с exact immutable image S, теми же runtime/data inputs и приватным проверенным
   checkpoint store. Управляющий wrapper — отдельно версионируемый артефакт, не новый подменённый source SHA.
   Новая сборка алгоритма с другим SHA несовместима с обещанием всех старых cache keys.
6. До разрешения старта добавить **read-only cache compatibility inventory и fail-on-miss режим** для нужных
   стадий, если требуется строго исключить новую науку. Сейчас `evidence/evidenceAsync/package` при miss
   вызывают build; такого режима нет. Не менять default и не считать входы совместимыми по частичному digest.
   Доставка нового cache-adapter к exact S также требует проверки неизменности научной семантики; это ещё gap,
   а не гарантированная возможность использовать новый код под старым SHA.
7. Сравнить независимые durable outputs с первым run; не объединять изолированное replay с production panels.
   Admin/tenant production parity первого run проверяется Gate F, а replay получает отдельный отчёт сравнения.

Если initial-state archive не был снят до первого исполнения, нельзя «вернуться в начало» удалением результатов.
Требуется доказанный реконструктор исходного графа из immutable provenance либо новое честно обозначенное
испытание с возможным перерасчётом. До определения этих зависимостей оценка срока/числа файлов не подтверждена.

### Минимальный comparator — fail closed, без ослабления сравнения

Отдельный offline reader принимает **два приватных bounded evidence archives**, не DB credentials.
Сначала проверяет версии схем, manifest hashes, exact source/runtime/data/config/extent/initial-state identity,
scope, chain/FK consistency, уникальность и полный набор всех 35 циклов. Raw evidence хранится неизменно.

- Сначала проверяется целостность исходных sealed payloads/ссылок для каждого run; затем сравнение.
  Нельзя исключить несовпавший digest и назвать оставшиеся числа эквивалентными.
- При одинаковой experiment identity сравнивать canonical semantic payloads и digests точно, где контракт
  гарантирует детерминизм. Политика для случайных DB row IDs / wall-clock metadata должна быть перечислена
  **по конкретному table/schema/field**, с проверкой соответствия ссылок, а не общим удалением `id/*Digest/*At`.
- PIT/time cutoffs, цены, decimal strings, confidence/probabilities, quantity/cost/slippage, ordering,
  Decision/Risk reasons, fills/accounting/outcome/knowledge остаются значимыми. Ни floating tolerance,
  ни округление, ни перемешивание массивов по умолчанию не разрешены.
- Неизвестный field/schema, отсутствующий stage, отличающийся authority graph, частичный экспорт,
  недостаточное покрытие normalization rules → `UNSUPPORTED`/`FAIL`, никогда `PASS`.
- Тесты до production: независимые одинаковые synthetic runs; изменение каждого значимого типа поля
  должно вызвать FAIL; missing/duplicate cycle, лишний field, future knowledge, corrupt seal, wrong scope,
  один и тот же completed snapshot вместо двух executions должны быть отвергнуты.

**Следующее решение интегратора:** сначала реализовать и проверить inventory/export boundary/comparator
на synthetic полном production path, после этого согласовать отдельное изолированное выполнение.
Не менять текущий science process, не делать новый proposal и не обещать пропуск расчёта сейчас.

## 8. Локальная сверка экспортов DEE-980

`compareHistoricalPanelExportsV2(adminJson, tenantJson, expected)` в
`lib/trader/historical-simulation-v2/panel-comparison-v2.ts` сравнивает два JSON-экспорта
завершённого single-account run. `expected` содержит organizationId/runId/accountId,
initialRecordIndex/totalCycles из утверждённого плана. Экспорты необходимо получить через
реальные аутентифицированные пути соответствующих панелей; эта pure-функция их не загружает.
Для Admin поддерживается только доказанно одноаккаунтный run: существующий Admin route
не имеет account-фильтра. Вручную вырезать чужие счета/агрегаты из JSON и выдавать результат
за исходный export нельзя. Дополнительный account-scoped Admin endpoint здесь не реализован.

Только root observedAt/eventId исключаются как transport metadata. Всё прочее сравнивается
точно, включая lifecycle timestamp/digest, историю, причины, accounting и knowledge.
Статусы MATCH/DIFFERENT/REFUSED относятся исключительно к переданным проекциям.
MATCH не проверяет подлинность источника, sealed научные доказательства, actual execution,
UI/stream freshness, independent repeat и не даёт readiness или capital authority.
Одинаковые поддельные экспорты не превращаются в доказательство прохождения теста.
Повторяющиеся JSON-ключи и числовые записи, изменяющиеся при стандартном round-trip
JSON.stringify(Number(token)), отвергаются до JSON.parse. Это предотвращает тихую потерю
сведений при сравнении; десятичные экономические строки никогда не переводятся в Number.
Размер ограничен 32 MiB на экспорт; depth96,500000values,2000000tokens,1000cycles. Превышение — REFUSED,
не повод обрезать журнал для получения MATCH.
