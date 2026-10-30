# OB-HEATMAP

Секундная тепловая карта агрегированного стакана линейных перпов BTCUSDT и ETHUSDT.
Площадки: Binance USD-M, Bybit linear, OKX swap, HTX linear. Обратные контракты не пишутся.
Спот сюда не суммируется.

Сборщик крутится отдельно от `waia-binance-collect` и `waia-binance-serve` (:8787). Их юниты и туннель Cloudflare этот пакет не меняет. API слушает **8790**.

## Что на экране

Время идёт вправо, цена — вверх. Цвет клетки — перцентиль объёма в текущем окне и монете: медиана тёмная, жёлтый только у верхних ~2% (около p98). Шкала слева подписана долларами этих перцентилей. Свечи включены сразу, с тёмной обводкой. Белая линия и подпись на правой шкале — последняя цена. На графике не больше трёх стен сверху и трёх снизу; остальные — в «Крупнейшие стены».

Режимы «Стакан» и «Ликвидации (модель)» включаются по отдельности и вместе. Колесо и перетаскивание приближают время и цену, «Сброс» возвращает весь обзор. Подсказка: время МСК, цена, доллары на уровне, биржи. Порог яркости — ползунок.

Смена монеты, площадки или окна выбрасывает буфер, свечи, стены и шкалу. Поздний ответ или SSE со старым `symbol` не попадает на график. Ось Y считается только по ценам этой монеты: сначала отсечение дальше ±12% от последней цены, затем перцентили 1–99 и небольшой отступ. Чужой биток не растягивает шкалу эфира.

Справа от карты — тонкий профиль текущего стакана и плотная шкала цены.

Серая вертикальная полоса — секунда без честной книги. Это дыра или ресинк, не нулевая ликвидность. В parquet у такой секунды списки корзин `null`, не нули. Сумма `ALL` в эту секунду не включает площадку с дырой. Если честных площадок нет, `ALL` тоже `null`.

Полоса вокруг середины — ±2%. Шаг корзины записан в `meta.json`: BTC **$10**, ETH **$0.5**. Доллар объёма считается по середине этой секунды (`coin * mid`), не по цене уровня. Глубина дальше видимого стакана площадки не дорисовывается нулями: биржа отдаёт не всю полосу ±2% (у Binance снимок до 1000 уровней, у Bybit подписка `orderbook.1000`, у OKX канал `books`, у HTX `depth.size_150.high_freq`).

Ползунок «Порог яркости» — перцентиль окна: при 0.50 медиана ещё тёмная, жёлтый только около 98-го перцентиля. «Порог $» оставляет только уровни не меньше этой суммы. Покупка и продажа раскрашены в боковом профиле, не на самой карте.

Над картой — лента TradingView: US10Y, DXY, NQ1!, золото, нефть, USDJPY. Она грузится браузером с TradingView, сборщик эти ряды не пишет. Ссылка CoinGlass открывает их карту. «Ликвидации (модель)» — оценка недавнего объёма по плечам 5/10/25/50/100, не принт биржи. Площадки в шапке — короткие индикаторы (зелёный/красный), подробности в подсказке.

## Запись

`/srv/obheat/data/date=YYYY-MM-DD/venue=VENUE/symbol=SYMBOL/HH.parquet`

`venue` — `BINANCE`, `BYBIT`, `OKX`, `HTX` или `ALL`. Файл — час UTC, parquet zstd. В одной схеме строки `second`, `trade`, `liquidation`, `gap`.

Рядом:

| путь | смысл |
|---|---|
| `/srv/obheat/meta.json` | шаг цены, полоса, contractSize/ctVal |
| `/srv/obheat/health.json` | последнее сообщение и книга по площадке, счётчик дыр |
| `/srv/obheat/live/latest.json` | последняя секунда для `/book` и SSE |
| `/srv/obheat/gaps.jsonl` | журнал дыр последовательности, по строке на дыру |

Дыра стирает книгу до нового снимка. OKX: checksum не проверяется (с 23.06.2026 в JSON `books` он всегда 0). Непрерывность — `seqId` / `prevSeqId`. Binance USD-M — `pu` должен совпасть с прошлым `u`. Bybit — подряд идёт `u`, поле `seq` для дыры не используется, `u=1` на дельте сбрасывает книгу. HTX high_freq — `version` у update равен прошлому + 1.

Сырой объём переводится в монету через `contractSize` / `ctVal`, прочитанные ccxt при старте. Площадка, у которой рынок не прочитался, в склейку не входит.

Фандинг и открытый интерес пишутся в секунду, когда биржа их прислала. Это не книга.

## API

База: `http://127.0.0.1:8790`

| метод | ответ |
|---|---|
| `GET /` | страница |
| `GET /health` | статус площадок |
| `GET /meta` | шаги и контракты |
| `GET /book?symbol=BTCUSDT&venue=ALL` | текущая лестница |
| `GET /heatmap?symbol=BTCUSDT&venue=ALL&minutes=60&step=1m` | матрица, `step` = `1s`, `5s`, `15s`, `1m`, `5m`. По умолчанию `format=compact` (`compact-v1`) |
| `GET /levels?symbol=BTCUSDT&venue=ALL&minutes=60` | стены, глубина, дисбаланс и модельные кластеры |
| `GET /trades?symbol=BTCUSDT&venue=ALL&minutes=60` | сделки за окно |
| `GET /liquidations?symbol=BTCUSDT&venue=ALL&minutes=60` | ликвидации за окно |
| `GET /api/liquidity?symbol=BTCUSDT&venue=ALL` | last, ближайшие стены, тренд, magnet, свежесть. `BTC`/`ETH` — алиасы |
| `GET /stream?symbol=BTCUSDT&venue=ALL` | SSE: `column` (как раньше) и `liquidity` раз в секунду |

`symbol`: `BTCUSDT` или `ETHUSDT`. `venue`: `ALL` и десять площадок из `OBHEAT_VENUES` (BINANCE, BYBIT, OKX, HTX, BITGET, GATE, BINANCE_SPOT, COINBASE, OKX_SPOT, BYBIT_SPOT). Окно `minutes` 1..4320, столбцов не больше 2000. Бин суммирует только честные секунды; дыра — `null`, не ноль.

`/health` по площадке: `ok`, `partial`, `stale` (нет честной книги >10 с), `resync` (дыра, ждём снимок), `rate_limited` (418/429), `unavailable` (451 или geographic block — ретраи редкие, остальные площадки не ждут). `degraded: true`, если хоть одна площадка не `ok`.

`/api/liquidity` (тот же объект уходит в SSE `liquidity`):

| поле | смысл |
|---|---|
| `last`, `best_bid`, `best_ask` | середина и край стакана |
| `nearest_bid_wall`, `nearest_ask_wall` | ближайшая стена: `price`, `usd`, `persistence_s`, `trend` (`growing`/`pulled`/`stable`), `distance_pct` |
| `walls` | до 12 стен с теми же полями |
| `liquidation_clusters` | оценка, не принт биржи: `side` `longs`/`shorts`, `price`, `usd`, `distance_pct` |
| `magnet` | ключи `0.5`, `1`, `2`, `3` — доля доллара выше (`up`) и ниже (`down`) середины |
| `freshness` | по площадке `status`, `age_s`, `last_book` |

Если `OBHEAT_BIND` не localhost, без `OBHEAT_TOKEN` процесс не стартует. Токен: заголовок `Authorization: Bearer …`, `X-Obheat-Token` или `?token=` (его же подставляет страница и SSE). На `127.0.0.1` токен не нужен.

Комитетский дашборд проверяет доступность пробником `GET /` с таймаутом **2,5 с**. `/` отдаёт уже прочитанную страницу (в неё при старте вшит `web/chart-model.js`, отдельного запроса за скриптом нет), `/health` — готовые байты `health.json`. Оба маршрута не ждут расчёт тепловой карты и не берут её замок. Если проба не уложилась в 2,5 с, дашборд показывает «not connected».

Потолки serve, чтобы RSS не рос линейно, как на проде v3 (319 → 794 МБ за 30 минут при ~6% CPU):

| предел | значение |
|---|---|
| окно | 1..4320 минут (3 суток) |
| столбцы одного ответа | 2000 |
| уровни цены в строке и в compact | 512 |
| сырые секунды на монету за один запрос | 4096; старше — минутные файлы |
| принты | 2000 |
| кэш ответов | 4 записи, не больше 2 на монету, старше 60 с выбрасываются |
| SSE-клиенты | 16; старше 15 минут и отключившиеся закрываются |

`/stream` отвечает `Connection: close` и не оставляет поток в keep-alive после обрыва. Снимок `latest.json` перечитывается только когда файл изменился. Раз в 15 с процесс отдаёт освобождённые страницы ОС (`malloc_trim`). Проверка плато: `python3 -m obheat.memplateau --seconds 40`.

## Деплой на Cherry

Из корня репозитория, ветка с этим кодом. Скрипт ставит venv в `/opt/obheat`, код в `/opt/obheat/app`, данные в `/srv/obheat`, юниты `obheat-collect` и `obheat-serve`. Порт 8787 и юниты `waia-binance-*` не трогает.

```bash
sudo bash obheat/deploy/install.sh
sudo systemctl start obheat-collect.service
sudo systemctl start obheat-serve.service
systemctl status obheat-collect.service obheat-serve.service --no-pager
curl -sS http://127.0.0.1:8790/health
```

Страница: `http://127.0.0.1:8790/`. С ноутбука через SSH:

```bash
ssh -L 8790:127.0.0.1:8790 waia-execution-historical
```

Открыть публично, не трогая текущий туннель на :8787:

```bash
sudo sed -i 's/^OBHEAT_BIND=.*/OBHEAT_BIND=0.0.0.0/' /etc/obheat.env
# токен в /etc/obheat.env, затем:
sudo systemctl restart obheat-serve.service
```

Пример строки в `/etc/obheat.env`:

```bash
OBHEAT_BIND=0.0.0.0
OBHEAT_TOKEN=длинный-случайный-токен
```

Страница: `http://<хост>:8790/?token=длинный-случайный-токен`. В туннель Cloudflare имеет смысл добавить отдельное имя на `http://127.0.0.1:8790`, не переписывая маршрут waia-binance.

Логи: `journalctl -u obheat-collect -u obheat-serve -f`. Перезапуск — `Restart=always`, пауза 3 секунды.

Обновление уже стоящего прод-дерева (бэкап `/opt/obheat/app` → `/root/obheat-app-bak-<UTC>.tgz`, `pip install` в существующий venv, рестарт collect, затем serve, проверка `/health`, откат tarball при ошибке). `/srv/obheat` и `/etc/obheat.env` не перезаписываются. Юниты остаются `python -m obheat.collect` / `obheat.serve`, `PYTHONPATH=/opt/obheat/app`, порт 8790.

```bash
sudo bash /opt/obheat/app/obheat/deploy/upgrade.sh
```

Из git-checkout, где пакет лежит в `ops/obheat/obheat`:

```bash
sudo bash ops/obheat/obheat/deploy/upgrade.sh
```

Локально без systemd, из корня репозитория:

```bash
python3.12 -m venv /tmp/obheat-venv
/tmp/obheat-venv/bin/pip install -r obheat/requirements.txt
OBHEAT_DATA=/tmp/obheat /tmp/obheat-venv/bin/python -m obheat.collect
OBHEAT_DATA=/tmp/obheat /tmp/obheat-venv/bin/python -m obheat.serve
```

Синтетика без биржи (страница и порядок размера файла): `python -m obheat.demo --data-dir /tmp/obheat-demo --seconds 120`.

Проверка без сети: `python -m pytest -q tests/test_obheat.py`.

## Объём данных

Локальный прогон 2026-10-02, около 10 минут (~597 с, 0 дыр последовательности): OKX и HTX, BTCUSDT и ETHUSDT, плюс агрегат `ALL`. Parquet zstd — **1 394 433 байта** (6 часовых файлов: ALL 510 452, OKX 454 117, HTX 429 864). Это секундные корзины и сделки, не сырой L2.

Отсюда **около 202 МБ/сутки** на две площадки плюс `ALL`. Если Binance и Bybit дадут плотность как среднее OKX и HTX, четыре площадки плюс `ALL` — **около 330 МБ/сутки** на два символа. Это оценка с машины агента, не замер с Cherry.

На этой машине Binance REST ответил 451, Bybit 403; OKX и HTX — 200. Синтетика `python -m obheat.demo` (редкие уровни, без живого потока сделок) даёт заметно меньший файл и для оценки диска не годится.
