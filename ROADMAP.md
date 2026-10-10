# Roadmap
- **M1 Functional browser prototype** — done.
- **0.3.0** — critical fixes (axis precision, switches), PARAMETERS + parametric sweep, Netlist Mode, PSpice-fidelity pass — done.
- **Next**: BJT/MOSFET/op-amp/F/H/transformer symbols + models; multiple Probe plots/y-axes; automated browser E2E suite; model-parameter sweeps; second fidelity pass with higher-resolution screenshots.
- **M2 Course-ready**: parametric sweep (.step via control loop), nested DC sweep, differential voltage markers,
  Probe cursor polish/trace expressions, ISIN/IPULSE/IPWL, F/H controlled sources, BJT/MOSFET/op-amp/transformer
  parts, switch models, saved simulation profiles, more numerical tests (Tests C–F already pass), autosave UI.
- **M3 High fidelity**: compare against your PSpice screenshots (colours, fonts, dialogs), zoom area, page
  setup, find, multi-page, Temperature/Sensitivity/Transfer Function/Fourier/Noise, .lib/.model import, lab assignments.
- **M4 macOS app**: Tauri 2 + bundled ngspice sidecar for aarch64, .app/.dmg, native file dialogs, offline tests.
