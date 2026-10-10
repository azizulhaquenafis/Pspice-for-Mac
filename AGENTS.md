# Working rules for AI coding sessions

1. Read FEATURE_MATRIX.md, KNOWN_ISSUES.md and ARCHITECTURE.md before changing code.
2. Never fake simulation output. All numbers shown must come from ngspice vectors.
3. Keep layers separate: model -> connectivity -> netlist -> engine -> rawParser -> probeModel -> UI.
4. All document edits go through `useStore.commit` (undo/redo). Menus, toolbar and shortcuts call `src/state/actions.ts`.
5. Unimplemented UI must be disabled and labelled "not yet available".
6. Run `npx tsc -p .` and `npm test` before reporting; never edit expected values to make tests pass.
7. Update FEATURE_MATRIX.md, CHANGELOG.md, TEST_RESULTS.md, KNOWN_ISSUES.md with every change.
8. Do not copy proprietary PSpice assets/code/libraries. Symbols are original drawings.
