import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { hyperParseMentions } from './hyperMentions';
import { HyperPersonCard } from './HyperPersonCard';
export const HyperMentionChipClass = 'inline rounded bg-primary/10 px-1 text-primary box-decoration-clone';
export function HyperMentionText({ value, className }: { value: string; className?: string }) {
  return <span dir="auto" className={cn('min-w-0', className)}>{hyperParseMentions(value).map((part, index) => part.kind === 'text' ? <Fragment key={index}>{part.text}</Fragment> : <HyperPersonCard key={index} person={part.person}><span dir="auto" className={HyperMentionChipClass}>@{part.person.name}</span></HyperPersonCard>)}</span>;
}
