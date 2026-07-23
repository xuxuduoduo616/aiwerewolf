const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REQUIRED_ENV_NAME = 'VITE_TURNSTILE_SITE_KEY';

const forwardedArgs = process.argv.slice(2);

const parseMode = (args) => {
  let mode = 'production';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--mode' && args[index + 1]) {
      mode = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--mode=') && arg.slice('--mode='.length)) {
      mode = arg.slice('--mode='.length);
    }
  }

  return mode;
};

const runNodeCli = (packageName, relativePath, args) => {
  const packagePath = require.resolve(`${packageName}/package.json`);
  const cliPath = path.join(path.dirname(packagePath), relativePath);
  const result = spawnSync(process.execPath, [cliPath, ...args], { stdio: 'inherit' });

  return result.status ?? 1;
};

const main = async () => {
  const { loadEnv } = await import('vite');
  const mode = parseMode(forwardedArgs);
  const env = loadEnv(mode, process.cwd(), REQUIRED_ENV_NAME);

  if (!env[REQUIRED_ENV_NAME]?.trim()) {
    process.stderr.write(`Missing required ${REQUIRED_ENV_NAME}\n`);
    process.exitCode = 1;
    return;
  }

  const typecheckStatus = runNodeCli('typescript', 'bin/tsc', []);
  if (typecheckStatus !== 0) {
    process.exitCode = typecheckStatus;
    return;
  }

  process.exitCode = runNodeCli('vite', 'bin/vite.js', ['build', ...forwardedArgs]);
};

main().catch(() => {
  process.stderr.write('Build failed\n');
  process.exitCode = 1;
});
