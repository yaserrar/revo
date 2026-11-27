import base from '../eslint.config.mjs';

export default [
  ...base,
  // Results are generated output; .work holds the cloned repos under review.
  { ignores: ['results/**', '.work/**'] },
  // The bench is a CLI: it prints to stdout on purpose.
  { rules: { 'no-console': 'off' } },
];
