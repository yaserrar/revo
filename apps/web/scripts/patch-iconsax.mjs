// Make iconsax-react default to the Bulk variant in currentColor.
// The package sets defaults via `defaultProps`, which React 19 ignores on
// function components, so icons would render with no variant and no fill.
// This rewrites each icon's destructuring to carry real defaults. Idempotent.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'node_modules', 'iconsax-react', 'dist');
let patched = 0;
for (const dir of ['esm', 'cjs']) {
  const path = join(root, dir);
  if (!existsSync(path)) continue;
  for (const file of readdirSync(path)) {
    if (!file.endsWith('.js') || file.startsWith('index') || file.startsWith('_')) continue;
    const full = join(path, file);
    const src = readFileSync(full, 'utf8');
    if (src.includes('/* iconsax-bulk-patched */')) continue;
    const out = src
      .replace(/variant = (_ref\d+)\.variant,/, "variant = $1.variant === void 0 ? 'Bulk' : $1.variant,")
      .replace(
        /color = (_ref\d+)\.color,(\s+size)/,
        "color = $1.color === void 0 ? 'currentColor' : $1.color,$2",
      )
      .replace(/size = (_ref\d+)\.size,/, "size = $1.size === void 0 ? '24' : $1.size,");
    if (out !== src) {
      writeFileSync(full, '/* iconsax-bulk-patched */\n' + out);
      patched++;
    }
  }
}
console.log(`patch-iconsax: ${patched} files patched`);
