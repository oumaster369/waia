"""Пауза между ресинками одной площадки.

Дыра в книге ставит needs_resync, и каждый следующий дифф звал _schedule_resync.
У Bybit/OKX/HTX _resync — это ещё одна подписка, и она завершается без ошибки,
даже если книга всё ещё грязная. Старый код на успехе обнулял счётчик неудач
и не отодвигал следующее время, поэтому следующий дифф сразу планировал ещё
одну подписку. Биржа отвечала полным снимком, снимок снова не сходился,
и цикл крутился на 100% CPU, пока рукопожатия остальных сокетов не отваливались
по таймауту. Так вставали и основной сборщик, и alt (BYBIT/HTX/OKX).
"""

from __future__ import annotations


def resync_delay(failures: int, *, error: bool = False) -> float:
    """Секунды до следующей попытки. `failures` — уже учтённая неудача (1 = первая).

    Грязная книга: 1, 2, 4, … 60 с. Исключение: от 5 с до 300 с, чтобы
    падающий ресинк не крутился вхолостую.
    """
    step = min(max(int(failures), 0), 6)
    base = float(2 ** step)
    if error:
        return min(300.0, max(5.0, base * 5.0))
    return min(60.0, base)


class ResyncScheduler:
    """Один символ — одна попытка, и следующая не раньше backoff."""

    def __init__(self) -> None:
        self.busy: set[str] = set()
        self.next_at: dict[str, float] = {}
        self.failures: dict[str, int] = {}

    def allow(self, symbol: str, now: float) -> bool:
        if now < self.next_at.get(symbol, 0.0):
            return False
        if symbol in self.busy:
            return False
        self.busy.add(symbol)
        # Даже мгновенный «успех» не должен пустить следующий дифф сразу.
        self.next_at[symbol] = now + resync_delay(self.failures.get(symbol, 0))
        return True

    def defer(self, symbol: str, until: float) -> None:
        """Не раньше `until` (REST-пол Binance — раз в минуту, пока ждём мост)."""
        self.next_at[symbol] = max(self.next_at.get(symbol, 0.0), until)

    def finish(self, symbol: str, *, healed: bool, now: float, error: bool = False) -> None:
        try:
            if error or not healed:
                self.failures[symbol] = min(8, self.failures.get(symbol, 0) + 1)
                until = now + resync_delay(self.failures[symbol], error=error)
                self.next_at[symbol] = max(self.next_at.get(symbol, 0.0), until)
            else:
                self.failures[symbol] = 0
                self.next_at[symbol] = 0.0
        finally:
            self.busy.discard(symbol)
