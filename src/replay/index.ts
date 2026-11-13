/**
 * H2-A replay data layer — public entry point.
 *
 * `H2-B` (UI) imports `listReplays` / `loadReplay` / `exportReplay`;
 * `H2-C`/`H2-D` consume `ReplayRecord` and `exportReplay`. Nothing here
 * performs network I/O or touches Supabase.
 */

export * from './replayTypes';
export * from './replayRecorder';
export * from './replayStore';
