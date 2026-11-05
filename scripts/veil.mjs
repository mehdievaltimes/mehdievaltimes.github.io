// Encode a string for the homepage terminal's data (src/components/terminal/fs.ts).
//   npm run veil -- 'some text'        → hex to paste into fs.ts
//   npm run veil -- -d <hex>           → back to the text
import { veil, unveil } from '../src/components/terminal/veil.js';

const args = process.argv.slice(2);
if (args[0] === '-d') console.log(unveil(args[1] ?? ''));
else if (args.length) console.log(veil(args.join(' ')));
else console.error("usage: npm run veil -- 'text'   |   npm run veil -- -d <hex>");
