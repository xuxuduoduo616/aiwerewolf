'use strict';

const { spawnSync } = require('node:child_process');

const RELEASE_TRAILER = 'Netlify-Release: true';
const COMMIT_REF_PATTERN = /^[0-9a-f]{40}$/i;
const TRAILER_LINE_PATTERN = /^[A-Za-z0-9-]+: .+$/;

function hasExactReleaseTrailer(commitMessage) {
  if (typeof commitMessage !== 'string') return false;

  const lines = commitMessage.replace(/\r\n?/g, '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();

  const separatorIndex = lines.lastIndexOf('');
  if (separatorIndex < 1 || separatorIndex === lines.length - 1) return false;

  const trailerBlock = lines.slice(separatorIndex + 1);
  if (!trailerBlock.every((line) => TRAILER_LINE_PATTERN.test(line))) return false;

  const releaseTrailerCount = lines.filter((line) => line === RELEASE_TRAILER).length;
  return releaseTrailerCount === 1 && trailerBlock.includes(RELEASE_TRAILER);
}

function readCommitMessage(commitRef) {
  const result = spawnSync('git', ['show', '-s', '--format=%B', commitRef], {
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 256 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error('Unable to read the deploy commit message.');
  }

  return result.stdout;
}

function determineExitCode({ env = process.env, readMessage = readCommitMessage } = {}) {
  try {
    const commitRef = env.COMMIT_REF;
    if (typeof commitRef !== 'string' || !COMMIT_REF_PATTERN.test(commitRef)) return 0;

    return hasExactReleaseTrailer(readMessage(commitRef)) ? 1 : 0;
  } catch {
    return 0;
  }
}

if (require.main === module) {
  const exitCode = determineExitCode();
  if (exitCode === 1) {
    console.log('[netlify-ignore] Consolidated release authorized.');
  } else {
    console.log('[netlify-ignore] Build skipped: no verified release authorization.');
  }
  process.exitCode = exitCode;
}

module.exports = {
  RELEASE_TRAILER,
  determineExitCode,
  hasExactReleaseTrailer,
  readCommitMessage,
};
