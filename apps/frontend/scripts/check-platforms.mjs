#!/usr/bin/env node
// Fails fast when no native Capacitor platform has been scaffolded yet.
//
// `npx cap sync` (with no platform argument) syncs whatever platforms exist,
// which means it exits 0 and does nothing at all on a fresh clone -- the real
// failure only surfaces later at the Gradle/Xcode step. This check turns that
// silent no-op into an actionable error.
//
// Platforms are grouped under mobile/ via `android.path` / `ios.path` in
// capacitor.config.ts, so "is there anything in mobile/?" is the whole check:
// no platform list to keep in sync, and any platform Capacitor gains later
// works without touching this file.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'mobile');

// An empty mobile/ counts as nothing: removing a platform folder by hand
// leaves the parent behind, and that must not pass the check.
const platforms = existsSync(mobileDir)
  ? readdirSync(mobileDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

if (platforms.length === 0) {
  console.error(
    [
      '',
      'No Capacitor platform has been added yet, so there is nothing to sync.',
      '',
      'Native platform folders are gitignored and regenerated on demand, so a',
      'fresh clone has none. Scaffold at least one from apps/frontend:',
      '',
      '  npx cap add android     # creates mobile/android/',
      '  npx cap add ios         # creates mobile/ios/ (macOS + Xcode)',
      '',
      'Run `pnpm build:frontend` first if you have not built the web assets yet.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`Capacitor platforms present: ${platforms.join(', ')}`);
