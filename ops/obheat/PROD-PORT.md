# DEE-1375 — перенос прод-правок OBHEAT

Статус: **снимок прода ещё не приложен**. Код альтов в этот коммит не входит.
Список `ALT_SYMBOLS` из журнала обрезан (`SOLUSDT, NEARUSDT, … BNBUSDT`) и здесь не додуман.

## Две базы

| База | Что это |
| --- | --- |
| `main` `9bf77f1820bc318640c1dc566aa339762d453ab6` | squash PR #797 (DEE-1374). Дерево `ops/obheat` + фикс зависания. |
| `/root/obheat-app-bak-20261030102756.tgz` на 84.32.109.46 | код **до** выкладки #797. После отката это рабочий прод. Архив собран `upgrade.sh` как `tar -C /opt/obheat -czf … app`, пути внутри: `app/obheat/…`. |

`/opt/obheat/app` после отката должен совпасть с архивом. Если нет — рабочим считается архив, а расхождение `/opt` прикладывается отдельно.

Формат `/srv/obheat` (`health.json`, `live/`, `gaps.jsonl`) не меняется. Торговлю, ключи и соцсеть не трогаем. На сервер из этой ветки ничего не выкладывается.

## Почему alt упал

`obheat-collect` принимает символы только из `SYMBOLS`. На `main` это `("BTCUSDT", "ETHUSDT")`. Чужой символ — `SystemExit`:

```text
unknown: SOLUSDT, NEARUSDT, ... BNBUSDT
```

Юнит `obheat-collect-alt` (его нет в git) передаёт свой `OBHEAT_SYMBOLS`. `upgrade.sh` рестартит его, если юнит есть, и из‑за этого откатился.

Те же ворота на `main`, их придётся открыть вместе с картами имён:

- `collect.py` — `_split(..., SYMBOLS)`
- `query.py` — `unknown symbol`
- `serve.py` — `symbol must be BTCUSDT or ETHUSDT`
- `liquidity.py` — `SYMBOL_ALIASES` только BTC/ETH
- `web/index.html` — кнопки BTC и ETH, подпись и запасной шаг цены зашиты под эти два
- `web/chart-model.js` — запасной шаг `BTCUSDT ? 10 : 0.5` (файл просить, даже если кнопки только в HTML; `serve` вшивает модель в страницу при старте)

В истории git `ALT_SYMBOLS` и `SOLUSDT` внутри `ops/obheat` нет.

## Что с `main` не снимать

Прод в архиве этих правок не содержит. Их отсутствие в diff — не повод вернуть старое поведение.

| Якорь | Зачем |
| --- | --- |
| `resync.py` — `resync_delay`, `ResyncScheduler.allow` / `finish` | один ресинк на символ, пауза 1…60 с (ошибка до 300 с) |
| `book.py` — `SYNC_PENDING_CAP = 512` | потолок буфера Binance |
| `native.py` — тот же потолок и повтор снимка Gate | буфер не растёт, неудачный снимок просится снова |
| `loopwatch.py` + хук в `collect.py` | молчание цикла дольше `OBHEAT_LOOP_LAG_S` (по умолчанию 20 с) → выход 1 |
| `upgrade.sh` — рестарт и откат `obheat-collect-alt` | иначе следующий деплой снова не заметит alt |

`asyncio.to_thread(engine.sample)` в `collect.py` тоже остаётся: запись parquet не должна блокировать сокеты.

## Что забрать с прода, когда будет diff

1. `symbols.py` — `ALT_SYMBOLS` (или расширение `SYMBOLS`), `PRICE_STEP`, `STD_TO_OURS`, `OURS_TO_PERP_STD` / `SPOT` / `COINBASE`, `CCXT_SYMBOL`.
2. `serve.py`, `liquidity.py`, `web/index.html`, при отличии `web/chart-model.js` — UI и API этих символов.
3. Поведенческие отличия рабочего файла (не `.bak`) от `main`: `book.py`, `collect.py`, `engine.py`, `feeds.py`, `native.py`, `query.py`. Плюс всё остальное, что `diff -q` пометит: `normalize.py`, `rest.py`, `buckets.py`, `store.py`, `limits.py`, `demo.py`, `deploy/*`, `requirements.txt`.
4. OKX WS `8443` → `443` — отдельный маленький коммит в том же PR, только после просмотра прода. В `cryptofeed==2.5.0` адрес зашит: `wss://ws.okx.com:8443/ws/v5/public`. На `main` `ObheatOKX` его не переопределяет. Если прод уже подменил endpoint, берём его подмену. Если нет — правка будет override `websocket_endpoints` на порт 443, без форка cryptofeed.

## Как слить, когда файлы приедут

1. Распаковать архив в `/tmp/obheat-prod`. Выкинуть `__pycache__` и `*.pyc`.
2. Для каждого `*.py`, `web/*`, `deploy/*`, `requirements.txt` сделать `diff -u` против `ops/obheat/obheat/…` на этой ветке.
3. Хунки фиксa stall (таблица выше) оставить с `main`, даже если прод их не имеет.
4. Карты альтов и UI/API взять с прода целиком, не сокращая список.
5. Прочий рабочий хунк брать, если он не откатывает stall и не меняет схему `health.json` / `live` / `gaps.jsonl`.
6. `.bak-*` не коммитить. Для каждого: `diff -q` с рабочим соседом.
   - совпадает с рабочим файлом — логика уже в нём, в отчёте «уже в коде»;
   - отличается — это история (selfheal, memleak, okxliq, resyncthrottle, alts, brokenpipe). В репозиторий не идёт, пока рабочий файл сам не содержит эту правку. Если рабочий файл регрессировал относительно `.bak` и правка нужна альту или stall, это отдельная строка отчёта, а не тихий перенос.
7. Тесты: текущие 31 stall/obheat остаются зелёными, плюс альты (allowlist, шаг цены, отказ на неизвестном символе, кнопки/алиасы). Прогон: `cd ops/obheat && PYTHONPATH=. python3 -m pytest -q tests/test_collect_stall.py tests/test_obheat.py`.

## Что прислать с 84.32.109.46

Секреты не нужны. `OBHEAT_TOKEN` не печатать и не класть в архив. `/srv/obheat` не нужен.

```bash
# 1. Состав архива и bak-файлы
tar -tzf /root/obheat-app-bak-20261030102756.tgz | sort
echo "---- live bak ----"
find /opt/obheat/app -name '*.bak*' -o -name '*bak-*' | sort
echo "---- tar bak ----"
tar -tzf /root/obheat-app-bak-20261030102756.tgz | grep -E 'bak|~' || true

# 2. Точный список альтов (без токена)
systemctl cat obheat-collect-alt.service | sed -E 's/(TOKEN|KEY|SECRET)=.*/\1=<redacted>/'
grep -E '^(OBHEAT_SYMBOLS|OBHEAT_VENUES|OBHEAT_DATA|OBHEAT_LOOP_LAG_S)=' /etc/obheat.env || true
python3 - << 'PY'
import tarfile
tar = tarfile.open("/root/obheat-app-bak-20261030102756.tgz")
member = next(m for m in tar.getmembers() if m.name.endswith("obheat/symbols.py"))
print(tar.extractfile(member).read().decode())
PY

# 3. Совпадает ли живой /opt с архивом
rm -rf /tmp/obheat-prod && mkdir -p /tmp/obheat-prod
tar -C /tmp/obheat-prod -xzf /root/obheat-app-bak-20261030102756.tgz
diff -rq /tmp/obheat-prod/app/obheat /opt/obheat/app/obheat | head -200

# 4. Каждый bak против своего рабочего файла
python3 - << 'PY'
import os, subprocess
root = "/tmp/obheat-prod/app/obheat"
for dirpath, _, names in os.walk(root):
    for name in sorted(names):
        if ".bak" not in name and "bak-" not in name:
            continue
        bak = os.path.join(dirpath, name)
        sibling = name.split(".bak")[0]
        live = os.path.join(dirpath, sibling)
        if os.path.isfile(live):
            r = subprocess.run(["diff", "-q", live, bak], capture_output=True, text=True)
            print(r.stdout.strip() or r.stderr.strip() or f"SAME {bak}")
        else:
            print(f"NO SIBLING {bak}")
PY
```

Дальше — unified diff рабочего дерева против `main` `9bf77f18` для:

`symbols.py`, `serve.py`, `liquidity.py`, `web/index.html`, `web/chart-model.js`, `book.py`, `collect.py`, `engine.py`, `feeds.py`, `native.py`, `query.py`.

И коротко `diff -q` по всему `obheat/`, чтобы не пропустить файл вне этого списка.

Удобнее одним архивом без байткода и без `.bak` (баки — отдельным списком `diff -q` выше):

```bash
tar -C /tmp/obheat-prod -czf /tmp/obheat-prod-app.tgz \
  --exclude='__pycache__' --exclude='*.pyc' \
  app/obheat
```

Плюс каталог `.bak-*` как есть, если они лежат рядом с рабочими файлами: по ним только классификация, в git они не попадут.
