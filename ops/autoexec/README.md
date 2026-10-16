# Автоисполнитель комитета — фьючерсы HTX USDT-M

Каталог `ops/autoexec` ставит и сопровождает сделки инвесткомитета на USDT-M HTX. Источник — только карточки с `risk_signoff` (подпись RISK) из `decision.json` или каталога `pending`. Карточка без подписи в журнал отказов плана попадает, но слот, контракт и OCO не занимает.

Реальные ордера отправляются только с флагом `--live` и ключами из окружения. Без `--live` процесс считает sizes и пишет бумажную запись `dry_pending`, на биржу не ходит с мутациями. Ключи в коде не хранятся.

Состояние счёта по умолчанию — `state/fpositions.json` (тот же каркас, что у `fexec.py`). Журнал — `journal.jsonl`, лента уведомлений — `state/events_unreported.jsonl`. Строка события: `ts`, `market=futures`, `kind` и поля сделки.

## Как запустить

Из каталога репозитория, данные комитета в `/workspace/committee/exec`:

```bash
cd ops/autoexec
export PYTHONPATH="$PWD"
export AUTOEXEC_ROOT=/workspace/committee/exec
export HTX_SMALL_API_KEY=...
export HTX_SMALL_API_SECRET=...

# бумага, счёт small (это и есть режим по умолчанию)
python3 -m autoexec --root "$AUTOEXEC_ROOT" --config config.example.json --dry-run --account small run --once

# план без отправки
python3 -m autoexec --root "$AUTOEXEC_ROOT" --config config.example.json --dry-run plan --decision /workspace/committee/sessions/2026-10-02/decision.json
```

Цикл 24/7 (сон 30 с, сверка на каждом проходе):

```bash
AUTOEXEC_ROOT=/workspace/committee/exec \
AUTOEXEC_CONFIG=/workspace/committee/exec/autoexec.json \
AUTOEXEC_ACCOUNT=small \
AUTOEXEC_LIVE=0 \
./run_autoexec_loop.sh
```

`AUTOEXEC_LIVE=1` добавляет `--live`. Пока переменная `0`, скрипт остаётся в бумаге.

Systemd-юнит: `systemd/committee-autoexec.service`. В юните поправьте `PYTHONPATH` на фактический checkout и положите секреты в `/workspace/committee/exec/autoexec.env` (образец — `autoexec.env.example`, в git его не коммитить заполненным).

```bash
sudo cp systemd/committee-autoexec.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now committee-autoexec.service
journalctl -u committee-autoexec.service -f
# тот же текст дублируется в state/autoexec.log
```

Не запускайте рядом `fexec.py monitor`: оба пишут `state/fpositions.json`.

## Конфиг

Файл JSON. Секретов в нём нет, только префиксы окружения. Образец — `config.example.json`.

| Поле | Смысл |
| --- | --- |
| `risk_per_trade_pct` | 0,75 — риск на сделку от equity счёта |
| `leverage` | только 5, маржа `isolated` |
| `max_open_positions` | 3 на счёт; висящая OCO-группа считается одним слотом |
| `min_stop_atr` | стоп не ближе 2,5 × ATR(1h) |
| `min_gross_rr` | R/R до издержек, порог 1,8 |
| `fee_rt` | 0,001 = 10 б.п. за круг |
| `min_net_r` | ожидаемый R после издержек должен быть строго больше этого числа (0) |
| `max_stop_distance_pct` | стоп не дальше 10% от входа |
| `data_max_age_sec` | котировка HTX не старше 60 с, иначе новых входов нет |
| `stop_confirm_sec` | сколько ждать стоп на бирже после входа |
| `be_trigger_r` | перенос стопа в безубыток после +1R |
| `trail_enabled`, `trail_distance_r` | трейлинг выключен, пока не включите |
| `daily_loss_stop_pct` | 4% equity — нет новых входов до 00:00 МСК |
| `weekly_drawdown_stop_pct` | 8% — стоп до ручного `enable` |
| `situation_loss_streak` | 4 убытка подряд по ситуации — пауза 24 ч |
| `max_slippage_bps`, `avg_r_window`, `min_avg_r` | выключатели проскальзывания и среднего R |
| `allowed_coins` | разрешённые инструменты |
| `cluster_coins` | BTC и ETH в одну сторону делят один бюджет 0,75% |
| `accounts` | список счетов |

Формулы проверки перед каждым выставлением, отдельно на каждом счёте:

```
gross_rr = |цель − вход| / |вход − стоп|
fee      = вход × fee_rt
net_r    = (|цель − вход| − fee) / (|вход − стоп| + fee)
```

Нужны `gross_rr ≥ 1,8` и `net_r > 0`. ATR берётся из свечей 1h HTX, если биржа ответила, иначе из `atr_1h` карточки.

Размер: `риск = equity × 0,75%`, число контрактов — целая часть, чтобы фактический риск на стопе не превысил бюджет. BTC и ETH в одну сторону вычитают уже занятый риск кластера. Встречные карточки одного контракта без общего `oco_group` не ставятся. Частичное исполнение одной ноги снимает остальные.

Отмена неисполненного входа: только `cancel_if_last_above` (last строго выше) и `cancel_if_last_below` (last строго ниже), плюс `expires` в МСК. Поле `cancel_if_last_beyond` не используется: направление было двусмысленным. Подпись RISK действует до `expires`.

Вход и стоп (и тейк первой цели, если она есть) уходят одним ордером, как в `fexec`: `sl_trigger_price` на `/v5/trade/order`, плечо isolated 5x. Если после открытия стоп на бирже не подтверждён за `stop_confirm_sec`, позиция закрывается по рынку и в ленту пишется `alarm`.

`client_order_id` стабилен для пары счёт + карточка (префикс `77`). Повторный запуск подхватывает уже стоящий ордер и второй не шлёт. Сверка с биржей — в начале каждого цикла.

Дневной стоп снимает неисполненные входы и запрещает новые до полуночи МСК. Открытую позицию с живым стопом он не закрывает рынком. Недельная просадка, проскальзывание хуже порога и средний R ниже порога держат запрет, пока не выполните `enable`.

Уведомления (`entry_placed`, `entry_filled`, `entry_cancelled`, `position_closed`, `stop_moved`, `daily_stop`, `autostop`, `alarm`) пишутся в `events_unreported.jsonl`. Если задан `AUTOEXEC_WEBHOOK_URL`, та же строка уходит POST-ом. Ошибка вебхука торговлю не останавливает.

## Как добавить счёт

1. В `accounts` добавьте объект, не включая его в торговлю, пока не проверите бумагу:

```json
{"id": "desk2", "env_prefix": "HTX_DESK2", "enabled": true}
```

2. Префикс — латиница, цифры и подчёркивание. Ключи читаются как `HTX_DESK2_API_KEY` и `HTX_DESK2_API_SECRET`. Для исторического префикса `HTX` это привычные `HTX_API_KEY` / `HTX_API_SECRET`.
3. Счёт по умолчанию (`default_account`, сейчас `small`) пишет `state/fpositions.json`. Остальные — `state/fpositions.<id>.json`. Журнал общий, в строке есть `account`.
4. Пока в команде не указан другой счёт, работает только `small`. Все включённые сразу — явный `--account all`.

```bash
python3 -m autoexec --root "$AUTOEXEC_ROOT" --config autoexec.json --dry-run --account desk2 run --once
python3 -m autoexec --root "$AUTOEXEC_ROOT" --config autoexec.json --live --account all run --once
```

## Как выключить

Новые входы запретить, позиции со стопом на бирже не трогать:

```bash
python3 -m autoexec --root "$AUTOEXEC_ROOT" --account small disable
```

Снова пустить после недельного стопа, проскальзывания или среднего R (база недели и окно среднего R сбрасываются на текущее equity):

```bash
python3 -m autoexec --root "$AUTOEXEC_ROOT" --account small enable
```

Аварийно снять входы и закрыть позиции по рынку — только осознанно и только с `--live`:

```bash
python3 -m autoexec --root "$AUTOEXEC_ROOT" --live --account small kill
```

Без `--live` команда `kill` создаёт файл `KILL` в корне данных и ставит `operator_disabled`: новые входы запрещены, позиции не закрываются. Если файл `KILL` уже лежит в корне, следующий цикл с `--live` снимает неисполненные входы и закрывает открытые позиции по рынку. Остановить сам процесс: `systemctl stop committee-autoexec.service` или Ctrl+C у `run_autoexec_loop.sh`. Удалите `KILL` и выполните `enable`, когда торговлю нужно вернуть.

Вернуть торговлю после `disable`: `enable`. Дневной стоп снимается сам в 00:00 МСК. Ситуация включается сама через 24 часа.

## Проверки

```bash
cd ops/autoexec
python3 -m unittest discover -s tests -q
```

Тесты не открывают сеть и не ставят ордера на HTX: биржа заменена памятью. Юнит-тесты покрывают размер, `card_check`, OCO, `cancel_if_*`, безубыток и автостопы. Интеграционный тест проводит выставление, рестарт без дубля, бумагу, снятие ноги OCO, дневной стоп, перенос стопа и закрытие, если стоп на бирже не появился.

## Выкатка на box `/workspace/committee/exec`

1. Обновить checkout с этим каталогом. `fexec.py` и `run_fmonitor_loop.sh` остановить, чтобы не писать тот же state.
2. Скопировать `config.example.json` в `/workspace/committee/exec/autoexec.json`. Прописать `pending_dir` и при необходимости путь утреннего `decision.json` (или передавать его `--decision` / `AUTOEXEC_DECISION`).
3. Создать `/workspace/committee/exec/autoexec.env` из `autoexec.env.example`. Заполнить только `HTX_SMALL_*`. Права файла ограничить пользователем сервиса. Основной счёт в конфиге оставить `enabled: false`.
4. В юните выставить `PYTHONPATH` на `ops/autoexec` этого checkout, `AUTOEXEC_LIVE=0`, `AUTOEXEC_ACCOUNT=small`.
5. Один проход бумаги: `python3 -m autoexec --root /workspace/committee/exec --config /workspace/committee/exec/autoexec.json --dry-run --account small run --once`. В `journal.jsonl` должна появиться строка, в `state/fpositions.json` — `dry_pending` либо пустой план. В логе не должно быть `order_id` биржи.
6. Сверить план с карточкой: контракт, сторона, объём, стоп, тейк, `client_order_id` на `77`.
7. Поднять systemd и сутки смотреть `state/autoexec.log` и `events_unreported.jsonl` в бумаге.
8. Переключение на реальные ордера малого счёта — отдельное решение: `AUTOEXEC_LIVE=1`, рестарт юнита. Первые ордера смотреть на HTX глазами: isolated, 5x, стоп на том же ордере.
9. Основной счёт не включать, пока малый не отходит цикл без ручного вмешательства. Тогда `enabled: true` и явный `--account main` или `--account all`.
10. Откат: `AUTOEXEC_LIVE=0` или `systemctl stop`, при необходимости `disable`. Закрытие уже открытого — только `kill --live`.
