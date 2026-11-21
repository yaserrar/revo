'use client';

import { motion, useReducedMotion } from 'motion/react';
import { SCORE_LABEL_TEXT, scoreLabel } from '@revo/shared';
import { cn } from '~/lib/utils';
import { scoreDescription, scoreTone, TONE_CLASSES } from './tone';

const SIZES = {
  sm: { px: 56, ticks: 0, numeral: 'text-[1.35rem]', label: false },
  md: { px: 132, ticks: 48, numeral: 'text-5xl', label: true },
  lg: { px: 208, ticks: 60, numeral: 'text-[5.5rem]', label: true },
  xl: { px: 280, ticks: 72, numeral: 'text-[7.5rem]', label: true },
} as const;

export type ScoreDialSize = keyof typeof SIZES;

/**
 * Revo's signature: a watch-dial of hairline ticks filled up to the score in
 * its tone, with the number set large in the serif. `score: null` draws an
 * empty dial for reviews without a score (running, skipped, failed).
 */
export function ScoreDial({
  score,
  size = 'md',
  label,
  animate = true,
  className,
}: {
  score: number | null;
  size?: ScoreDialSize;
  /** Overrides the label under the number (e.g. "Skipped"). */
  label?: string;
  animate?: boolean;
  className?: string;
}) {
  const cfg = SIZES[size];
  const reduced = useReducedMotion();
  const run = animate && !reduced;
  const tone = score === null ? null : scoreTone(score);
  const toneCls = tone ? TONE_CLASSES[tone] : null;
  const text = label ?? (score === null ? 'No score' : SCORE_LABEL_TEXT[scoreLabel(score)]);
  const fraction = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;

  return (
    <div
      role="img"
      aria-label={score === null ? text : scoreDescription(score)}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: cfg.px, height: cfg.px }}
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        {cfg.ticks === 0 ? (
          <>
            <circle
              cx="100"
              cy="100"
              r="88"
              fill="none"
              stroke="var(--border)"
              strokeWidth="10"
              strokeDasharray={score === null ? '6 10' : undefined}
            />
            {score !== null ? (
              <motion.circle
                cx="100"
                cy="100"
                r="88"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                strokeLinecap="round"
                className={toneCls?.text}
                initial={run ? { pathLength: 0 } : false}
                animate={{ pathLength: fraction }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              />
            ) : null}
          </>
        ) : (
          <Ticks
            count={cfg.ticks}
            fraction={fraction}
            toneClass={toneCls?.text}
            animate={run}
            dashed={score === null}
          />
        )}
      </svg>
      <div className="relative flex flex-col items-center leading-none">
        <span
          className={cn(
            'display tabular leading-[0.85]',
            cfg.numeral,
            score === null && 'text-muted-foreground',
          )}
        >
          {score === null ? '—' : score}
        </span>
        {cfg.label ? (
          <span
            className={cn(
              'eyebrow mt-2 text-[0.625rem]',
              toneCls ? toneCls.ink : 'text-muted-foreground',
              size === 'md' && 'mt-1.5 text-[0.5625rem]',
            )}
          >
            {text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Rounded so server and browser print the same SVG numbers (Math.sin/cos can differ in the last digit). */
const round = (n: number) => Math.round(n * 1000) / 1000;

function Ticks({
  count,
  fraction,
  toneClass,
  animate,
  dashed,
}: {
  count: number;
  fraction: number;
  toneClass?: string;
  animate: boolean;
  dashed: boolean;
}) {
  const filled = Math.round(fraction * count);
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2;
        const major = i % (count / 12) === 0;
        const outer = 97;
        const inner = major ? 80 : 86;
        const on = i < filled;
        const line = {
          x1: round(100 + Math.cos(angle) * inner),
          y1: round(100 + Math.sin(angle) * inner),
          x2: round(100 + Math.cos(angle) * outer),
          y2: round(100 + Math.sin(angle) * outer),
        };
        if (!on) {
          return (
            <line
              key={i}
              {...line}
              stroke="var(--border)"
              strokeWidth={major ? 2.4 : 1.6}
              strokeLinecap="round"
              opacity={dashed && i % 2 === 1 ? 0 : 1}
            />
          );
        }
        return (
          <motion.line
            key={i}
            {...line}
            stroke="currentColor"
            className={toneClass}
            strokeWidth={major ? 3.2 : 2.4}
            strokeLinecap="round"
            initial={animate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: animate ? 0.15 + i * 0.012 : 0, duration: 0.2 }}
          />
        );
      })}
    </g>
  );
}
