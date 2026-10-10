// Parser for ngspice ASCII rawfiles (possibly several plots appended).
import { Plot, PlotKind, Vector } from './types';

function kindOf(plotname: string): PlotKind {
  const p = plotname.toLowerCase();
  if (p.includes('operating point')) return 'op';
  if (p.includes('transient')) return 'tran';
  if (p.includes('dc transfer')) return 'dc';
  if (p.includes('ac analysis')) return 'ac';
  return 'other';
}

export function parseRawAscii(text: string): Plot[] {
  const lines = text.split(/\r?\n/);
  const plots: Plot[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith('Title:')) { i++; continue; }
    let plotname = '', flags = '', nvars = 0, npts = 0;
    i++;
    while (i < lines.length && !lines[i].startsWith('Variables:')) {
      const [k, ...rest] = lines[i].split(':');
      const v = rest.join(':').trim();
      if (k === 'Plotname') plotname = v;
      else if (k === 'Flags') flags = v;
      else if (k === 'No. Variables') nvars = parseInt(v);
      else if (k === 'No. Points') npts = parseInt(v);
      i++;
    }
    i++;
    const complex = flags.includes('complex');
    const vectors: Vector[] = [];
    for (let k = 0; k < nvars; k++, i++) {
      const parts = lines[i].trim().split(/\s+/);
      vectors.push({ name: parts[1], type: parts[2], re: new Float64Array(npts), im: complex ? new Float64Array(npts) : undefined });
    }
    if (!lines[i]?.startsWith('Values:')) throw new Error('Malformed rawfile: missing Values section');
    i++;
    // Values are whitespace-separated tokens; each point starts with its index.
    const toks: string[] = [];
    const need = npts * (nvars + 1);
    while (i < lines.length && toks.length < need && !lines[i].startsWith('Title:')) {
      for (const t of lines[i].trim().split(/\s+/)) if (t) toks.push(t);
      i++;
    }
    let t = 0;
    for (let p = 0; p < npts; p++) {
      t++; // point index
      for (let k = 0; k < nvars; k++) {
        const tok = toks[t++];
        if (complex) {
          const [re, im] = tok.split(',');
          vectors[k].re[p] = parseFloat(re); vectors[k].im![p] = parseFloat(im);
        } else vectors[k].re[p] = parseFloat(tok);
      }
    }
    plots.push({ title: plotname, kind: kindOf(plotname), complex, vectors });
  }
  return plots;
}
