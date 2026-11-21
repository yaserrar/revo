import base from '../eslint.config.mjs';

export default [
  ...base,
  // The demo repo is review input (patches are made against its exact bytes), not code of this package.
  { ignores: ['demo-repo/**'] },
  // The eval is a CLI: it prints to stdout on purpose.
  { rules: { 'no-console': 'off' } },
];
