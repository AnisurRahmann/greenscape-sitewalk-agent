/**
 * Client-bundle secret-leak check.
 *
 * Scans every file Vercel/Next serves to the browser (.next/static) for
 * server-only env var NAMES and for any non-public secret VALUES from
 * .env.local. Run after `next build`:
 *
 *   node scripts/verify-client-bundle.mjs
 *
 * Exits non-zero on any hit so it can gate a deploy.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const STATIC_DIR = '.next/static';
const ENV_LOCAL = '.env.local';

const SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'STRIPE_SECRET_KEY',
  'GHL_API_KEY',
  'SLACK_WEBHOOK_URL',
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

// Secret values from .env.local: non-public vars with meaningful lengths.
// Only their VALUES are scanned (names alone would false-positive on docs).
const secretValues = [];
if (existsSync(ENV_LOCAL)) {
  for (const line of readFileSync(ENV_LOCAL, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.+)\s*$/);
    if (!match) continue;
    const [, name, value] = match;
    if (name.startsWith('NEXT_PUBLIC')) continue;
    if (name.endsWith('_URL') || name === 'GHL_MODE') continue;
    if (value.trim().length >= 16) secretValues.push({ name, value: value.trim() });
  }
}

const files = walk(STATIC_DIR).filter((file) => /\.(js|css|html|map|json|txt|wasm)$/.test(file));
const leaks = [];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const name of SECRET_NAMES) {
    if (content.includes(name)) leaks.push({ file, what: `env var name "${name}"` });
  }
  for (const { name, value } of secretValues) {
    if (value && content.includes(value)) leaks.push({ file, what: `value of ${name}` });
  }
}

if (files.length === 0) {
  console.error(`no files found under ${STATIC_DIR} — run "next build" first`);
  process.exit(1);
}

if (leaks.length > 0) {
  console.error('CLIENT BUNDLE LEAKS DETECTED:');
  for (const leak of leaks) console.error(`  ${leak.file}: ${leak.what}`);
  process.exit(1);
}

console.log(`client bundle clean: ${files.length} files scanned, no server-only env names or secret values found`);
