const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_ENV_NAME = 'VITE_TURNSTILE_SITE_KEY';
const SITE_KEY_PATTERN = /(?:0x4[A-Za-z0-9_-]{20,}|[123]x0{10,}[A-Za-z0-9_-]*)/g;

const readJavaScript = (directory) => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readJavaScript(entryPath);
    return entry.isFile() && entry.name.endsWith('.js')
      ? [fs.readFileSync(entryPath, 'utf8')]
      : [];
  });

const emit = (fallbackAbsent, configuredKeyPresent) => {
  process.stdout.write(`${JSON.stringify({ fallbackAbsent, configuredKeyPresent })}\n`);
  process.exitCode = fallbackAbsent && configuredKeyPresent ? 0 : 1;
};

const main = async () => {
  const { loadEnv } = await import('vite');
  const configuredKey = loadEnv('production', process.cwd(), REQUIRED_ENV_NAME)[REQUIRED_ENV_NAME];
  const appSource = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
  const bundleSource = readJavaScript(path.join(process.cwd(), 'dist')).join('\n');

  const sourceFallbackAbsent =
    /const TURNSTILE_SITE_KEY\s*=\s*import\.meta\.env\.VITE_TURNSTILE_SITE_KEY\s*;/.test(appSource)
    && !/VITE_TURNSTILE_SITE_KEY\s*(?:\|\||\?\?)/.test(appSource);
  const configuredKeyPresent = Boolean(configuredKey) && bundleSource.includes(configuredKey);
  let unexpectedSiteKeyPresent = false;

  for (const match of bundleSource.matchAll(SITE_KEY_PATTERN)) {
    if (match[0] !== configuredKey) unexpectedSiteKeyPresent = true;
  }

  emit(sourceFallbackAbsent && !unexpectedSiteKeyPresent, configuredKeyPresent);
};

main().catch(() => emit(false, false));
