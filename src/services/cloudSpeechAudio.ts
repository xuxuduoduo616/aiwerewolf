type PlaybackResult = 'finished' | 'fallback' | 'cancelled';

interface CloudSpeech {
  text: string;
  lang: string;
  seat: number;
  accessToken: string;
  volume: number;
  rate: number;
  maxPlaybackMs: number;
}

/** One cancellable request and player, with separate start and playback deadlines. */
export function playCloudSpeech(options: CloudSpeech) {
  const controller = new AbortController();
  let player: HTMLAudioElement | undefined;
  let url: string | undefined;
  let settled = false;
  let paused = false;
  let deferred: PlaybackResult | undefined;
  let attempt = 0;
  let playbackDeadline: number | undefined;
  let playbackRemaining = options.maxPlaybackMs;
  let timer: ReturnType<typeof setTimeout>;
  let resolveResult!: (result: PlaybackResult) => void;
  const result = new Promise<PlaybackResult>(resolve => { resolveResult = resolve; });

  const finish = (outcome: PlaybackResult) => {
    if (settled) return;
    if (paused && outcome !== 'cancelled') {
      deferred ??= outcome;
      return;
    }
    settled = true;
    clearTimeout(timer);
    controller.abort();
    if (player) {
      player.onplaying = player.onended = player.onerror = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    if (url) URL.revokeObjectURL(url);
    resolveResult(outcome);
  };

  const play = () => {
    if (!player || paused || settled) return;
    const id = ++attempt;
    clearTimeout(timer);
    timer = setTimeout(() => finish('fallback'), 6500);
    void player.play().catch(() => {
      if (attempt === id && !paused) finish('fallback');
    });
  };
  timer = setTimeout(() => finish('fallback'), 6500);
  void (async () => {
    const response = await fetch('/.netlify/functions/bailian-tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: options.text, lang: options.lang, seat: options.seat }),
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || response.headers.get('content-type') !== 'audio/wav') {
      finish('fallback');
      return;
    }
    const audio = await response.blob();
    if (settled || deferred) return;
    clearTimeout(timer);
    url = URL.createObjectURL(audio);
    player = new Audio(url);
    player.volume = options.volume;
    player.playbackRate = options.rate;
    player.onplaying = () => {
      if (paused || settled || playbackDeadline !== undefined) return;
      clearTimeout(timer);
      playbackDeadline = Date.now() + playbackRemaining;
      timer = setTimeout(() => finish('finished'), playbackRemaining);
    };
    player.onended = () => finish('finished');
    player.onerror = () => finish('fallback');
    play();
  })().catch(() => finish('fallback'));

  return {
    result,
    cancel: () => finish('cancelled'),
    pause: () => {
      if (paused || settled) return;
      paused = true;
      attempt++;
      if (playbackDeadline !== undefined) {
        playbackRemaining = Math.max(0, playbackDeadline - Date.now());
        playbackDeadline = undefined;
      }
      if (player) {
        clearTimeout(timer);
        player.pause();
      }
    },
    resume: () => {
      if (!paused || settled) return;
      paused = false;
      if (deferred) finish(deferred);
      else play();
    },
  };
}
