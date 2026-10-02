# OB-HEATMAP

Секундная тепловая карта агрегированного стакана линейных перпов BTCUSDT и ETHUSDT.
Площадки: Binance USD-M, Bybit linear, OKX swap, HTX linear. Обратные контракты не пишутся.
Спот сюда не суммируется.

Сборщик крутится отдельно от `waia-binance-collect` и `waia-binance-serve` (:8787). Их юниты и туннель Cloudflare этот пакет не меняет. API слушает **8790**.

## Что на экране

Время идёт вправо, цена — вверх. Яркость клетки — долларовый объём корзины: логарифм, нормированный на 95-й перцентиль текущего окна. Зелёный — bid, красный — ask. Жёлтая линия — середина. Голубые и оранжевые круги — крупные сделки (от 90-го перцентиля окна), фиолетовые ромбы — ликвидации с потока биржи, не модель плеча.

Справа — текущая лестница тех же корзин.

Серая вертикальная полоса — секунда без честной книги. Это дыра или ресинк, не нулевая ликвидность. В parquet у такой секунды списки корзин `null`, не нули. Сумма `ALL` в эту секунду не включает площадку с дырой. Если честных площадок нет, `ALL` тоже `null`.

Полоса вокруг середины — ±2%. Шаг корзины записан в `meta.json`: BTC **$10**, ETH **$0.5**. Доллар объёма считается по середине этой секунды (`coin * mid`), не по цене уровня. Глубина дальше видимого стакана площадки не дорисовывается нулями: биржа отдаёт не всю полосу ±2% (у Binance снимок до 1000 уровней, у Bybit подписка `orderbook.1000`, у OKX канал `books`, у HTX `depth.size_150.high_freq`).

Фильтр «яркие ≥ N секунд» оставляет только корзины, которые в окне не меньше N раз были на уровне 75-го перцентиля и выше. N = 1 показывает всё. Это грубый антиспуфинг, не детектор.

Над картой — лента TradingView: US10Y, DXY, NQ1!, золото, нефть, USDJPY. Она грузится браузером с TradingView, сборщик эти ряды не пишет. Ссылка «Карта ликвидаций CoinGlass, BTC» открывает их страницу, свою модель ликвидаций мы не считаем.

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
| `GET /heatmap?symbol=BTCUSDT&venue=ALL&minutes=60&step=1s` | матрица, `step` = `1s`, `5s` или `15s` |
| `GET /trades?symbol=BTCUSDT&venue=ALL&minutes=60` | сделки за окно |
| `GET /liquidations?symbol=BTCUSDT&venue=ALL&minutes=60` | ликвидации за окно |
| `GET /stream?symbol=BTCUSDT&venue=ALL` | SSE, событие `column` раз в секунду |

`symbol`: `BTCUSDT` или `ETHUSDT`. `venue`: `ALL`, `BINANCE`, `BYBIT`, `OKX`, `HTX`. Окно не длиннее 240 минут и не больше 1000 столбцов (15 мин × 1 с, 1 ч × 5 с, 4 ч × 15 с проходят). Бин 5 с и 15 с суммирует только честные секунды; если в бине честных нет, столбец `null`.

Если `OBHEAT_BIND` не localhost, без `OBHEAT_TOKEN` процесс не стартует. Токен: заголовок `Authorization: Bearer …`, `X-Obheat-Token` или `?token=` (его же подставляет страница и SSE). На `127.0.0.1` токен не нужен.

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

Остановка и обновление кода:

```bash
sudo systemctl stop obheat-collect.service obheat-serve.service
sudo bash obheat/deploy/install.sh
sudo systemctl start obheat-collect.service obheat-serve.service
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
