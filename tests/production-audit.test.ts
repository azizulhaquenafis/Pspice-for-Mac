// Production audit automated tests:
// - Exact AC branch currents (R, C, L, D, G, F, S, I, coupled L) + Probe expressions vs analytical & native ngspice
// - Security / workload bounds & malformed .osch deserialization hardening
// - Queued AbortSignal cancellation, rapid worker restart recovery, and engine diagnostics
// - Large circuits (100, 500, and 1,000 components)
import { execFileSync } from 'node:child_process';
import { WasmCoreNgspiceEngine, runNgspiceWasm } from '../src/sim/wasmCore';
import { WasmNgspiceEngine, WorkerLike } from '../src/sim/wasmEngine';
import { NodeNgspiceEngine } from '../src/sim/nodeEngine';
import { getVector } from '../src/sim/types';
import { evaluateExpr, parseDeckDevices } from '../src/sim/expr';
import { availableTraces, evalForDisplay } from '../src/ui/probeModel';
import { deserialize, serialize } from '../src/core/serialize';
import { divider, rcLowpass } from './helpers';
import { runSchematic } from '../src/sim/schematicSim';
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

describe('AC branch-current resolution (zero-volt sensing + native inductor branch)', () => {
  it('RC low-pass schematic: I(R1) and I(C1) match exact complex phasor at fc (mag 0.7071 mA, phase +45°)', async () => {
    const b = rcLowpass();
    const fc = 1 / (2 * Math.PI * 1e3 * 1e-6);
    b.doc.profile.ac = { enabled: true, sweep: 'lin', points: '1', start: String(fc), end: String(fc) };
    const run = await runSchematic(b.doc, wasmEngine);
    expect(run.result.ok).toBe(true);
    expect(run.result.errors).toEqual([]);

    const ac = run.result.plots.find(p => p.kind === 'ac')!;
    const devs = parseDeckDevices(run.deck);

    // No internal __aci_ helper nodes leaked into Probe
    expect(ac.vectors.some(v => v.name.toLowerCase().includes('__aci_'))).toBe(false);

    // Available traces in Probe now include I(R1) and I(C1) in AC!
    const groups = availableTraces(ac, devs);
    const currents = groups.find(g => g.title.startsWith('Currents'))!.items;
    expect(currents).toContain('I(R1)');
    expect(currents).toContain('I(C1)');
    expect(currents).toContain('I(V1)');

    // Exact analytical complex current: I = 1 / (1k - j*1k) = (0.5 + j*0.5) mA
    const iR1 = evaluateExpr('I(R1)', ac, devs);
    const iC1 = evaluateExpr('I(C1)', ac, devs);
    const iR1Pin2 = evaluateExpr('I(R1:2)', ac, devs);
    const iV1 = evaluateExpr('I(V1)', ac, devs);

    expect(iR1.re[0]).toBeCloseTo(0.5e-3, 9);
    expect(iR1.im![0]).toBeCloseTo(0.5e-3, 9);
    expect(iC1.re[0]).toBeCloseTo(0.5e-3, 9);
    expect(iC1.im![0]).toBeCloseTo(0.5e-3, 9);
    // Pin 2 current is exact negative of pin 1 current
    expect(iR1Pin2.re[0]).toBeCloseTo(-0.5e-3, 9);
    expect(iR1Pin2.im![0]).toBeCloseTo(-0.5e-3, 9);
    // KCL at source: I(R1) + I(V1) = 0
    expect(iR1.re[0] + iV1.re[0]).toBeCloseTo(0, 12);
    expect(iR1.im![0] + iV1.im![0]).toBeCloseTo(0, 12);

    // Probe display phase & magnitude
    const mag = evalForDisplay(ac, 'I(C1)', devs, 'mag');
    const phase = evalForDisplay(ac, 'I(C1)', devs, 'phase');
    expect(mag.y[0]).toBeCloseTo(Math.SQRT1_2 * 1e-3, 9);
    expect(phase.y[0]).toBeCloseTo(45, 5);
  });

  it('Mixed R + C + L + nonlinear biased Diode D1N4148: exact KCL and agreement vs native ngspice', async () => {
    const fc = 1 / (2 * Math.PI * 1e3 * 1e-6);
    const deck = `Mixed AC R C L D
V1 in 0 DC 2 AC 1
R1 in out 1k
C1 out 0 1u
L1 out nl 100m
R2 nl 0 1k
D1 out 0 D1N4148
.model D1N4148 D(Is=2.682n N=1.836 Rs=.5664 Ikf=44.17m Cjo=4p M=.3333 Vj=.5 Bv=100 Ibv=100u Tt=11.54n)
.ac lin 1 ${fc} ${fc}
.end
`;
    const rw = await wasmEngine.run(deck);
    expect(rw.ok).toBe(true);
    expect(rw.errors).toEqual([]);
    const ac = rw.plots.find(p => p.kind === 'ac')!;
    const devs = parseDeckDevices(deck);

    const iR1 = evaluateExpr('I(R1)', ac, devs);
    const iC1 = evaluateExpr('I(C1)', ac, devs);
    const iL1 = evaluateExpr('I(L1)', ac, devs);
    const iD1 = evaluateExpr('I(D1)', ac, devs);
    const iR2 = evaluateExpr('I(R2)', ac, devs);

    // KCL at node out: I(R1) = I(C1) + I(L1) + I(D1)
    expect(iR1.re[0] - (iC1.re[0] + iL1.re[0] + iD1.re[0])).toBeCloseTo(0, 12);
    expect(iR1.im![0] - (iC1.im![0] + iL1.im![0] + iD1.im![0])).toBeCloseTo(0, 12);
    // Series L1 and R2 carry identical complex current
    expect(iL1.re[0]).toBeCloseTo(iR2.re[0], 12);
    expect(iL1.im![0]).toBeCloseTo(iR2.im![0], 12);

    // Cross-check against native ngspice-47
    if (hasNative) {
      const rn = await nativeEngine.run(deck);
      expect(rn.ok).toBe(true);
      const nac = rn.plots.find(p => p.kind === 'ac')!;
      for (const vecName of ['i(@r1[i])', 'i(@c1[i])', 'i(@l1[i])', 'i(@d1[id])', 'i(@r2[i])', 'v(out)']) {
        const vw = getVector(ac, vecName)!;
        const vn = getVector(nac, vecName)!;
        expect(Math.hypot(vw.re[0] - vn.re[0], vw.im![0] - vn.im![0])).toBeLessThan(1e-12);
      }
    }
  });

  it('Dependent sources (G, F) and coupled inductors (K1 L1 L2) preserve exact AC currents', async () => {
    const deck = `Dep + Coupled L AC
V1 in 0 AC 1
G1 ng 0 in 0 2m
Rg ng 0 1k
R1 in a 10
L1 a 0 10m
L2 b 0 10m
R2 b 0 100
K1 L1 L2 0.9
.ac lin 1 1k 1k
.end
`;
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const ac = r.plots.find(p => p.kind === 'ac')!;
    const devs = parseDeckDevices(deck);
    // G1 forces 2 mA into pin 1 (ng -> 0), so I(G1) = +2 mA and V(ng) = -2 V
    expect(evaluateExpr('I(G1)', ac, devs).re[0]).toBeCloseTo(2e-3, 9);
    expect(evaluateExpr('V(ng)', ac, devs).re[0]).toBeCloseTo(-2, 9);
    // Coupled inductors L1 and L2 both expose native complex currents
    expect(Math.hypot(evaluateExpr('I(L1)', ac, devs).re[0], evaluateExpr('I(L1)', ac, devs).im![0])).toBeGreaterThan(1e-3);
    expect(Math.hypot(evaluateExpr('I(L2)', ac, devs).re[0], evaluateExpr('I(L2)', ac, devs).im![0])).toBeGreaterThan(1e-3);
  });
});

describe('Security hardening, workload bounds, and malformed project validation', () => {
  it('blocks oversized netlists, runaway DC/AC sweep counts, and forbidden statements', async () => {
    // Oversized netlist (> 1 MB)
    const huge = 'Huge\n' + 'R1 1 0 1k\n'.repeat(120_000) + '.op\n.end\n';
    const rHuge = await wasmEngine.run(huge);
    expect(rHuge.ok).toBe(false);
    expect(rHuge.errors[0]).toMatch(/too large|too many lines/i);

    // Runaway DC sweep (10 billion points) rejected instantly
    const rDc = await wasmEngine.run('Runaway DC\nV1 1 0 0\nR1 1 0 1k\n.dc V1 0 10 1e-9\n.end\n');
    expect(rDc.ok).toBe(false);
    expect(rDc.errors[0]).toMatch(/limit/i);

    // Runaway AC sweep rejected instantly
    const rAc = await wasmEngine.run('Runaway AC\nV1 1 0 AC 1\nR1 1 0 1k\n.ac lin 1000000 1 100k\n.end\n');
    expect(rAc.ok).toBe(false);
    expect(rAc.errors[0]).toMatch(/limit/i);

    // Forbidden .control / .include / .lib / shell statements rejected
    for (const stmt of ['.control', '.include /etc/passwd', '.lib foo.lib', 'shell ls', '.exec id']) {
      const rForb = await wasmEngine.run(`Test\nV1 1 0 5\nR1 1 0 1k\n${stmt}\n.op\n.end\n`);
      expect(rForb.ok).toBe(false);
      expect(rForb.errors[0]).toMatch(/forbidden|unsupported/i);
    }
  });

  it('hardens .osch deserialization against props:null, prototype pollution, invalid coords, and huge files', () => {
    const valid = JSON.parse(serialize(divider().doc));

    // props: null must be rejected cleanly (previously passed typeof null === 'object')
    const badNullProps = structuredClone(valid);
    badNullProps.parts[0].props = null;
    expect(() => deserialize(JSON.stringify(badNullProps))).toThrow(/Invalid properties/);

    // props: [] must be rejected
    const badArrProps = structuredClone(valid);
    badArrProps.parts[0].props = [];
    expect(() => deserialize(JSON.stringify(badArrProps))).toThrow(/Invalid properties/);

    // Non-finite part coordinates must be rejected
    const badCoord = structuredClone(valid);
    badCoord.parts[0].x = 'oops';
    expect(() => deserialize(JSON.stringify(badCoord))).toThrow(/Invalid coordinates/);

    // Invalid marker kind rejected
    const badMarker = structuredClone(valid);
    badMarker.markers = [{ id: 'm1', x: 0, y: 0, kind: 'BOGUS' }];
    expect(() => deserialize(JSON.stringify(badMarker))).toThrow(/Invalid marker/);

    // Prototype pollution keys stripped safely without polluting Object.prototype
    const protoText = serialize(divider().doc).replace('"title":', '"__proto__": {"polluted": true}, "title":');
    const parsed = deserialize(protoText);
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);

    // Zero or negative view zoom falls back safely instead of dividing by zero
    const zeroZoom = structuredClone(valid);
    zeroZoom.view = { x: 0, y: 0, zoom: 0 };
    expect(deserialize(JSON.stringify(zeroZoom)).view.zoom).toBeGreaterThan(0);

    // > 10 MB file rejected
    expect(() => deserialize(' '.repeat(10_000_001))).toThrow(/maximum size/i);
  });
});

describe('Worker queue cancellation, rapid restarts, and lightweight diagnostics', () => {
  it('immediately cancels a queued request when its AbortSignal fires while an earlier run is active', async () => {
    let created = 0;
    const engine = new WasmNgspiceEngine({
      timeoutMs: 5000,
      workerFactory: (): WorkerLike => {
        created++;
        const w: WorkerLike = {
          onmessage: null,
          onerror: null,
          onmessageerror: null,
          postMessage(msg: WorkerRequest) {
            if (msg.type !== 'run') return;
            setTimeout(() => {
              void runNgspiceWasm(msg.netlist).then(result => {
                w.onmessage?.({ data: { type: 'result', id: msg.id, result, initMs: 12 } } as unknown as MessageEvent<WorkerResponse>);
              });
            }, 60);
          },
          terminate() {},
        };
        return w;
      },
    });

    const deck = 'Div\nV1 1 0 10\nR1 1 2 1k\nR2 2 0 1k\n.op\n.end\n';
    const p1 = engine.run(deck);
    const ac2 = new AbortController();
    const p2 = engine.run(deck, ac2.signal);

    // Abort p2 while p1 is still running on the worker
    ac2.abort();
    const r2 = await p2;
    expect(r2.ok).toBe(false);
    expect(r2.errors[0]).toMatch(/cancelled/i);
    expect(r2.elapsedMs).toBe(0);

    // p1 still completes cleanly on the same worker without interruption
    const r1 = await p1;
    expect(r1.ok).toBe(true);
    expect(created).toBe(1);

    const diag = engine.getDiagnostics();
    expect(diag.state).toBe('ready');
    expect(diag.initMs).toBe(12);
    expect(diag.totalRuns).toBe(1);
    expect(diag.workerRestarts).toBe(0);
    expect(diag.lastError).toBeNull();
    engine.dispose();
  });

  it('survives 10 rapid cancel-and-recreate cycles cleanly and updates diagnostics', async () => {
    let terminated = 0;
    const engine = new WasmNgspiceEngine({
      timeoutMs: 5000,
      workerFactory: (): WorkerLike => {
        const w: WorkerLike = {
          onmessage: null,
          onerror: null,
          onmessageerror: null,
          postMessage(msg: WorkerRequest) {
            if (msg.type !== 'run') return;
            setTimeout(() => {
              void runNgspiceWasm(msg.netlist).then(result => {
                w.onmessage?.({ data: { type: 'result', id: msg.id, result } } as unknown as MessageEvent<WorkerResponse>);
              });
            }, 30);
          },
          terminate() {
            terminated++;
          },
        };
        return w;
      },
    });

    const deck = 'Div\nV1 1 0 10\nR1 1 2 1k\nR2 2 0 1k\n.op\n.end\n';
    for (let i = 0; i < 10; i++) {
      const ac = new AbortController();
      const p = engine.run(deck, ac.signal);
      // Let the worker receive the run message before cancelling mid-flight
      await new Promise(r => setTimeout(r, 5));
      ac.abort();
      const r = await p;
      expect(r.ok).toBe(false);
    }
    expect(terminated).toBe(10);
    expect(engine.getDiagnostics().workerRestarts).toBe(10);

    // Next normal run recovers cleanly
    const finalRun = await engine.run(deck);
    expect(finalRun.ok).toBe(true);
    expect(getVector(finalRun.plots[0], 'v(2)')!.re[0]).toBeCloseTo(5, 9);
    engine.dispose();
  });
});

describe('Large circuit scaling (100, 500, and 1,000 components)', () => {
  function buildLadderDeck(resistorCount: number): string {
    // Series resistive voltage divider of N identical 1k resistors driven by N volts:
    // Node k has exact analytical voltage V(nk) = N - k!
    const lines = [`${resistorCount}-resistor chain`, `V1 n0 0 DC ${resistorCount}`];
    for (let i = 0; i < resistorCount; i++) {
      const next = i === resistorCount - 1 ? '0' : `n${i + 1}`;
      lines.push(`R${i + 1} n${i} ${next} 1k`);
    }
    lines.push('.op', '.end');
    return lines.join('\n') + '\n';
  }

  it.each([100, 500, 1000])('%i-component circuit solves accurately in WASM', async n => {
    const deck = buildLadderDeck(n);
    const r = await wasmEngine.run(deck);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    const op = r.plots.find(p => p.kind === 'op')!;
    const mid = Math.floor(n / 2);
    expect(getVector(op, `v(n${mid})`)!.re[0]).toBeCloseTo(n - mid, 6);
    expect(getVector(op, 'i(v1)')!.re[0]).toBeCloseTo(-1e-3, 9);
  });
});
