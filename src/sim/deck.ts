// Deck preparation shared by every ngspice backend (native batch runner and WebAssembly).
// Security: a deck may never contain ngspice control blocks, shell escapes or file includes.
export const FORBIDDEN = /^\s*(\.control|\.endc|\.include|\.inc|\.lib|\.exec|shell)\b/i;
export const ANALYSIS = /^\s*\.(op|tran|dc|ac)\b(.*)$/i;
const SAVECURRENTS = /^\s*\.opt\w*\s.*savecurrents/i;

export type AnalysisKind = 'op' | 'tran' | 'dc' | 'ac';
export interface SplitDeck {
  /** Circuit lines (title first), without analysis cards or .end; .option savecurrents ensured. */
  body: string[];
  /** Analysis cards in deck order. */
  analyses: { kind: AnalysisKind; args: string }[];
  errors: string[];
}

export function splitDeck(netlist: string): SplitDeck {
  const errors: string[] = [], body: string[] = [], analyses: SplitDeck['analyses'] = [];
  for (const line of netlist.split(/\r?\n/)) {
    if (FORBIDDEN.test(line)) { errors.push(`Unsupported/forbidden statement: ${line.trim()}`); continue; }
    const m = ANALYSIS.exec(line);
    if (m) { analyses.push({ kind: m[1].toLowerCase() as AnalysisKind, args: m[2] }); continue; }
    if (/^\s*\.end\s*$/i.test(line)) continue;
    body.push(line);
  }
  if (!analyses.length) errors.push('No analysis requested');
  // Device currents (@r1[i] ...) for Probe; user decks may not request them.
  if (!body.some(l => SAVECURRENTS.test(l))) body.splice(1, 0, '.option savecurrents');
  return { body, analyses, errors };
}

/** ngspice-47 yields zero-length device currents in AC with savecurrents, which breaks output: drop it for AC. */
export const bodyFor = (body: string[], kind: AnalysisKind) =>
  kind === 'ac' ? body.filter(l => !/^\s*\.option\s+savecurrents\s*$/i.test(l)) : body;

/** .MEAS statements only belong to the pass of their own analysis type. */
export function measFilter(body: string[], kind: AnalysisKind): string[] {
  return body.filter(l => {
    const m = /^\s*\.meas(?:ure)?\s+(\w+)/i.exec(l);
    return !m || m[1].toLowerCase() === kind;
  });
}

export const PLOT_TITLE: Record<AnalysisKind, string> = {
  op: 'Operating Point', tran: 'Transient Analysis', dc: 'DC transfer characteristic', ac: 'AC Analysis',
};

/** ngspice log lines that indicate a problem (shown to the user). */
export const LOG_PROBLEM = /error|singular|timestep too small|failed|aborted/i;
