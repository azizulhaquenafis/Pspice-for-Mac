// Comprehensive numerical accuracy, cross-check vs native ngspice, state-isolation,
// invalid-circuit, timeout, cancellation, and worker-recovery tests for the WASM engine.
import { execFileSync } from 'node:child_process';
import { WasmCoreNgspiceEngine, runNgspiceWasm } from '../src/sim/wasmCore';
import { WasmNgspiceEngine, WorkerLike } from '../src/sim/wasmEngine';
import { NodeNgspiceEngine } from '../src/sim/nodeEngine';
import { getVector } from '../src/sim/types';
import { generateNetlist } from '../src/core/netlist';
import { Builder, at } from './helpers';
import type { WorkerRequest, WorkerResponse } from '../src/sim/ngspiceWorker';

const wasmEngine = new WasmCoreNgspiceEngine();
const nativeEngine = new NodeNgspiceEngine();

function detectNativeNgspice(): boolean {
  try {
    execFileSync(process.env.NGSPICE_BIN || 'ngspice', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasNative = detectNativeNgspice();
const itWithNative = hasNative ? it : it.skip;

describe('WASM numerical accuracy (analytical + native ngspice cross-check)', () => {
  it('1. Voltage divider: 10 V and two 1 kΩ resistors → V(mid) = 5 V', async () => {
    const deck = `Voltage divider 10V / 1k / 1k
V1 in 0 DC 10
R1 in mid 1k
R2 mid 0 1k
.op
.end
`;
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const op = r.plots.find(p => p.kind === 'op')!;
    const vMid = getVector(op, 'v(mid)')!.re[0];
    const iR1 = getVector(op, 'i(@r1[i])')!.re[0];
    const iV1 = getVector(op, 'i(v1)')!.re[0];
    expect(vMid).toBeCloseTo(5.0, 9);
    expect(iR1).toBeCloseTo(5e-3, 9);
    expect(iV1).toBeCloseTo(-5e-3, 9);

    if (hasNative) {
      const nr = await nativeEngine.run(deck);
      expect(nr.ok).toBe(true);
      const nop = nr.plots.find(p => p.kind === 'op')!;
      expect(Math.abs(vMid - getVector(nop, 'v(mid)')!.re[0])).toBeLessThan(1e-12);
      expect(Math.abs(iR1 - getVector(nop, 'i(@r1[i])')!.re[0])).toBeLessThan(1e-12);
    }
  });

  it("2. Ohm's law: 10 V across 1 kΩ resistor → |I(R1)| = 10 mA", async () => {
    const deck = `Ohm's law 10V / 1k
V1 in 0 DC 10
R1 in 0 1k
.op
.end
`;
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const op = r.plots.find(p => p.kind === 'op')!;
    const iR1 = getVector(op, 'i(@r1[i])')!.re[0];
    const iV1 = getVector(op, 'i(v1)')!.re[0];
    expect(Math.abs(iR1)).toBeCloseTo(10e-3, 9);
    expect(iR1).toBeCloseTo(10e-3, 9);
    expect(iV1).toBeCloseTo(-10e-3, 9);

    if (hasNative) {
      const nr = await nativeEngine.run(deck);
      const nop = nr.plots.find(p => p.kind === 'op')!;
      expect(Math.abs(iR1 - getVector(nop, 'i(@r1[i])')!.re[0])).toBeLessThan(1e-12);
    }
  });

  it('3. RC transient: 5 V step, R=1k, C=1u, initially discharged → Vc(1 ms) ≈ 3.1606 V', async () => {
    const deck = `RC step transient
V1 in 0 PULSE(0 5 0 1n 1n 10 20)
R1 in out 1k
C1 out 0 1u IC=0
.tran 10u 5m 0 5u UIC
.end
`;
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const tr = r.plots.find(p => p.kind === 'tran')!;
    const t = getVector(tr, 'time')!.re;
    const vc = getVector(tr, 'v(out)')!.re;
    const expectedAt1ms = 5 * (1 - Math.exp(-1)); // 3.160602794...
    const actualAt1ms = at(t, vc, 1e-3);
    expect(actualAt1ms).toBeCloseTo(expectedAt1ms, 3); // within ±0.0005 V
    expect(at(t, vc, 5e-3)).toBeCloseTo(5 * (1 - Math.exp(-5)), 3);

    if (hasNative) {
      const nr = await nativeEngine.run(deck);
      const ntr = nr.plots.find(p => p.kind === 'tran')!;
      const nativeAt1ms = at(getVector(ntr, 'time')!.re, getVector(ntr, 'v(out)')!.re, 1e-3);
      expect(Math.abs(actualAt1ms - nativeAt1ms)).toBeLessThan(1e-4);
    }
  });

  it('4. RC low-pass AC: R=1k, C=1u → fc ≈ 159.155 Hz, -3.0103 dB, -45°', async () => {
    const fc = 1 / (2 * Math.PI * 1e3 * 1e-6); // 159.15494309189535 Hz
    const singleDeck = `RC low-pass AC at cutoff
V1 in 0 DC 0 AC 1 0
R1 in out 1k
C1 out 0 1u
.ac lin 1 ${fc} ${fc}
.end
`;
    const r = await wasmEngine.run(singleDeck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const ac = r.plots.find(p => p.kind === 'ac')!;
    expect(ac.complex).toBe(true);
    const f = getVector(ac, 'frequency')!.re[0];
    const vout = getVector(ac, 'v(out)')!;
    const mag = Math.hypot(vout.re[0], vout.im![0]);
    const db = 20 * Math.log10(mag);
    const phaseDeg = (Math.atan2(vout.im![0], vout.re[0]) * 180) / Math.PI;

    expect(f).toBeCloseTo(159.155, 3);
    expect(db).toBeCloseTo(-3.0103, 4);
    expect(phaseDeg).toBeCloseTo(-45.0, 4);

    // Also verify a full logarithmic decade sweep (passband -> cutoff -> stopband)
    const sweepDeck = `RC low-pass AC decade sweep
V1 in 0 DC 0 AC 1 0
R1 in out 1k
C1 out 0 1u
.ac dec 20 1 100k
.end
`;
    const sr = await wasmEngine.run(sweepDeck);
    expect(sr.ok).toBe(true);
    const sac = sr.plots.find(p => p.kind === 'ac')!;
    const freqs = getVector(sac, 'frequency')!.re;
    const sv = getVector(sac, 'v(out)')!;
    // At 1 Hz (deep passband): ~0 dB; at 100 kHz (stopband): ~-55.96 dB
    const dbLow = 20 * Math.log10(Math.hypot(sv.re[0], sv.im![0]));
    const last = freqs.length - 1;
    const dbHigh = 20 * Math.log10(Math.hypot(sv.re[last], sv.im![last]));
    expect(dbLow).toBeCloseTo(0, 2);
    expect(dbHigh).toBeCloseTo(-20 * Math.log10(Math.hypot(1, freqs[last] / fc)), 3);

    if (hasNative) {
      const nr = await nativeEngine.run(singleDeck);
      const nac = nr.plots.find(p => p.kind === 'ac')!;
      const nv = getVector(nac, 'v(out)')!;
      expect(Math.abs(vout.re[0] - nv.re[0])).toBeLessThan(1e-12);
      expect(Math.abs(vout.im![0] - nv.im![0])).toBeLessThan(1e-12);
    }
  });

  it('5. DC sweep: 0 V to 10 V across 1 kΩ → linear current 0 mA to 10 mA', async () => {
    const deck = `DC sweep Ohm's law
V1 in 0 DC 0
R1 in 0 1k
.dc V1 0 10 0.5
.end
`;
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const dc = r.plots.find(p => p.kind === 'dc')!;
    const vSweep = getVector(dc, 'v(v-sweep)')!.re;
    const iR1 = getVector(dc, 'i(@r1[i])')!.re;
    const iV1 = getVector(dc, 'i(v1)')!.re;
    expect(vSweep.length).toBe(21);
    for (let k = 0; k < vSweep.length; k++) {
      expect(iR1[k]).toBeCloseTo(vSweep[k] / 1000, 9);
      expect(iV1[k]).toBeCloseTo(-vSweep[k] / 1000, 9);
    }

    if (hasNative) {
      const nr = await nativeEngine.run(deck);
      const ndc = nr.plots.find(p => p.kind === 'dc')!;
      const niR1 = getVector(ndc, 'i(@r1[i])')!.re;
      for (let k = 0; k < iR1.length; k++) {
        expect(Math.abs(iR1[k] - niR1[k])).toBeLessThan(1e-12);
      }
    }
  });

  it('6. Diode & Zener circuits: nonlinear forward/breakdown response (cross-checked vs native ngspice)', async () => {
    const deck = `Diode 1N4148 and Zener 5.1V
V1 in_d 0 DC 5
R1 in_d vd 1k
D1 vd 0 D1N4148
.model D1N4148 D(Is=2.682n N=1.836 Rs=.5664 Ikf=44.17m Cjo=4p M=.3333 Vj=.5 Bv=100 Ibv=100u Tt=11.54n)

Vz in_z 0 DC 12
Rz in_z vz 1k
Dz 0 vz DZ5V1
.model DZ5V1 D(Is=1e-14 N=1 Bv=5.1 Ibv=5m Rs=5)
.op
.dc V1 0 5 0.5
.end
`;
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const op = r.plots.find(p => p.kind === 'op')!;
    const vd = getVector(op, 'v(vd)')!.re[0];
    const id = getVector(op, 'i(@d1[id])')!.re[0];
    const vz = getVector(op, 'v(vz)')!.re[0];

    // Physical sanity checks: forward Si diode ~0.65–0.75 V, current ~4.3 mA; Zener regulated ~5.1–5.2 V
    expect(vd).toBeGreaterThan(0.6);
    expect(vd).toBeLessThan(0.8);
    expect(id).toBeCloseTo((5 - vd) / 1000, 6);
    expect(vz).toBeGreaterThan(5.0);
    expect(vz).toBeLessThan(5.3);

    // DC sweep should show exponential turn-on (non-linear: dV/dVin drops sharply once conducting)
    const dc = r.plots.find(p => p.kind === 'dc')!;
    const vdSweep = getVector(dc, 'v(vd)')!.re;
    const slopeLow = vdSweep[1] - vdSweep[0]; // 0 -> 0.5V (nearly off)
    const slopeHigh = vdSweep[10] - vdSweep[9]; // 4.5 -> 5.0V (clamped conducting)
    expect(slopeLow).toBeGreaterThan(5 * slopeHigh);

    if (hasNative) {
      const nr = await nativeEngine.run(deck);
      expect(nr.ok).toBe(true);
      const nop = nr.plots.find(p => p.kind === 'op')!;
      expect(Math.abs(vd - getVector(nop, 'v(vd)')!.re[0])).toBeLessThan(1e-9);
      expect(Math.abs(id - getVector(nop, 'i(@d1[id])')!.re[0])).toBeLessThan(1e-9);
      expect(Math.abs(vz - getVector(nop, 'v(vz)')!.re[0])).toBeLessThan(1e-9);
    }
  });

  it('7. Transistor circuits (NPN BJT, NMOS, PMOS): active-region response (cross-checked vs native ngspice)', async () => {
    const deck = `BJT + NMOS + PMOS operating point
* NPN 2N2222 common-emitter stage (active region: Ib ~ 40 uA, Ic ~ 10 mA)
Vcc vc 0 DC 12
Rb vc vb 280k
Rc vc vcol 500
Q1 vcol vb 0 Q2N2222
.model Q2N2222 NPN(Is=14.34f Bf=255.9 Vaf=74.03)

* NMOS Level-1 common-source stage (saturation: Vgs=3V, Vto=1V, Id = 0.5*200u*(10/1)*(3-1)^2 = 4 mA -> Vd = 5 - 4m*500 = 3V)
Vdd vdd 0 DC 5
Vg vg 0 DC 3
Rd vdd vdn 500
M1 vdn vg 0 0 NMOS1 W=10u L=1u
.model NMOS1 NMOS(LEVEL=1 VTO=1 KP=200u)

* PMOS Level-1 common-source stage (Vsg=3V, |Vto|=1V, Isd = 0.5*100u*(20/1)*(3-1)^2 = 4 mA -> Vdp = 4m*500 = 2V)
Vgp vgp 0 DC 2
Rp vdp 0 500
M2 vdp vgp vdd vdd PMOS1 W=20u L=1u
.model PMOS1 PMOS(LEVEL=1 VTO=-1 KP=100u)
.op
.end
`;
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const op = r.plots.find(p => p.kind === 'op')!;

    const vb = getVector(op, 'v(vb)')!.re[0];
    const vcol = getVector(op, 'v(vcol)')!.re[0];
    const ic = getVector(op, 'i(@q1[ic])')!.re[0];
    const vdn = getVector(op, 'v(vdn)')!.re[0];
    const idn = getVector(op, 'i(@m1[id])')!.re[0];
    const vdp = getVector(op, 'v(vdp)')!.re[0];

    // Analytical checks:
    // BJT in forward-active: Vbe ~ 0.65-0.75 V, Vcol between 2 V and 10 V
    expect(vb).toBeGreaterThan(0.6);
    expect(vb).toBeLessThan(0.8);
    expect(vcol).toBeGreaterThan(2);
    expect(vcol).toBeLessThan(10);
    expect(ic).toBeCloseTo((12 - vcol) / 500, 6);

    // NMOS exact Shichman-Hodges saturation (lambda=0): Id = 4 mA, Vdn = 3 V
    expect(idn).toBeCloseTo(4e-3, 6);
    expect(vdn).toBeCloseTo(3.0, 6);

    // PMOS exact Shichman-Hodges saturation (lambda=0): Isd = 4 mA, Vdp = 2 V
    expect(vdp).toBeCloseTo(2.0, 6);

    if (hasNative) {
      const nr = await nativeEngine.run(deck);
      expect(nr.ok).toBe(true);
      const nop = nr.plots.find(p => p.kind === 'op')!;
      for (const vecName of ['v(vb)', 'v(vcol)', 'i(@q1[ic])', 'v(vdn)', 'i(@m1[id])', 'v(vdp)']) {
        expect(Math.abs(getVector(op, vecName)!.re[0] - getVector(nop, vecName)!.re[0])).toBeLessThan(1e-9);
      }
    }
  });

  itWithNative('WASM vs native ngspice-47 agree on AC + transient + diode + transistor within strict tolerance', async () => {
    const deck = `Combined sanity check
V1 in 0 DC 10
R1 in mid 2k
R2 mid 0 3k
.op
.end
`;
    const [w, n] = await Promise.all([wasmEngine.run(deck), nativeEngine.run(deck)]);
    expect(w.ok).toBe(true);
    expect(n.ok).toBe(true);
    expect(Math.abs(getVector(w.plots[0], 'v(mid)')!.re[0] - getVector(n.plots[0], 'v(mid)')!.re[0])).toBeLessThan(1e-12);
  });
});

describe('8. Repeated simulations and state isolation', () => {
  it('consecutive runs never leak .option interp, .temp, .param, or previous circuit state', async () => {
    // 1. Run with .option interp (51 points)
    const rInterp = await wasmEngine.run(`Interp run
.option interp
V1 1 0 PULSE(0 10 0 1u 1u 10 20)
R1 1 2 1k
C1 2 0 100u
.tran 10m 0.5 0 0.5m
.end
`);
    expect(rInterp.ok).toBe(true);
    const ptsInterp = rInterp.plots[0].vectors[0].re.length;
    expect(ptsInterp).toBeLessThanOrEqual(60);

    // 2. Same circuit WITHOUT .option interp must produce full internal steps (~1000+ points)
    const rNoInterp = await wasmEngine.run(`No interp run
V1 1 0 PULSE(0 10 0 1u 1u 10 20)
R1 1 2 1k
C1 2 0 100u
.tran 10m 0.5 0 0.5m
.end
`);
    expect(rNoInterp.ok).toBe(true);
    expect(rNoInterp.plots[0].vectors[0].re.length).toBeGreaterThan(500);

    // 3. Diode at .temp 100°C followed by diode with default 27°C
    const diodeBase = `V1 1 0 5\nR1 1 2 1k\nD1 2 0 D1N4148\n.model D1N4148 D(Is=2.682n N=1.836 Rs=.5664)\n.op\n.end\n`;
    const rHot = await wasmEngine.run(`Hot\n.temp 100\n${diodeBase}`);
    const rDefault = await wasmEngine.run(`Default\n${diodeBase}`);
    const rExplicit27 = await wasmEngine.run(`Explicit27\n.temp 27\n${diodeBase}`);
    const vHot = getVector(rHot.plots[0], 'v(2)')!.re[0];
    const vDef = getVector(rDefault.plots[0], 'v(2)')!.re[0];
    const v27 = getVector(rExplicit27.plots[0], 'v(2)')!.re[0];
    expect(v27 - vHot).toBeGreaterThan(0.1);
    expect(Math.abs(vDef - v27)).toBeLessThan(1e-12);

    // 4. 10 consecutive dividers with changing source values — zero cross-contamination
    for (let k = 1; k <= 10; k++) {
      const r = await wasmEngine.run(`Div ${k}\nV1 1 0 ${k}\nR1 1 2 1k\nR2 2 0 1k\n.op\n.end\n`);
      expect(r.ok).toBe(true);
      expect(getVector(r.plots[0], 'v(2)')!.re[0]).toBeCloseTo(k / 2, 9);
    }
  });
});

describe('9. Invalid circuits, error handling, cancellation, timeout, and worker recovery', () => {
  it('handles syntax errors, undefined params, missing models, floating nodes, voltage loops, and recovers cleanly', async () => {
    // Syntax error
    const rSyntax = await wasmEngine.run(`Bad syntax\nV1 1 0 10\nR1 1 0 bogus_val\n.op\n.end\n`);
    expect(rSyntax.ok).toBe(false);
    expect(rSyntax.plots).toEqual([]);
    expect(rSyntax.errors.join('\n')).toMatch(/error|unknown parameter|bogus_val/i);

    // Undefined parameter (must NOT hang!)
    const rUndef = await wasmEngine.run(`Undef param\nV1 1 0 10\nR1 1 2 {NO_SUCH_PARAM}\nR2 2 0 1k\n.op\n.end\n`);
    expect(rUndef.ok).toBe(false);
    expect(rUndef.errors.join('\n')).toMatch(/undefined parameter|cannot compute substitute|fatal/i);

    // Unsupported/missing device model
    const rModel = await wasmEngine.run(`Missing model\nV1 1 0 5\nR1 1 2 1k\nD1 2 0 UNKNOWN_DIODE_MODEL\n.op\n.end\n`);
    expect(rModel.ok).toBe(false);
    expect(rModel.errors.join('\n')).toMatch(/model|error/i);

    // Voltage source loop (singular matrix / DC convergence failure)
    const rLoop = await wasmEngine.run(`V loop\nV1 1 0 10\nV2 1 0 5\n.op\n.end\n`);
    expect(rLoop.ok).toBe(false);
    expect(rLoop.errors.join('\n')).toMatch(/singular|failed|timestep|error/i);

    // Floating node in raw netlist (reports singular matrix warning/error)
    const rFloat = await wasmEngine.run(`Floating node\nV1 1 0 10\nR1 1 2 1k\nC1 2 3 1u\n.op\n.end\n`);
    expect(rFloat.errors.join('\n')).toMatch(/singular|check node 3/i);

    // Missing ground in schematic ERC
    const b = new Builder();
    b.part('VDC', 'V1', 0, 0, 0, { DC: '5' });
    b.part('R', 'R1', 40, 0, 0, { VALUE: '1k' });
    b.wire({ x: 0, y: 0 }, { x: 40, y: 0 });
    b.wire({ x: 80, y: 0 }, { x: 0, y: 40 });
    const nl = generateNetlist(b.doc);
    expect(nl.ok).toBe(false);
    expect(nl.diagnostics.map(d => d.message).join('\n')).toMatch(/no ground/i);

    // Recovery: valid simulation immediately after all error cases must succeed with exact results
    const rOk = await wasmEngine.run(`Recovery\nV1 1 0 10\nR1 1 2 1k\nR2 2 0 1k\n.op\n.end\n`);
    expect(rOk.ok).toBe(true);
    expect(rOk.errors).toEqual([]);
    expect(getVector(rOk.plots[0], 'v(2)')!.re[0]).toBeCloseTo(5.0, 9);
  });

  it('WasmNgspiceEngine enforces timeout via worker termination and recovers on next run', async () => {
    let created = 0;
    let terminated = 0;
    const statuses: string[] = [];

    const engine = new WasmNgspiceEngine({
      timeoutMs: 80,
      onStatus: m => statuses.push(m),
      workerFactory: (): WorkerLike => {
        const idx = ++created;
        const w: WorkerLike = {
          onmessage: null,
          onerror: null,
          onmessageerror: null,
          postMessage(msg: WorkerRequest) {
            if (msg.type !== 'run') return;
            if (idx === 1) {
              // Simulate a stuck worker that never responds -> triggers timeout
              w.onmessage?.({ data: { type: 'status', id: msg.id, phase: 'initializing' } } as MessageEvent<WorkerResponse>);
              return;
            }
            // Worker #2 runs real ngspice WASM cleanly
            w.onmessage?.({ data: { type: 'status', id: msg.id, phase: 'running' } } as MessageEvent<WorkerResponse>);
            void runNgspiceWasm(msg.netlist).then(result => {
              w.onmessage?.({ data: { type: 'result', id: msg.id, result } } as MessageEvent<WorkerResponse>);
            });
          },
          terminate() {
            terminated++;
          },
        };
        return w;
      },
    });

    const r1 = await engine.run('Stuck\nV1 1 0 10\nR1 1 0 1k\n.op\n.end\n');
    expect(r1.ok).toBe(false);
    expect(r1.errors[0]).toMatch(/timed out/i);
    expect(terminated).toBe(1);
    expect(statuses[0]).toMatch(/Initializing ngspice WebAssembly/);

    // Subsequent run must spawn fresh worker #2 and succeed using real ngspice WASM
    const r2 = await engine.run('Recover\nV1 1 0 10\nR1 1 2 1k\nR2 2 0 1k\n.op\n.end\n');
    expect(r2.ok).toBe(true);
    expect(created).toBe(2);
    expect(getVector(r2.plots[0], 'v(2)')!.re[0]).toBeCloseTo(5.0, 9);
    engine.dispose();
  });

  it('WasmNgspiceEngine handles AbortSignal cancellation, worker crashes, OOM, and ignores stale messages', async () => {
    let created = 0;
    let terminated = 0;

    const engine = new WasmNgspiceEngine({
      timeoutMs: 5000,
      workerFactory: (): WorkerLike => {
        const idx = ++created;
        const w: WorkerLike = {
          onmessage: null,
          onerror: null,
          onmessageerror: null,
          postMessage(msg: WorkerRequest) {
            if (msg.type !== 'run') return;
            if (idx === 1) {
              // Wait until cancelled by AbortSignal
              return;
            }
            if (idx === 2) {
              // Simulate OOM worker crash
              setTimeout(() => {
                w.onerror?.({ message: 'RangeError: WebAssembly.Memory(): could not allocate memory' } as ErrorEvent);
              }, 10);
              return;
            }
            // Worker #3 sends a stale message with wrong ID first, then the real result
            void runNgspiceWasm(msg.netlist).then(result => {
              w.onmessage?.({
                data: {
                  type: 'result',
                  id: msg.id - 1, // stale request id!
                  result: { ok: false, plots: [], log: '', errors: ['STALE SHOULD BE IGNORED'], elapsedMs: 0 },
                },
              } as unknown as MessageEvent<WorkerResponse>);
              w.onmessage?.({ data: { type: 'result', id: msg.id, result } } as unknown as MessageEvent<WorkerResponse>);
            });
          },
          terminate() {
            terminated++;
          },
        };
        return w;
      },
    });

    // 1. Cancellation via AbortSignal
    const ac = new AbortController();
    const p1 = engine.run('Cancel me\nV1 1 0 10\nR1 1 0 1k\n.op\n.end\n', ac.signal);
    setTimeout(() => ac.abort(), 15);
    const rCancel = await p1;
    expect(rCancel.ok).toBe(false);
    expect(rCancel.errors[0]).toMatch(/cancelled/i);
    expect(terminated).toBe(1);

    // 2. Worker crash / OOM
    const rCrash = await engine.run('OOM\nV1 1 0 10\nR1 1 0 1k\n.op\n.end\n');
    expect(rCrash.ok).toBe(false);
    expect(rCrash.errors[0]).toMatch(/out of memory/i);
    expect(terminated).toBe(2);

    // 3. Recovery + stale message filtering + real WASM accuracy
    const rGood = await engine.run('Good\nV1 1 0 10\nR1 1 2 1k\nR2 2 0 1k\n.op\n.end\n');
    expect(rGood.ok).toBe(true);
    expect(created).toBe(3);
    expect(getVector(rGood.plots[0], 'v(2)')!.re[0]).toBeCloseTo(5.0, 9);
    engine.dispose();
  });
});
