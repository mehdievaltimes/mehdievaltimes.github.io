// Serves everything in trajectories/data and trajectories/scripts as static files.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { rawFiles } from '../../../lib/trajectory-library.mjs';

export function getStaticPaths() {
  return rawFiles().map((f) => ({ params: { file: f.served }, props: { abs: f.abs, gzip: f.gzip } }));
}

export function GET({ props }) {
  const buf = readFileSync(props.abs);
  return new Response(props.gzip ? gzipSync(buf, { level: 9 }) : buf, { headers: { 'Content-Type': 'application/octet-stream' } });
}
