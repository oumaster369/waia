"""Ceilings for the serve process.

A heatmap request and a live stream must not be able to grow RSS without a
bound. Three days is the longest window. Raw seconds are capped per coin;
older history is read from minute rows. SSE clients are a fixed set.
"""

MAX_WINDOW_MINUTES = 4320
MAX_COLUMNS = 2000
MAX_LEVELS = 512
# One coin, one read. 4096 seconds is about 68 minutes of raw ladders.
MAX_SECOND_ROWS = 4096
MAX_MINUTE_ROWS = 4320
MAX_PRINTS = 2000
MAX_SSE_CLIENTS = 16
MAX_SSE_AGE_S = 900.0
MAX_CACHE_ENTRIES = 4
MAX_CACHE_PER_SYMBOL = 2
MAX_CACHE_AGE_S = 60.0
