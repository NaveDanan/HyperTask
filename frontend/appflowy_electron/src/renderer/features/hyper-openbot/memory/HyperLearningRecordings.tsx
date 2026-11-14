// Adapted from OpenBot components/learning/learned-skill-dialog.tsx and lib/recorder/queries.ts.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HyperMemoryStatus, useHyperMemoryData } from './HyperMemorySection';
type HyperRecording = {id:string;title:string|null;recordedAt:string;ended:'succeeded'|'stopped'|'sending'|'unknown'|'missing';reason:string|null};
type HyperRecordingPage = {recordings:HyperRecording[];nextCursor:string|null;unavailable?:'unavailable'|'unreachable'};
/** Learning opens the recording list without starting or opening the browser. */
export function HyperLearningRecordings({onClose}:{onClose():void}) {
 const [cursors,setCursors]=useState(['']);
 return <section className="grid gap-3"><h3>Your recordings</h3><Button variant="outline" onClick={onClose}>Back to skill</Button>{cursors.map((cursor,index)=><HyperLearningRecordingPage key={cursor} cursor={cursor} last={index===cursors.length-1} onMore={next=>setCursors(old=>old.includes(next)?old:[...old,next])}/>)}</section>;
}
function HyperLearningRecordingPage({cursor,last,onMore}:{cursor:string;last:boolean;onMore(cursor:string):void}) {
 // Every loaded page keeps its own retry state and refreshes rows still sending.
 const result=useHyperMemoryData<HyperRecordingPage>(`/api/recorder/recordings${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,undefined,10000);
 return <div className="grid gap-3"><HyperMemoryStatus {...result}/>{result.data?.unavailable&&<p role="alert">Recordings could not be read from the backend. <Button onClick={result.reload}>Retry</Button></p>}{!result.loading&&!result.error&&!result.data?.unavailable&&!cursor&&result.data?.recordings.length===0&&<p>No recordings yet.</p>}{result.data?.recordings.map(row=><article className="rounded-lg border p-3" key={row.id}><h4>{row.title??'Untitled recording'}</h4><p>{new Date(row.recordedAt).toLocaleString()} · {row.ended}</p>{row.reason&&<p>{row.reason}</p>}</article>)}{last&&result.data?.nextCursor&&<Button disabled={result.loading} onClick={()=>onMore(result.data!.nextCursor!)}>Show more</Button>}</div>;
}
