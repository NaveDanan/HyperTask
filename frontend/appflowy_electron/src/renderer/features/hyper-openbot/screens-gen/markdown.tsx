// Copyright (c) 2026 CopilotKit. MIT license, see ../LICENSE.
import { HyperMarkdown } from '../transcript/HyperMarkdown';
export function HyperGalleryMarkdown({children, className}: {children: string | undefined; className?: string}) { return <div className={className}><HyperMarkdown content={children ?? ''} /></div>; }
