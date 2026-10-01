# Независимый аудит AI-TRADER: путь до ордера HTX

**Дата:** 2026-09-29  
**База:** `main` @ `8cae38cb` (`DEE-1135 fix(risk): refuse stale allowance replay on the fresh clock`, PR #697)  
**Предки в том же окне:** PR #695 `9d3ad829` (LiveCapitalEnvelopeV2, миграция 0226), PR #696 `85cbfef1` (noncapital domain ownership, миграции 0224/0225)  
**Режим:** только чтение репозитория. Код, секреты и сеть биржи не трогались.

Это аудит готовности пути «решение стратегии → ордер на HTX» для live и paper. Он не заменяет Human-решение о включении live и не является разрешением включать `trader_org_live_enable`.

## Вердикт

**К первому маленькому live в одной организации (Org0) система не готова.** Включение строки `ENABLED` в `trader_org_live_enable` само по себе ордер на HTX не отправит: production-оркестраторы не вызывают Execution V2, а легаси-`submitOrder` жёстко возвращает `execution_v2_required`.

Это сейчас **fail-closed** (случайный live-ордер из воркера и live CLI не уходит). Тот же разрыв станет опасным, если V2 подключить «как есть»: допуск, bind и единственный `placeOrder` **не читают** LiveCapitalEnvelopeV2, не читают `trader_kill_switches`, не проверяют Org0 / EFFECTIVE / trade-permission внутри транзакции bind, а успешный HTTP-ответ HTX **всегда** классифицируется как неизвестный исход и застревает в терминальном `RECONCILIATION_REQUIRED`.

PR #695–#697 закрыли отдельный слой: свежие часы допуска, однократный резерв при реплее, терминализация только «негодной самой по себе» строки, публикация конверта с повторным решением по `clock_timestamp()`. Этот слой **не стоит на пути ордера**.

## Как читался путь

Прослежены вызовы, а не описания PR.

| Шаг | Где живёт | Кто вызывает в production |
| --- | --- | --- |
| Сигнал стратегии | `lib/trader/intelligence/evaluation-cycle.ts` | paper loop / live CLI |
| Канонический капитал V2 | `runDecisionCapitalAuthorityV2` в `lib/trader/runtime-v2/decision-capital-authority-v2.ts` | live CLI только если передан `decisionCapitalAuthorityV2`; иначе стоп |
| Выдача допуска | `admitRiskAllowanceV2Postgres` | тесты и FHV-харнесс, не фабрика воркера |
| Bind ордера | `bindExecutionAuthorityV2Postgres` | только из `createPostgresExecutionV2Service` |
| Сеть | `submitCommittedAttemptToConnectorV2` → `connector.placeOrder` | сервис V2 нигде не создаётся |
| Легаси submit | `OrderExecutionService.submitOrder` | paper worker и live CLI; выходит до коннектора |

Единственное production-место `connector.placeOrder` — `lib/trader/execution/v2/connector-dispatch.ts:31-46`. `createPostgresExecutionV2Service` (`:57`) в репозитории больше нигде не вызывается.

## Сводка

| Severity | Смысл | Число |
| --- | --- | --- |
| P0 | Блокирует первый live | 5 |
| P1 | Дыра в уже написанном пути или в эксплуатации миграции | 5 |
| P2 | Латентный или операционный дефект | 5 |
| P3 | Ужесточение, не самостоятельный обход | 4 |
| **Всего** | | **19** |

## P0

### P0-1. Production не доходит ни до допуска, ни до HTX

**Где:** `lib/trader/execution/execution-service.ts:126-128`, `:776-781`; `lib/trader/paper/build-worker-deps.ts:113-116`; `lib/trader/live/run-live-cycle.ts:204-213`; `lib/trader/execution/v2/connector-dispatch.ts:57-76`.

**Сценарий.** Paper cron собирает `createPostgresOrderExecutionService` и mock-коннектор, без `decisionCapitalAuthorityV2`. Любой `submitOrder` сразу возвращает `execution_v2_required` / `LEGACY_ORDER_SUBMISSION_DISABLED`. Live CLI без внедрённого authority возвращает `decision_v2_authority_missing` и не строит запрос. Флаг org live enable на этот ранний выход не влияет.

**Как увидеть.** Вызов paper loop или `runLiveCycleOnce` без V2-deps: в результате нет `placeOrder`. Поиск `createPostgresExecutionV2Service(` даёт только объявление.

**Рекомендация.** Не включать live, пока не появится одна org-scoped фабрика: решение → `admitRiskAllowanceV2Postgres` → `createPostgresExecutionV2Service.submit` с live-хуком. Легаси-заглушку не снимать, пока эта фабрика не проходит гейты из раздела «До включения».

### P0-2. LiveCapitalEnvelopeV2 не ограничивает допуск и bind

**Где:**  
- публикация и read-gate: `lib/trader/risk/v2/live-capital-envelope-postgres.ts:406-417`, `:529-576`, `:579-594`;  
- суммы только пишутся: `live-capital-envelope-v2.ts:42-43`, `live-capital-envelope-postgres.ts:310-316`;  
- лимит допуска — поле состояния счёта, не конверт: `lib/trader/risk/v2/risk-admission-service-v2.ts:38-45`, вызов `:675-681` в `risk-allowance-repository-postgres.ts`;  
- bind не вызывает gate: `lib/trader/execution/v2/authority-postgres.ts:195-213`;  
- классификатор старого указателя никогда не бывает текущим: `lib/trader/risk/v2/risk-current-account-read-v1.ts:8-15`;  
- current-account admission отказывает, пока `authority.current !== false`, а этот флаг не выставляется: `risk-admission-service-v2.ts:109-127`.

**Сценарий.** Оператор публикует конверт на $10 и лимит потерь $2. `trader_risk_account_state_v2.exposure_limit_notional` при инициализации может быть другим. `admitRiskAllowanceV2Postgres` считает остаток только по этому полю плюс экспозиция и резервы. `capitalNotional` / `lossLimitNotional` в `lib/trader/risk` дальше записи конверта не читаются. `gateLiveCapitalIssueV2` / `gateLiveCapitalStartV2` / `gateCurrentAccountExecutionBindV1` вызываются из тестов и из `refuseProfileBackedExecutionV1`, не из bind/dispatch.

**Как увидеть.** `tests/integration/postgres-live-capital-envelope-v2.test.ts` гоняет продюсер и гейт напрямую. `tests/integration/postgres-execution-v2.test.ts` биндит допуск без конверта. Нет теста «опубликованный конверт $10 режет допуск при лимите счёта $1_000_000».

**Рекомендация.** В той же транзакции, что лок счёта и consume, перечитывать `readLiveCapitalBasisAdmissionV2` и отказывать, если нет `BASIS_BOUND` или если `exposureLimitNotional` не равен запечатанному `capitalNotional` (и отдельно учитывать `lossLimitNotional`). Пока этого нет, конверт — журнал намерений, не лимит ордера.

### P0-3. Kill-switch не попадает в состояние, которое читает V2

**Где:** проверка V2 — `risk-allowance-repository-postgres.ts:666-673` и `:1264-1272` (`killState !== "CLEAR"`). Запись `kill_state` в `lib/` есть только при инициализации счёта (`:484` в составе входного состояния). Каталог `lib/trader/risk/kill-switch/` таблицу `trader_risk_account_state_v2` не обновляет. Резолвер живого kill-switch вызывается из `assert-live-path-authorized.ts:105-108` и легаси risk engine, не из `bindExecutionAuthorityV2Postgres` / `dispatchCommittedExecutionAttemptV2`.

**Сценарий.** Админ переводит `trader_kill_switches` в blocked. Строка счёта остаётся `kill_state = 'CLEAR'`, posture не становится `KILLED`. Если V2 уже подключён, выдача и bind проходят. Тесты V2 сами делают `UPDATE ... SET kill_state = 'TRIPPED'` и поэтому зелёные, не проходя через сервис kill-switch.

**Как воспроизвести.** Интеграционный тест: trip через kill-switch service, затем `admitRiskAllowanceV2Postgres` / bind без ручного `UPDATE`. Ожидаемый сегодня исход — допуск не видит trip.

**Рекомендация.** В одной транзакции с trip писать `kill_state` / posture, которые читает допуск, и вызывать тот же резолвер внутри bind и непосредственно перед POST.

### P0-4. Org live enable, Org0, EFFECTIVE и право trade не стоят внутри bind

**Где:** композитный гейт `createAssertLivePathAuthorized` — `lib/trader/live/assert-live-path-authorized.ts:76-165` (режим live, `isOrg0Organization`, `state === "ENABLED"`, `assertStrategyLiveAuthorized`, kill-switch, потолок, `permissionMetadata` со scope `trade`, health хоста). V2 вызывает другой контракт: `connector-dispatch.ts:60-76` — опциональный `(context, BindExecutionAuthorityV2Input) => Promise<void>`. Без хука live бросает `Execution V2 live path is not authorized`. С хуком проверка происходит **до** транзакции bind и не повторяется в ней. `bindExecutionAuthorityV2Postgres` эти таблицы не читает. Легаси-`submitOrder` до гейта не доходит (`execution-service.ts:776` раньше `:929`).

Сигнатуры не совпадают: хук легаси ждёт `SubmitOrderInput` + `strategyId` (`assert-live-path-authorized.ts:168-188`), V2 передаёт `BindExecutionAuthorityV2Input`. Прямая подстановка не компилируется; «тонкий» адаптер легко потеряет promotion, credential и потолок.

Потолок и так условный: `maxNotionalCap` сравнивается только если `riskDecision != null` (`assert-live-path-authorized.ts:110-130`). Вызов без решения риск-движка пропускает и org cap, и org risk max.

**Сценарий.** После наивного wiring live-ордер Org0 уходит без повторной проверки EFFECTIVE-версии и без `requireHtxStoredPermissionMetadata`, если адаптер вернул resolve. Чужая организация не режется внутри bind, только если адаптер вызвал `isOrg0Organization`.

**Как увидеть.** Нет production-вызова `createAssertLivePathAuthorized` из `lib/trader/execution/v2/**`. Тесты гейта — `tests/unit/trader-live-authorization-gate.test.ts` — бьют в легаси-функцию, не в bind.

**Рекомендация.** Сделать один адаптер и вызывать его проверки повторно под локом счёта в bind: org0, `ENABLED`, EFFECTIVE с той же `strategyVersion`, активный HTX credential со scope `trade`, положительный `maxNotionalCap` против нотионала ордера. Отсутствие `riskDecision` должно отказывать, а не пропускать потолок.

### P0-5. Успешный ответ HTX не становится принятым ордером, а неопределённость нечем закрыть

**Где:** `lib/trader/connectors/htx/htx-exchange-connector.ts:304-412` — один POST без ретрая, затем **всегда** `HtxPlacementFailUnknownError`, в том числе после прочитанного тела (`:406-412`). Комментарий в коде: ack HTX не доказывает client id, цену, количество и филлы, повторный GET не ратифицирован.  
Диспетчер пишет `CONNECTOR_UNCERTAIN` + `RECONCILIATION_REQUIRED`: `lib/trader/execution/v2/recovery-postgres.ts:265-281`.  
Жизненный цикл попытки из `RECONCILIATION_REQUIRED` никуда не переходит: `lib/trader/execution/v2/repository-postgres.ts:84`.  
Ордер вставляется как `CREATED` и V2 его состояние не двигает: `lib/trader/execution/repository-postgres.ts:304`; dispatch сверяет только `CREATED` | `RISK_APPROVED` (`authority-postgres.ts:490`). Резерв при consume списывается из outstanding и на `RECONCILIATION_REQUIRED` не возвращается.

**Сценарий.** После подключения V2 первый POST с HTTP 200 создаёт ордер на HTX и в WAIA оставляет попытку навсегда в сверке, строку `trader_orders` в `CREATED`, резерв занятым. Повторный dispatch видит не `BOUND` и не шлёт второй POST (`authority-postgres.ts:406-410`, `:536-547`) — это защищает от дубля, но не принимает и не отменяет биржевой ордер. Внимание админки ищет `trader_orders.state = 'RECONCILIATION_REQUIRED'` (`lib/trader/admin-console/handlers/attention.ts:81-89`) и эту попытку не показывает. Детерминированный отказ биржи (4xx) попадает в ту же ловушку: капитал занят, позиция на бирже может уже быть.

**Как увидеть.** Юнит `tests/unit/trader-connector-htx.test.ts` ожидает fail-unknown на `placeOrder`. Нет production-воркера, который по `client-order-id` дописывает `VENUE_ACCEPTED` / `VENUE_REJECTED` и отпускает резерв. `appendExecutionReportV2` с типом `VENUE_ACCEPTED` есть только в `recovery-postgres.ts` на ветке, куда HTX-коннектор не возвращает `Order`.

**Рекомендация.** До Org0 нужен ратифицированный контур сверки: один раз прочитать ордер HTX по детерминированному `client-order-id`, записать точное свидетельство или доказуемый reject и вернуть резерв. Пока контура нет, даже «маленький» live оставляет бесхозный ордер на бирже. Поглощающее состояние без алерта для этого недостаточно.

## P1

### P1-1. Между коммитом `SUBMIT_STARTED` и POST нет повторного kill / live-enable

**Где:** `lib/trader/execution/v2/authority-postgres.ts:387-392`, `:508-547`. Ревалидация допуска смотрит `killState` счёта, не `trader_kill_switches` и не `trader_org_live_enable`.

**Сценарий.** Транзакция коммитит `SUBMIT_STARTED`, затем сеть вне транзакции. Trip или `DISABLED`, пришедшие в этот зазор, POST не отзывают. Для неопределённого ответа это задумано («recovery must reconcile without resend»), но предсетевая проверка резолвера отсутствует, поэтому зазор начинается ещё до сокета.

**Тест.** Конкурентный trip против `dispatchCommittedExecutionAttemptV2` в `tests/integration/postgres-execution-v2.test.ts` не описан.

**Рекомендация.** Последним чтением под локом, сразу перед возвратом `READY`, требовать CLEAR + org `ENABLED` + свежий конверт. После коммита ордер только сверять, не слать снова.

### P1-2. Наблюдаемость V2 не показывает неопределённый live-эффект

**Где:** в `lib/trader/execution/v2/**` нет telemetry sink (у легаси он есть в `execution-telemetry.ts` и не достигается из-за P0-1). Админ-очередь — `attention.ts:81-89` по `trader_orders.state`. Отчёты V2 пишутся в `trader_execution_reports_v2`.

**Сценарий.** Оператор смотрит Attention и видит пусто, пока на HTX висит ордер, а попытка в `RECONCILIATION_REQUIRED`.

**Рекомендация.** Алерт на `SUBMIT_STARTED` без последующего терминала и на `CONNECTOR_UNCERTAIN`, ключ — `execution_attempt_id`, не только `trader_orders.state`.

### P1-3. Миграция 0225: `ACCESS EXCLUSIVE` и `lock_timeout`, который не покрывает файл

**Где:** `db/migrations_postgres/0225_trader_noncapital_domain_ownership_v1.sql:9-23`.

`SET LOCAL lock_timeout = '5s'` и `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` разделены `--> statement-breakpoint`. Drizzle выполняет куски отдельно. `SET LOCAL` живёт только внутри транзакции; вне явного `BEGIN` он не держит таймаут для следующих `ALTER`. Сам `LOCK` в отдельном куске берёт эксклюзив и отпускает на коммите этого куска. Дальнейшие `ALTER` / `ADD CONSTRAINT` снова берут `ACCESS EXCLUSIVE` уже **без** пятисекундного предела и могут ждать писателей неограниченно.

Лок на 12 таблицах noncapital (записанный анализ, research application/understanding, lease history, noncapital cycles). Таблицы ордеров в этот список не входят, но стоп писателей этих доменов на время миграции обязателен. Комментарий в файле это говорит; таймаут из первой строки этого не гарантирует.

0226 (`db/migrations_postgres/0226_trader_live_capital_envelope_v2.sql`) — `CREATE TABLE` четырёх новых таблиц, FK на `organizations` (короткий `ShareRowExclusiveLock`), RLS `USING (false)`, `REVOKE ALL` у `PUBLIC` / `anon` / `authenticated` (`:119-142`), триггер append-only. `ALTER` существующих торговых таблиц нет. Суммы `NOT NULL` без `DEFAULT` (`:29-30`) — это правильно для «нет молчаливого капитала», не опасно для старых строк, потому что таблица новая.

**Рекомендация.** 0225 применять только при остановленных писателях этих таблиц. Если миграция ещё не накатана на среду, выставить `SET lock_timeout` на сессию на весь файл, а не `SET LOCAL` в первом breakpoint. Не совмещать это окно с первым live.

### P1-4. Execution host не является хостом live-ордера, а health-контракт с гейтом расходится

**Где:** `services/ai-trader-execution-host/entrypoint.mjs:16-28` (запрещены live-ключи и `WAIA_TRADER_LIVE_ENABLED`), режим только `idle` или historical consumer (`:40-41`). Health: idle → `status: "installed"`, не `"ok"` (`:111-117`). Гейт live требует `body.status === "ok"` (`lib/trader/live/execution-host-health.ts:12-19`). `"ok"` означает запущенный historical consumer, не постановку ордеров.

**Сценарий.** Live-гейт при пустом `WAIA_TRADER_EXECUTION_HOST_URL` или idle-хосте закрыт (`ExecutionHostUnavailableError`) — это безопасно и одновременно ложно успокаивает: зелёный historical host не доказывает, что ордер пойдёт через V2. Хост observation читает HTX и ордера не ставит.

**Рекомендация.** Не считать health execution host критерием готовности Org0. Критерий — фабрика из P0-1 на процессе, которому разрешены торговые ключи и который не является historical runner.

### P1-5. Публикация конверта игнорирует квалификацию источника

**Где:** `decideLiveCapitalEnvelopePublicationV2` делает `void input.sourceMethodQualified` (`lib/trader/risk/v2/live-capital-envelope-v2.ts:166`). Продюсер всегда передаёт `sourceMethodQualified: false` (`live-capital-envelope-postgres.ts:326-329`). Решение — организация, счёт, policy digest, release SHA и окно `validFrom`/`validUntil` по часам БД.

**Сценарий.** Конверт публикуется без признака, что снимок счёта HTX квалифицирован. Для журнала это честно (флаг не притворяется разрешением). Для будущего read-gate это дыра: `BASIS_BOUND` не означает «источник счёта пригоден».

**Рекомендация.** Либо удалить мёртвый аргумент и явно записать, что квалификация источника — отдельный будущий отказ, либо отказывать в `PUBLISHED`, пока метод не квалифицирован. Не трактовать `BASIS_BOUND` как право на ордер (сейчас код так и не трактует — см. P0-2).

## P2

### P2-1. Тот же `commandId` после первого `INVALIDATED` нельзя опубликовать

**Где:** `live-capital-envelope-postgres.ts:253-254`. Повтор любого stage для команды с журналом `INVALIDATED` возвращает отказ, не пересчитывая решение. Это уже записанный follow-up PR #695.

**Сценарий.** Первая публикация видит чужой policy/release и пишет терминал. Повтор с исправленным observed тем же `commandId` остаётся мёртвым. Новый UUID проходит. Это не двойной ордер, это операционная ловушка.

**Тест.** `tests/integration/postgres-live-capital-envelope-v2.test.ts` фиксирует идемпотентный отказ.

**Рекомендация.** Оставить терминал для просрочки. Для отказа «ещё не было current» либо не писать `INVALIDATED` до появления current, либо документировать обязательную смену `commandId` в runbook Org0.

### P2-2. Проигравший гонку конвертов не получает терминальную запись

**Где:** `live-capital-envelope-postgres.ts:354-355` и `:374-379` — `OVERLAPPING_AUTHORITY` с `invalidated: false`, если current уже у другого `commandId`.

**Сценарий.** Два `produceLiveCapitalEnvelopeV2` на один счёт. Победитель публикует. Повтор проигравшего упирается в `STAGE_ALREADY_COMMITTED` / `OVERLAPPING_AUTHORITY` без понятного терминала.

**Тест.** Гонка в `postgres-live-capital-envelope-v2.test.ts` (проигравший `invalidated: false`).

**Рекомендация.** Писать `INVALIDATED` проигравшему, когда current принадлежит другой команде.

### P2-3. Общий HTX-клиент ретраит POST; боевой `placeOrder` коннектора — нет

**Где:** обход — `htx-exchange-connector.ts:342-343` (сырой `placementFetch`, один запрос). Ретрай — `lib/trader/connectors/htx/transport.ts:57-110` (429 / 5xx / `TypeError`) и `client.ts:399-416` (`signedRequest` ещё раз крутит rate-limit envelope). `HtxRestClient.placeOrder` (`client.ts:127-165`) идёт через `signedPost`. Из `lib/` этот метод не вызывается; граф потребителей это запрещает. `HtxExchangeConnector.cancelOrder` вызывает `this.client.cancelOrder` (`htx-exchange-connector.ts:415-422`), то есть отмена **ретраится**.

**Сценарий.** Если кто-то вызовет `client.placeOrder` (скрипт, будущий адаптер), повтор POST после потерянного 200 даст второй ордер, если биржа не дедуплицирует `client-order-id`. Отмена с ретраем обычно безопаснее, но при неоднозначном теле можно учесть отмену дважды в локальном состоянии.

**Рекомендация.** Оставить единственный write-путь на `HtxExchangeConnector.placeOrder`. Запретить `client.placeOrder` линтером так же жёстко, как `connector.placeOrder` вне dispatch. Отмену live вести тем же правилом «один POST, дальше сверка».

### P2-4. Paper-цикл тоже не на V2

**Где:** `lib/trader/paper/build-worker-deps.ts:113-135` — легаси execution + mock. Канонический paper-путь в `runPaperCycleOnce` требует deps, которых воркер не собирает.

**Сценарий.** Cron не ставит и paper-ордер V2. Это не утечка на биржу (коннектор mock, submit всё равно заглушен), но paper перестаёт быть репетицией live: гейты допуска на cron не исполняются.

**Рекомендация.** Сначала провести paper через ту же фабрику V2 с mock-коннектором и теми же отказами (kill, просрочка допуска, конверт), и только потом менять коннектор на HTX.

### P2-5. Ключ с правом trade можно сохранить без live enable

**Где:** выдача права на использование — `assert-live-path-authorized.ts:133-159` и `lib/trader/security/htx-credential-types.ts:111-119` (`read` обязателен, `trade` обязателен только для purpose `trade`). Хранение — `CredentialService` (`lib/trader/credentials/credential-service.ts`, envelope AES-GCM в `lib/trader/credentials/envelope-crypto.ts:112-150`, DEK wrap AES-GCM в `lib/trader/security/dek-wrap-crypto.ts`). Расшифровка закрыта, если master key не production-ready (`lib/trader/security/credential-storage-gate.ts`). В логах нормального пути ключ маскируется. Paper-ордер не требует credential id.

**Сценарий.** Организация кладёт боевой ключ HTX, пока live выключен. Сегодня второй путь расшифровки в ордер не ведёт (P0-1). Объём ущерба вырастет, если появится новый вызывающий `getDecryptedCredentials` без гейта purpose=`trade`.

**Рекомендация.** Перед Org0 проверить, что master key — production provider, в `permission_metadata` ровно нужный spot account, scope `trade` есть только у ключа этой организации, execution host этот ключ не видит (у него deny-list уже есть). Отдельный класс ключа «observe» vs «trade» снижает риск следующего адаптера.

## P3

### P3-1. Конверт принимает канонический `"0"`

**Где:** `riskAccountDecimalSchemaV1` разрешает `>= 0` (`lib/trader/risk/v2/risk-account-source-profile-v1.ts:25-28`). Конверт использует его и для капитала, и для лимита потерь (`live-capital-envelope-v2.ts:42-43`). CHECK в 0226 — только длина строки. Org live enable при этом отвергает cap `<= 0` (`org-live-enable-service.ts:75-79`).

**Сценарий.** Команда с `"0"` печатается и может стать `PUBLISHED`. Пока суммы не на пути ордера (P0-2), это не размер позиции. После подключения ноль должен быть отказом, а не «безлимитом» и не молчаливым нулём без алерта.

**Рекомендация.** `> 0` в Zod и в CHECK. Не копировать семантику «0 = не задано».

### P3-2. Advisory lock конверта — `hashtext` на int4

**Где:** `pg_advisory_xact_lock(1145, hashtext(org || ':' || account))` — `live-capital-envelope-postgres.ts:161-162`. Коллизия сериализует два счёта (доступность), не снимает лок. Лок конверта и row-lock `trader_risk_account_state_v2` — разные пространства; гонка между ними важна только после проводки P0-2, и лечится общим порядком в одной транзакции.

### P3-3. Часы: секунды HTX, `transaction_timestamp` у отчёта сверки

**Где:** подпись HTX обрезает миллисекунды (`lib/trader/connectors/htx/signing.ts:16-17`). Допуск и bind берут `clock_timestamp()` после лока (`risk-allowance-repository-postgres.ts:391-400`, `authority-postgres.ts:88-92`). Отчёт V2 пишет `transaction_timestamp()` (`recovery-postgres.ts:190-193`) — время старта транзакции, не момента записи, если транзакция ждала. `validForMs` допуска ограничен 1…300_000 (`risk-allowance-repository-postgres.ts:558`). Таймаут POST по умолчанию 30 с (`htx-exchange-connector.ts:331`).

**Сценарий.** Сильный skew часов процесса против HTX даёт отказ подписи, не двойной ордер (ретрая POST нет). Skew часов БД против биржи двигает `validUntil` относительно биржевого времени; окно допуска короткое, это смягчает, но не заменяет NTP.

**Рекомендация.** На процессе, который когда-нибудь вызовет POST, мониторить offset к NTP. Для `observedAtUtc` отчётов использовать тот же `clock_timestamp()`, что и у допуска.

### P3-4. `KILL_SWITCH_TRIPPED` в allowlist терминализации почти недостижим

**Где:** `issuedAllowanceRefusalTerminalizesStoredRowV2` включает `KILL_SWITCH_TRIPPED` (`risk-allowance-repository-postgres.ts:1042-1053`). Фактический отказ bind при `killState !== "CLEAR"` — `CURRENT_AUTHORITY_BINDING_MISMATCH` (`:1264-1272`), и он в allowlist есть, строка терминализуется. Код `KILL_SWITCH_TRIPPED` возвращает posture `KILLED` (`protective-posture-v2.ts:145`), но kill-switch туда posture не переводит (P0-3).

**Рекомендация.** Когда trip начнёт писать posture, проверить, что причина на bind — одна, и что тест бьёт в сервис, а не в ручной `UPDATE`.

## Что #695–#697 сделали правильно

Это не «готово к live», но слой допуска и конверта сам по себе собран fail-closed. Ниже — то, что код делает, и чем это покрыто.

| Инвариант | Где | Тест |
| --- | --- | --- |
| Повторный admit той же ISSUED-строки не считает её резерв дважды | `risk-allowance-repository-postgres.ts:634-657` | `tests/integration/postgres-risk-v2.test.ts` |
| Чужой резерв остаётся в outstanding и режет повтор | там же | тот же файл, кейс foreign reservation |
| Настоящий отказ реплея (kill/сверка/posture/истечение) терминализует строку и отпускает резерв; кривой запрос bind откатывается и оставляет `ISSUED` | `issuedAllowanceRefusalTerminalizesStoredRowV2`; bind savepoint `authority-postgres.ts:202-246` | `postgres-risk-v2.test.ts`, `postgres-execution-v2.test.ts` |
| `issuedAt` / `validUntil` и окно bind от `clock_timestamp()` после лока счёта, не от `transaction_timestamp()` | `freshEligibilityTime`, `durableTransactionTime` | postgres-risk-v2 (ожидание лока / expiry), postgres-execution-v2 (savepoint + `pg_sleep`) |
| Допуск 1…300_000 мс | `admitRiskAllowanceV2Postgres` вход | unit/integration risk v2 |
| Один POST постановки, без ретрая транспорта | `htx-exchange-connector.ts:342-343` | `tests/unit/trader-connector-htx.test.ts` |
| После `SUBMIT_STARTED` повтор не шлёт сеть | `dispatchCommittedExecutionAttemptV2` | `postgres-execution-v2.test.ts` |
| Идемпотентность ордера: `idempotencyKey = execution-v2-${planDigest}`, `clientOrderId` из digest плана, unique `(organization_id, client_order_id)` и `(organization_id, idempotency_key)` | `authority-postgres.ts:153-185`; `db/schema.postgres.ts` unique indexes | postgres-execution-v2 |
| Уникальный nonce допуска на org+account | schema `trader_risk_allowances_v2_org_account_nonce_unique` | postgres-risk-v2 |
| Конверт: стадии, повтор stage не вставляет вторую строку, published перерешается по телу + часам БД + observed identity, stale снимает current | `recheckPublishedAuthorityV2`, `advanceLiveCapitalEnvelopeStageV2` | `tests/integration/postgres-live-capital-envelope-v2.test.ts` |
| Первая публикация с чужим observed не становится current | там же | тот же файл |
| RLS deny и `REVOKE` на таблицах 0226 | `0226_trader_live_capital_envelope_v2.sql:119-142` | миграция применяется в postgres-integration; отдельного browser-role теста на 0226 в этом аудите не гоняли |
| Легаси submit не вызывает коннектор | `legacyOrderSubmissionDisabled` | `tests/unit/account-observation-authority-graph.test.ts` фиксирует `return true` |
| Единственный разрешённый `connector.placeOrder` — dispatch V2 | `scripts/trader/validate-execution-v2-consumer-graph.ts` | `tests/unit/trader-execution-v2-consumer-graph.test.ts` |
| Live-гейт легаси: Org0, ENABLED, EFFECTIVE + версия, kill-switch, trade scope, потолок если есть risk decision | `assert-live-path-authorized.ts` | `tests/unit/trader-live-authorization-gate.test.ts` |
| Один EFFECTIVE на стратегию в организации, cooling-off | promotion repository / service | `tests/unit/trader-strategy-promotion-governance.test.ts`, `tests/integration/postgres-promotion-audit-atomicity.test.ts` |
| Переходы org live enable и ack-фраза | `org-live-enable-service.ts` | `tests/integration/postgres-org-live-enable-atomicity.test.ts` |
| Kill-switch CAS / fail-closed резолвер | `lib/trader/risk/kill-switch/` | `tests/integration/postgres-kill-switch-parity.test.ts` |
| Credential: org scope, отказ decrypt без готового master key, RLS | credential service + schema | `tests/unit/trader-credential-service.test.ts`, `tests/unit/trader-credential-tenant-isolation.test.ts`, `tests/unit/trader-exchange-credentials-schema.test.ts` |
| Execution host отказывается стартовать с live-ключами | `entrypoint.mjs:16-28` | тесты хоста (historical), не live-ордер |
| Классификатор старого current-account всегда `current: false` | `risk-current-account-read-v1.ts:8-15` | `tests/unit/trader-risk-account-reconciliation-v1.test.ts` |

## Инварианты live и покрытие тестами

«Подтверждено» значит: тест бьёт в этот механизм. «Не на пути ордера» значит: механизм есть, production bind/dispatch его не вызывает.

| # | Инвариант | На пути ордера сейчас | Тестом подтверждён |
| --- | --- | --- | --- |
| L1 | Нет ордера HTX без Execution V2 | Да (заглушка легаси). Обратное — «V2 вообще вызывается» — нет | Да, заглушка зафиксирована. Вызова сервиса V2 нет ни в коде, ни в тесте оркестратора |
| L2 | Один сетевой POST на попытку, повтор не шлёт | Код dispatch — да; production его не вызывает | Да, postgres-execution-v2 |
| L3 | `client-order-id` детерминирован от digest плана | Да, в bind | Да, вместе с unique index в integration |
| L4 | Резерв допуска атомарно с вставкой ордера; кривой bind не сжигает `ISSUED` | Да, в функции bind | Да, postgres-execution-v2 / postgres-risk-v2 |
| L5 | Просроченный допуск не биндится; часы — `clock_timestamp()` после лока | Да, в bind | Да, включая sleep под локом |
| L6 | Реплей допуска не удваивает резерв | Да, в admit | Да, postgres-risk-v2 (#697) |
| L7 | Kill-switch `trader_kill_switches` останавливает новый ордер | **Нет** на V2. Да на легаси-гейте, который submit не достигает | Тест гейта — да. Тест trip → bind — **нет** |
| L8 | `kill_state = TRIPPED` останавливает admit/bind | Да, если колонку выставить | Да, ручным SQL в integration, не через сервис |
| L9 | Org live `ENABLED` обязателен | Только в легаси-гейте | Да для гейта. **Нет** для bind |
| L10 | Только Org0 allowlist | Только в легаси-гейте | Да для гейта. **Нет** для bind |
| L11 | Стратегия только `EFFECTIVE` и та же версия | Только в легаси-гейте. Paper этот гейт не вызывает | Да для гейта. **Нет** для bind и paper |
| L12 | Ключ HTX active, venue htx, scope `trade`, расшифровка только при готовом master key | Только в легаси-гейте | Да для гейта и credential unit. **Нет** сквозного теста до POST |
| L13 | Нотионал ≤ `max_notional_cap` (и org risk max) | Только если легаси-гейт получил `riskDecision` | Частично. Пропуск при `riskDecision == null` тестом как дыра не закрыт |
| L14 | Опубликованный LiveCapitalEnvelopeV2 ограничивает размер | **Нет** | Продюсер и read-gate — да. Связка с admit/bind — **нет** |
| L15 | `lossLimitNotional` режет допуск | **Нет** | **Нет** |
| L16 | Ноль капитала запрещён | **Нет** (конверт). Да для org cap | Org cap — да. Конверт — **нет** |
| L17 | Неопределённый POST не ретраится и не считается принятым | Да, в коннекторе | Да, unit HTX. Принятие/отпуск резерва после сверки — **нет** |
| L18 | Сверка может закончиться отменой или точным ack | **Нет** (состояние поглощающее, воркера нет) | **Нет** |
| L19 | Execution host не держит live-секреты | Да | Да для refuse списка env |
| L20 | RLS/REVOKE не отдают конверт и credentials ролям браузера | Да, миграции | Credentials schema test — да. 0226 — политикой SQL; отдельный тест роли в этом проходе не запускался |
| L21 | 0225 не берёт бесконечный лок при живых писателях | **Не подтверждено**: `SET LOCAL` не охватывает следующие breakpoint | Комментарий и тест апгрейда legacy-циклов есть; теста на `lock_timeout` через breakpoint — **нет** |

## До включения первого live в Org0

Пока список не закрыт, `trader_org_live_enable` для Org0 не переводить в `ENABLED`. Флаг сегодня не отправит ордер, но следующий wiring без этих пунктов отправит его мимо капитала и kill-switch и оставит его несверяемым.

1. **Один путь.** Фабрика только для Org0: paper mock и live HTX отличаются коннектором, не набором проверок. Легаси `submitOrder` остаётся заглушкой.
2. **Конверт на ордере.** Issue, bind и старт отказывают без `BASIS_BOUND` в той же транзакции. `capitalNotional` и `lossLimitNotional` обязательны, строго `> 0`, и равны лимиту, которым считается допуск. `"0"` запрещён.
3. **Маленький потолок дважды.** `max_notional_cap` org enable — положительный и маленький. Bind отказывает, если нотионал выше min(org cap, риск-лимит, капитал конверта), даже когда отдельного объекта `riskDecision` нет.
4. **Kill-switch на том же состоянии, что допуск.** Trip сервиса выставляет `kill_state`/`posture` до коммита. Bind и последнее чтение перед POST это видят. Нужен тест trip→bind без ручного `UPDATE`.
5. **EFFECTIVE.** Версия стратегии в плане совпадает с записью `trader_strategy_promotion_records` в `EFFECTIVE` этой организации. Paper/mock evidence само по себе live не открывает — только эта запись, и проверка стоит в bind.
6. **Ключ.** Один активный HTX credential Org0, `permission_metadata` со scope `trade` и ожидаемым spot account. Master key production-ready. Execution host и historical runner этого секрета не имеют. В отчёт и логи ключ не попадает (сейчас маскирование есть; новый путь обязан его сохранить).
7. **Сверка до денег.** Ратифицированный GET по `client-order-id` после единственного POST: либо точный ack/fill, либо доказуемый отсутствие ордера и возврат резерва. `RECONCILIATION_REQUIRED` виден в админке по попытке, не только по `trader_orders.state`. Пока этого нет, первый ордер нельзя считать управляемым.
8. **Часы.** NTP на процессе POST. Окно допуска не больше уже заданных 300 с. Не слать POST, если `validUntil` ближе таймаута HTTP (30 с по умолчанию).
9. **Миграции.** 0224–0226 накатить до включения, не во время сессии. 0225 — в окно без писателей noncapital-таблиц; не полагаться на `SET LOCAL lock_timeout` через breakpoint. 0226 не задаёт размер капитала — его задаёт человек в команде конверта.
10. **Репетиция на paper V2**, затем один символ, один счёт, нотионал на уровне потолка, с kill-switch drill на реальном bind (тест должен упасть до POST). Отдельного «пробного» обхода гейтов быть не должно.

## Что сознательно не делалось

Секреты, `.env`, ключи биржи и продакшен-БД не читались. Запросов к HTX не было. Тесты в этом проходе не запускались: выводы сверены по коду и по именам уже лежащих тестов на `8cae38cb`. Утверждения о зелёном CI PR #695–#697 взяты из описаний этих PR, не перепроверялись прогоном.
