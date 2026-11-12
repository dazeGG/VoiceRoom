// Keep the fixed-path public worklet byte-for-byte reproducible from readable source.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('./rnnoise/worklet-source.js.txt', import.meta.url));
const output = fileURLToPath(new URL('../public/rnnoise/rnnoise.worklet.js', import.meta.url));
const generated = readFileSync(source, 'utf8');
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== generated) {
    throw new Error(
      'RNNoise worklet differs from its readable source; run node apps/web/scripts/build-rnnoise-worklet.ts'
    );
  }
} else {
  writeFileSync(output, generated);
}
