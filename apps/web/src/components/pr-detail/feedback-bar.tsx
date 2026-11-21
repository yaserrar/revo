'use client';

import { Dislike, Like1, MessageEdit } from 'iconsax-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import type { FeedbackBody, FeedbackOutcome, FindingDto } from '@revo/shared';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { useFindingFeedback } from '~/hooks/reviews';
import { cn } from '~/lib/utils';

const NOTE_MAX = 500;
const DONE: Record<FeedbackOutcome, string> = { useful: 'Marked useful', wrong: 'Marked wrong' };

/**
 * "Useful" / "Wrong" with an optional note (spec 3.4). Optimistic; pressing
 * the active button again clears it, and every change can be undone from the toast.
 */
export function FeedbackBar({
  finding,
  reviewId,
  login,
}: {
  finding: FindingDto;
  reviewId: string;
  login: string;
}) {
  const mutation = useFindingFeedback(reviewId, login);
  const mine = finding.myFeedback;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(mine?.note ?? '');
  const noteId = useId();

  const change = (next: FeedbackBody | null, message: string) => {
    const previous: FeedbackBody | null = mine
      ? { outcome: mine.outcome, ...(mine.note ? { note: mine.note } : {}) }
      : null;
    mutation.mutate(
      { findingId: finding.id, next },
      {
        onSuccess: () =>
          toast.success(message, {
            description: finding.title,
            action: {
              label: 'Undo',
              onClick: () => mutation.mutate({ findingId: finding.id, next: previous }),
            },
          }),
      },
    );
  };

  const choose = (outcome: FeedbackOutcome) => {
    if (mine?.outcome === outcome) {
      change(null, 'Feedback removed');
      setEditing(false);
      return;
    }
    change({ outcome, ...(mine?.note ? { note: mine.note } : {}) }, DONE[outcome]);
  };

  const saveNote = () => {
    if (!mine) return;
    const trimmed = note.trim();
    change(
      { outcome: mine.outcome, ...(trimmed ? { note: trimmed } : {}) },
      trimmed ? 'Note saved' : 'Note removed',
    );
    setEditing(false);
  };

  const counts = finding.feedbackCounts;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="eyebrow" id={`${noteId}-label`}>
          Was this right?
        </span>
        <div className="flex gap-2" role="group" aria-labelledby={`${noteId}-label`}>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={mine?.outcome === 'useful'}
            onClick={() => choose('useful')}
            className={cn(
              'gap-1.5',
              mine?.outcome === 'useful' &&
                'border-good/40 bg-good-soft text-good-ink hover:bg-good-soft hover:text-good-ink',
            )}
          >
            <Like1 className="size-4" />
            Useful
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={mine?.outcome === 'wrong'}
            onClick={() => choose('wrong')}
            className={cn(
              'gap-1.5',
              mine?.outcome === 'wrong' &&
                'border-bad/40 bg-bad-soft text-bad-ink hover:bg-bad-soft hover:text-bad-ink',
            )}
          >
            <Dislike className="size-4" />
            Wrong
          </Button>
        </div>
        {mine && !editing ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setNote(mine.note ?? '');
              setEditing(true);
            }}
          >
            <MessageEdit className="size-4" />
            {mine.note ? 'Edit note' : 'Add a note'}
          </Button>
        ) : null}
        <span className="ml-auto font-mono text-[0.6875rem] text-muted-foreground" aria-label="Team feedback">
          {counts.useful} useful · {counts.wrong} wrong
        </span>
      </div>

      {editing && mine ? (
        <div className="space-y-2">
          <label htmlFor={noteId} className="sr-only">
            Note for this feedback
          </label>
          <Textarea
            id={noteId}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mine.outcome === 'wrong'
                ? 'Why is it wrong? e.g. "The caller already validates this."'
                : 'What made it useful?'
            }
            rows={2}
            autoFocus
            className="bg-card"
          />
          <div className="flex items-center gap-2">
            <span className="tabular mr-auto font-mono text-[0.6875rem] text-muted-foreground">
              {note.length} / {NOTE_MAX}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveNote}>
              Save note
            </Button>
          </div>
        </div>
      ) : mine?.note ? (
        <p className="border-l-2 border-border pl-3 text-sm text-muted-foreground italic">“{mine.note}”</p>
      ) : null}
    </div>
  );
}
