/** @deprecated Import the authority-neutral historical instrument helpers directly. */
export {
  historicalInstrumentsMatch as historicalExecutionInstrumentsMatch,
  normalizeHistoricalInstrument as normalizeSymbolForHistoricalExecution,
  tryNormalizeHistoricalInstrument as tryNormalizeSymbolForHistoricalExecution,
  type HistoricalInstrument as HistoricalExecutionInstrument,
} from "@/lib/trader/symbols/historical-instrument";
