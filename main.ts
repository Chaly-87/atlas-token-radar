// ATLAS — token-radar-01 entry point (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with lib/radar.ts, writes
// /output/board.json and /output/data.js, copies dashboard/ and screenshots/, then writes
// /output/dossier.json with the vendored make.fun library the scorer rebuilds byte for byte.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { board, boardIssues, parseSnapshot, radarData } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`atlas: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

const rows = board(snapshot);
const issues = boardIssues(rows, snapshot);
if (issues.length > 0) {
  process.stderr.write(`atlas: the board the gate would refuse: ${issues.join('; ')}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows }, null, 0)}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radarData(snapshot, rows))};\n`);

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html')) {
  process.stderr.write('atlas: dashboard/index.html is missing\n');
  process.exit(1);
}
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`atlas: screenshots/ holds ${shots.length}: hand in the board, a detail view and a filtered view\n`);
  process.exit(1);
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const top = rows[0]!;
process.stdout.write(
  `atlas: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ${rows.length} pre-token rows scored\n` +
    `atlas: top row ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')} implied, ${rows[0]!.launch_odds.toFixed(3)} launch odds\n` +
    `atlas: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shots.length}) and dossier.json\n`,
);
