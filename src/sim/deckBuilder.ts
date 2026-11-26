// Shared SPICE deck validation, .control wrapping, exact AC branch-current sensing,
// workload bounds, and ngspice error extraction.
// Pure TypeScript with zero Node.js or DOM dependencies — shared by WASM and native engines.

import { parseSpiceNumber } from '../core/units';
import { Plot, Vector } from './types';

export const MAX_NETLIST_CHARS = 1_000_000;
export const MAX_NETLIST_LINES = 50_000;
export const MAX_SWEEP_POINTS = 250_000;
export const MAX_AC_SENSE_DEVICES = 1_500;

const FORBIDDEN = /^\s*(\.control|\.endc|\.include|\.inc|\.lib|\.exec|\.shell|shell)\b/i;
const ANALYSIS = /^\s*\.(op|tran|dc|ac)\b(.*)$/i;

// Lines in ngspice stdout/stderr that represent real errors, warnings about singular/floating
// circuits, convergence failures, missing models, undefined params, or OOM conditions.
const ERROR_LINE_RE =
  /error|singular|timestep too small|failed|aborted|undefined parameter|cannot compute substitute|could not find a valid model|unable to find definition of model|no convergence|out of memory|setting the output memory is not possible|too few nodes|missing ground|not found/i;

// Benign informational/warning lines emitted by ngspice that should not be flagged as errors.
const IGNORED_LINE_RE =
  /^\s*$|can't find the initialization file spinit|warning:\s*can't find init file|note:\s*no compatibility mode|using sparse|using klu|dynamic gmin stepping completed|transient op finished successfully/i;

// Fatal indicators meaning ngspice aborted without producing valid results for the pass.
const FATAL_LINE_RE =
  /circuit not parsed|simulation interrupted due to error|run simulation\(s\) aborted|fatal error in ngspice|no simulations run|cannot compute substitute|undefined parameter|dc solution failed|timestep too small|out of memory|setting the output memory is not possible|could not find a valid model|unable to find definition of model|error during 'write'/i;

export interface DeckBuildResult {
  decks: string[];
  errors: string[];
  /** Mapping from injected AC zero-volt sense current vector (lowercase) to canonical Probe vector name. */
  acSenseMap: Map<string, string>;
}

/** Validate .dc and .ac sweep point counts to block runaway workloads before invoking ngspice. */
function validateAnalysisWorkload(kind: string, rest: string): string | null {
  const toks = rest.trim().split(/\s+/).filter(Boolean);
  if (kind === 'dc' && toks.length >= 4) {
    const start = parseSpiceNumber(toks[1]);
    const stop = parseSpiceNumber(toks[2]);
    const incr = parseSpiceNumber(toks[3]);
    if (start.ok && stop.ok && incr.ok) {
      if (incr.value === 0) return 'DC sweep increment must be non-zero';
      const pts = Math.floor(Math.abs((stop.value - start.value) / incr.value)) + 1;
      if (!isFinite(pts) || pts > MAX_SWEEP_POINTS) {
        return `DC sweep requests ${pts.toLocaleString()} points (limit ${MAX_SWEEP_POINTS.toLocaleString()}). Increase the sweep increment.`;
      }
    }
  } else if (kind === 'ac' && toks.length >= 4) {
    const sweep = toks[0].toLowerCase();
    const n = parseSpiceNumber(toks[1]);
    const f1 = parseSpiceNumber(toks[2]);
    const f2 = parseSpiceNumber(toks[3]);
    if (n.ok && f1.ok && f2.ok && f1.value > 0 && f2.value >= f1.value) {
      let pts = n.value;
      if (sweep === 'dec') pts = Math.ceil(n.value * Math.log10(f2.value / f1.value)) + 1;
      else if (sweep === 'oct') pts = Math.ceil(n.value * Math.log2(f2.value / f1.value)) + 1;
      if (!isFinite(pts) || pts > MAX_SWEEP_POINTS) {
        return `AC sweep requests ${Math.round(pts).toLocaleString()} frequency points (limit ${MAX_SWEEP_POINTS.toLocaleString()}). Reduce points per decade/octave or total points.`;
      }
    }
  }
  return null;
}

/**
 * Instrument the AC pass body with ideal 0 V DC sensing sources in series with terminal 1 of
 * top-level 2-terminal devices (R, C, D, G, F, S, I) so ngspice computes exact small-signal
 * complex branch currents without relying on `.option savecurrents` (which breaks `write` in AC
 * on ngspice 45–47).
 *
 * - Inductors (L) and voltage/dependent-voltage sources (V, E, H) already emit native complex
 *   branch currents (`i(l1)`, `i(v1)`, `i(e1)`, `i(h1)`) in AC and are left untouched.
 * - Preserves exact DC operating point (0 V short), exact small-signal nonlinear linearization
 *   (e.g. diode conductance + junction/diffusion capacitance), exact magnitude/phase, and exact
 *   SPICE current sign convention (positive into terminal 1 / + / anode).
 */
function instrumentAcBody(lines: string[]): { lines: string[]; senseMap: Map<string, string> } {
  const senseMap = new Map<string, string>();
  // Respect explicit user `.save` statements so user-filtered output stays untouched.
  if (lines.some(l => /^\s*\.save\b/i.test(l))) {
    return { lines, senseMap };
  }

  // Count eligible top-level devices first; skip instrumentation on extreme netlists (> MAX_AC_SENSE_DEVICES)
  // to keep matrix size bounded.
  const out: string[] = [];
  let depth = 0;
  let instrumented = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    if (idx === 0) {
      out.push(raw);
      continue;
    }
    const trimmed = raw.trim();
    if (/^\.subckt\b/i.test(trimmed)) {
      depth++;
      out.push(raw);
      continue;
    }
    if (/^\.ends\b/i.test(trimmed)) {
      depth = Math.max(0, depth - 1);
      out.push(raw);
      continue;
    }
    if (depth > 0 || !trimmed || '*.;+'.includes(trimmed[0])) {
      out.push(raw);
      continue;
    }

    // Match top-level R, C, D, G, F, S, I devices (skip internal __ helper devices)
    const m = /^([rcdgfsi][A-Za-z0-9_.-]*)\s+(\S+)\s+(\S+)(\s+.*)?$/i.exec(trimmed);
    if (!m || m[1].includes('__') || instrumented >= MAX_AC_SENSE_DEVICES) {
      out.push(raw);
      continue;
    }

    const [, devName, n1, n2, rest = ''] = m;
    const safe = devName.replace(/[^A-Za-z0-9_]/g, '_');
    const senseSrc = `V__aci_${safe}`;
    const senseNode = `__aci_${safe}`;
    const devLower = devName.toLowerCase();
    const letter = devLower[0];
    const canonical =
      letter === 'd'
        ? `i(@${devLower}[id])`
        : letter === 'i'
          ? `i(@${devLower}[current])`
          : `i(@${devLower}[i])`;

    senseMap.set(`i(${senseSrc.toLowerCase()})`, canonical);
    instrumented++;
    out.push(`${senseSrc} ${n1} ${senseNode} DC 0`);
    out.push(`${devName} ${senseNode} ${n2}${rest}`);
  }

  return { lines: out, senseMap };
}

/**
 * Normalize parsed plots after AC analysis:
 * - Drops internal helper node voltages `v(__aci_*)`.
 * - Renames injected sense-source currents `i(v__aci_<dev>)` to canonical Probe names
 *   (`i(@r1[i])`, `i(@c1[i])`, `i(@d1[id])`, `i(@g1[i])`, `i(@f1[i])`, `i(@s1[i])`, `i(@i1[current])`).
 * - Aliases native ngspice AC inductor currents `i(l*)` to `i(@l*[i])` so `I(L1)` works uniformly.
 */
export function normalizePlots(plots: Plot[], acSenseMap: Map<string, string>): Plot[] {
  return plots.map(plot => {
    if (plot.kind !== 'ac') return plot;
    const vectors: Vector[] = [];
    const existing = new Set<string>();

    for (const v of plot.vectors) {
      const lower = v.name.toLowerCase();
      if (lower.startsWith('v(__aci_')) continue;
      const mapped = acSenseMap.get(lower);
      if (mapped) {
        if (!existing.has(mapped)) {
          vectors.push({ ...v, name: mapped });
          existing.add(mapped);
        }
        continue;
      }
      vectors.push(v);
      existing.add(lower);
    }

    // Alias native AC inductor currents i(l<name>) -> i(@l<name>[i]) without duplicating arrays
    for (const v of [...vectors]) {
      const lm = /^i\((l[^)]+)\)$/i.exec(v.name);
      if (lm) {
        const canonical = `i(@${lm[1].toLowerCase()}[i])`;
        if (!existing.has(canonical)) {
          vectors.push({ ...v, name: canonical });
          existing.add(canonical);
        }
      }
    }

    return { ...plot, vectors };
  });
}

/**
 * Convert analysis cards (.op, .tran, .dc, .ac) into .control commands so each plot is
 * written to an appended ASCII rawfile (__OUT__ placeholder).
 *
 * Returns one deck per ngspice pass: ngspice 45–47 yields zero-length device currents
 * (@r1[i], @c1[i]) in AC analysis when `.option savecurrents` is enabled, which aborts
 * `write`. AC therefore runs in its own pass without `savecurrents`, instrumented with
 * ideal 0 V sensing sources so R/C/D/G/F/S/I branch currents (plus native L/V/E/H currents)
 * are computed accurately by ngspice.
 */
export function buildDecks(netlist: string): DeckBuildResult {
  const errors: string[] = [];
  const emptySense = new Map<string, string>();
  if (!netlist || !netlist.trim()) {
    return { decks: [], errors: ['Empty netlist'], acSenseMap: emptySense };
  }
  if (netlist.length > MAX_NETLIST_CHARS) {
    return {
      decks: [],
      errors: [`Netlist is too large (${(netlist.length / 1024).toFixed(0)} KB; limit ${MAX_NETLIST_CHARS / 1024} KB).`],
      acSenseMap: emptySense,
    };
  }

  const rawLines = netlist.split(/\r?\n/);
  if (rawLines.length > MAX_NETLIST_LINES) {
    return {
      decks: [],
      errors: [`Netlist has too many lines (${rawLines.length.toLocaleString()}; limit ${MAX_NETLIST_LINES.toLocaleString()}).`],
      acSenseMap: emptySense,
    };
  }

  const body: string[] = [];
  const cmds: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (i > 0 && FORBIDDEN.test(line)) {
      errors.push(`Unsupported/forbidden statement: ${line.trim()}`);
      continue;
    }
    const m = i > 0 ? ANALYSIS.exec(line) : null;
    if (m) {
      const kind = m[1].toLowerCase();
      const rest = m[2];
      const wlErr = validateAnalysisWorkload(kind, rest);
      if (wlErr) errors.push(wlErr);
      else cmds.push(`${kind}${rest}`);
      continue;
    }
    if (i > 0 && /^\s*\.end\s*$/i.test(line)) continue;
    body.push(line);
  }
  if (!cmds.length && !errors.length) errors.push('No analysis requested');
  if (errors.length) return { decks: [], errors, acSenseMap: emptySense };

  // Ensure line 0 is a title line before inserting .option savecurrents at index 1.
  if (body.length === 0) body.push('* OpenSpice circuit');
  // Device currents (@r1[i] ...) for Probe; user decks may not request them.
  if (!body.some(l => /^\s*\.opt\w*\s.*savecurrents/i.test(l))) {
    body.splice(1, 0, '.option savecurrents');
  }

  const deck = (b: string[], cs: string[]) =>
    [
      ...b,
      '.control',
      'set filetype=ascii',
      'set appendwrite',
      ...cs.flatMap(c => [c, 'write __OUT__']),
      'quit',
      '.endc',
      '.end',
    ].join('\n') + '\n';

  const main = cmds.filter(c => !c.startsWith('ac'));
  const ac = cmds.filter(c => c.startsWith('ac'));
  const decks: string[] = [];
  let acSenseMap = emptySense;

  if (main.length) decks.push(deck(body, main));
  if (ac.length) {
    const acBase = body.filter(l => !/^\s*\.opt\w*\s+savecurrents\b/i.test(l));
    const inst = instrumentAcBody(acBase);
    acSenseMap = inst.senseMap;
    decks.push(deck(inst.lines, ac));
  }
  return { decks, errors, acSenseMap };
}

/**
 * Extract meaningful ngspice error messages from combined stdout/stderr logs,
 * deduplicating consecutive identical lines while preserving line-reference errors
 * needed by `mapErrors()` in Netlist Mode.
 */
export function extractNgspiceErrors(log: string, hasRaw: boolean): { errors: string[]; fatal: boolean } {
  const rawLines = log.split(/\r?\n/);
  const errs: string[] = [];
  let fatal = false;
  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line || IGNORED_LINE_RE.test(line)) continue;
    if (FATAL_LINE_RE.test(line)) fatal = true;
    if (ERROR_LINE_RE.test(line)) {
      if (errs[errs.length - 1] !== line) errs.push(line);
    }
  }

  if (!hasRaw && errs.length === 0) {
    return { errors: ['ngspice produced no simulation results'], fatal: true };
  }
  return { errors: errs, fatal: fatal || !hasRaw };
}

/** Classify low-level WASM / Worker runtime exceptions into clear user-facing errors. */
export function formatEngineError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/out of memory|oom|could not allocate memory|memory access out of bounds|abort\(oom\)/i.test(msg)) {
    return `Simulation ran out of memory in WebAssembly (${msg}). Try increasing Step Ceiling / Print Step or reducing sweep size.`;
  }
  if (/wasm|webassembly|failed to fetch|networkerror|compile|instantiate|magic word|mime/i.test(msg)) {
    return `Failed to initialize ngspice WebAssembly engine: ${msg}`;
  }
  return msg || 'Unknown simulation engine error';
}
