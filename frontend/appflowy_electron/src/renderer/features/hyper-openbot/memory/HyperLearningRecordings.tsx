// Adapted from OpenBot components/learning/learned-skill-dialog.tsx and lib/recorder/queries.ts.
// Copyright (c) 2026 CopilotKit. MIT; see REUSE.md.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HyperMemoryStatus, useHyperMemoryData } from './HyperMemorySection';
type HyperRecording = {id:string;title:string|null;recordedAt:string;ended:'succeeded'|'stopped'|'sending'|'unknown'|'missing';reason:string|null};
type HyperRecordingPage = {recordings:HyperRecording[];nextCursor:string|null;unavailable?:'unavailable'|'unreachable'};
/** Learning opens the recording list without starting or opening the browser. */
export function HyperLearningRecordings({onClose}:{onClose():void}) {
 const [cursor,setCursor]=useState('');
 const [pages,setPages]=useState<Record<string,HyperRecordingPage>>({});
 const pending=Object.values(pages).some(page=>page.recordings.some(row=>row.ended==='sending'));
 const result=useHyperMemoryData<HyperRecordingPage>(`/api/recorder/recordings${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,undefined,pending?10000:undefined);
 useEffect(()=>{if(result.data)setPages(old=>({...old,[cursor]:result.data!}));},[result.data,cursor]);
 const rows=[...new Map(Object.values(pages).flatMap(page=>page.recordings).map(row=>[row.id,row])).values()];
 return <section className="grid gap-3"><h3>Your recordings</h3><Button variant="outline" onClick={onClose}>Back to skill</Button><HyperMemoryStatus {...result}/>{result.error&&<Button onClick={result.reload}>Retry recordings</Button>}{result.data?.unavailable&&<p role="alert">Recordings could not be read from the backend. <Button onClick={result.reload}>Retry</Button></p>}{!result.loading&&!result.error&&!result.data?.unavailable&&rows.length===0&&<p>No recordings yet.</p>}{rows.map(row=><article className="rounded-lg border p-3" key={row.id}><h4>{row.title??'Untitled recording'}</h4><p>{new Date(row.recordedAt).toLocaleString()} · {row.ended}</p>{row.reason&&<p>{row.reason}</p>}</article>)}{result.data?.nextCursor&&<Button disabled={result.loading} onClick={()=>setCursor(result.data!.nextCursor!)}>Show more</Button>}</section>;
}
