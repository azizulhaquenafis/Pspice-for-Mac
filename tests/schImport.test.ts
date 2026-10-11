// PSpice Schematics (.sch) import. NOTE: the fixture was written by hand following the documented
// PSpice 9.1 file layout; it checks the importer's logic, not compatibility with every real file.
import { readFileSync } from 'node:fs';
import { importSch } from '../src/core/schImport';
import { generateNetlist } from '../src/core/netlist';
import { simulate, vec } from './helpers';

const fixture = readFileSync(new URL('./fixtures/divider91.sch', import.meta.url), 'utf8');

describe('.sch import', () => {
  const r = importSch(fixture, 'divider91.sch');
  it('reads parts, values, references, wires, labels and grounds', () => {
    const refs = r.doc.parts.map(p => `${p.type}:${p.ref}`).sort();
    expect(refs).toEqual(['AGND:', 'AGND:', 'R:R1', 'R:R2', 'VDC:V1']);
    expect(r.doc.parts.find(p => p.ref === 'R1')!.props.VALUE).toBe('2k');
    expect(r.doc.parts.find(p => p.ref === 'V1')!.props.DC).toBe('10V');
    expect(r.doc.labels.some(l => l.kind === 'alias' && l.text === 'OUT')).toBe(true);
  });
  it('corrects an orientation whose pins miss the wires (R2 stored as "d")', () => {
    expect(r.notes.join()).toMatch(/turned so their pins meet the wires/);
    const nl = generateNetlist(r.doc);
    expect(nl.ok).toBe(true);
    expect(nl.text).toMatch(/^R2 OUT 0 3000$|^R2 0 OUT 3000$/m);
  });
  it('reports unsupported parts and skips title blocks', () => {
    expect(r.warnings.join('\n')).toMatch(/Unsupported part "Q2N2222" \(Q1\)/);
    expect(r.warnings.join('\n')).not.toMatch(/titleblk/i);
  });
  it('imports the analysis setup', () => {
    expect(r.doc.profile.tran).toMatchObject({ enabled: true, printStep: '1ms', finalTime: '0.5' });
    expect(r.doc.profile.dc).toMatchObject({ enabled: true, source: 'V1', start: '-10', end: '10', incr: '1' });
  });
  it('the imported circuit simulates: V(OUT) = 6 V', async () => {
    const doc = { ...r.doc, profile: { ...r.doc.profile, tran: { ...r.doc.profile.tran, enabled: false }, dc: { ...r.doc.profile.dc, enabled: false } } };
    expect(vec(await simulate(doc), 'op', 'v(out)')[0]).toBeCloseTo(6, 9);
  });
  it('joins pins that are slightly off the wire ends with a short wire, and says so', async () => {
    const shifted = fixture.replace('part 3 r 120 110 h', 'part 3 r 130 110 h'); // R1 pins now 10 units from both wire ends
    const s = importSch(shifted, 'shifted.sch');
    expect(s.warnings.join()).toMatch(/joined to the nearest wire end/);
    const doc = { ...s.doc, profile: { ...s.doc.profile, tran: { ...s.doc.profile.tran, enabled: false }, dc: { ...s.doc.profile.dc, enabled: false } } };
    expect(vec(await simulate(doc), 'op', 'v(out)')[0]).toBeCloseTo(6, 9);
  });
  it('rejects files that are not PSpice Schematics files', () => {
    expect(() => importSch('EESchema Schematic File Version 4\n$EndSCHEMATC\n')).toThrow(/not a PSpice/);
  });
});
