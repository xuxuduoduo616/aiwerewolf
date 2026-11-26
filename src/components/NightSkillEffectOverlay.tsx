import React, { useEffect, useRef, useState } from 'react';
import { Eye, FlaskConical, ShieldCheck, Skull } from 'lucide-react';
import {
  getNightSkillVfxSpec,
  type HumanSkillCueEvent,
  type HumanSkillCueKind,
} from '../services/roleShowcaseConfig';

export interface NightSkillEffectOverlayProps {
  cue: HumanSkillCueEvent | null;
  onDismiss: (id?: string) => void;
}

const detectReducedMotion = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const renderSkillIcon = (kind: HumanSkillCueKind) => {
  switch (kind) {
    case 'SEER_CHECK':
      return <Eye size={28} aria-hidden="true" />;
    case 'WITCH_SAVE':
      return <FlaskConical size={28} aria-hidden="true" />;
    case 'WITCH_POISON':
      return <Skull size={28} aria-hidden="true" />;
    case 'WOLF_KILL_CONFIRM':
      return <Skull size={28} aria-hidden="true" />;
    case 'WITCH_HOLD':
    default:
      return <ShieldCheck size={28} aria-hidden="true" />;
  }
};

const NightSkillEffectOverlay: React.FC<NightSkillEffectOverlayProps> = ({
  cue,
  onDismiss,
}) => {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const reduced = useRef(detectReducedMotion()).current;

  useEffect(() => {
    setVideoFailed(false);
    setImageFailed(false);
    if (!cue) return undefined;

    const spec = getNightSkillVfxSpec(cue.kind);
    const timer = window.setTimeout(() => {
      onDismissRef.current(cue.id);
    }, spec.durationMs);

    return () => window.clearTimeout(timer);
  }, [cue]);

  if (!cue) return null;

  const spec = getNightSkillVfxSpec(cue.kind);
  const showVideo = spec.hasMotionAsset && Boolean(spec.videoSrc) && !reduced && !videoFailed;
  const showPoster = !showVideo && Boolean(spec.posterSrc) && !imageFailed;

  return (
    <div
      className={`night-skill-overlay night-skill-overlay--${spec.accent}`}
      role="status"
      aria-live="polite"
      data-skill-kind={cue.kind}
    >
      <div className="night-skill-card">
        {showVideo && spec.videoSrc ? (
          <video
            key={`${cue.id}-video`}
            className="night-skill-media"
            src={spec.videoSrc}
            poster={spec.posterSrc ?? undefined}
            autoPlay
            muted
            playsInline
            preload="auto"
            onError={() => setVideoFailed(true)}
          />
        ) : showPoster && spec.posterSrc ? (
          <img
            key={`${cue.id}-poster`}
            className="night-skill-media"
            src={spec.posterSrc}
            alt=""
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="night-skill-static-emblem" aria-hidden="true">
            {renderSkillIcon(cue.kind)}
          </div>
        )}
        <div className="night-skill-caption">
          <span className="night-skill-label">{spec.label}</span>
          {cue.targetId !== null && (
            <span className="night-skill-target">Player {cue.targetId}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default NightSkillEffectOverlay;
