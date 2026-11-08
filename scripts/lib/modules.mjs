// The one place src/ modules are stitched together. Tests load the same
// concatenated text that the build script inlines into n8n Code nodes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

export function concatModules(names) {
  return names.map(name => readFileSync(join(SRC, `${name}.js`), 'utf8')).join('\n');
}

// Evaluated with new Function (same realm as the caller, like an n8n Code
// node body) so returned arrays and objects compare equal in tests.
export function loadModules(names) {
  const code = concatModules(names);
  const declared = [...code.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  return new Function(`${code}\nreturn { ${declared.join(', ')} };`)();
}
