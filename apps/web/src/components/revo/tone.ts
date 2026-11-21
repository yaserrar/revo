import { SCORE_LABEL_TEXT, scoreLabel, scoreTone, type Severity, type Tone } from '@revo/shared';

/** Static class maps (Tailwind needs literal class names). */
export const TONE_CLASSES: Record<
  Tone,
  { text: string; ink: string; soft: string; dot: string; border: string }
> = {
  good: {
    text: 'text-good',
    ink: 'text-good-ink',
    soft: 'bg-good-soft',
    dot: 'bg-good',
    border: 'border-good/30',
  },
  warn: {
    text: 'text-warn',
    ink: 'text-warn-ink',
    soft: 'bg-warn-soft',
    dot: 'bg-warn',
    border: 'border-warn/30',
  },
  bad: { text: 'text-bad', ink: 'text-bad-ink', soft: 'bg-bad-soft', dot: 'bg-bad', border: 'border-bad/30' },
};

export const SEVERITY_CLASSES: Record<Severity, { ink: string; soft: string; dot: string; border: string }> =
  {
    blocker: {
      ink: 'text-sev-blocker-ink',
      soft: 'bg-sev-blocker-soft',
      dot: 'bg-sev-blocker',
      border: 'border-sev-blocker/30',
    },
    major: {
      ink: 'text-sev-major-ink',
      soft: 'bg-sev-major-soft',
      dot: 'bg-sev-major',
      border: 'border-sev-major/30',
    },
    minor: {
      ink: 'text-sev-minor-ink',
      soft: 'bg-sev-minor-soft',
      dot: 'bg-sev-minor',
      border: 'border-sev-minor/30',
    },
  };

/** CSS colour of a tone, for SVG strokes and charts. */
export const TONE_VAR: Record<Tone, string> = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)' };

export function scoreDescription(score: number): string {
  return `Score ${score} out of 100, ${SCORE_LABEL_TEXT[scoreLabel(score)].toLowerCase()}`;
}

export { scoreTone };
