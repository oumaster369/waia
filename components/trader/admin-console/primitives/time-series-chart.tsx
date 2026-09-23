"use client";

import { createChart, LineSeries } from "lightweight-charts";
import * as React from "react";

export function AdminTimeSeriesChart() {
  const node = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const container = node.current;
    if (!container) return;
    const chart = createChart(container, { height: 160 });
    chart.addSeries(LineSeries);
    return () => chart.remove();
  }, []);
  return (
    <figure>
      <figcaption>График: TradingView Lightweight Charts, Apache-2.0</figcaption>
      <div ref={node} />
    </figure>
  );
}
