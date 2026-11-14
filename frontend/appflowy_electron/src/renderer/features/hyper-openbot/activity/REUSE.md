# OpenBot source reuse

Upstream: /home/naved/HyperTask-OpenBot-baseline, commit f8af37ab73e96784f174a11104505a965e722cab.
Copyright (c) 2026 CopilotKit. MIT license reproduced in LICENSE.
HyperTask was developed by NaveDanan.

| Local file | Exact upstream file | Adaptation |
| --- | --- | --- |
| HyperDecisionCard.tsx | app/src/components/decisions/decision-card.tsx | Native radio selection, first option default, __other__ value, trimmed free text, pending/error handling, answered collapse. Uses HyperTask primitives. |
| HyperApproval.tsx | app/src/components/approvals/inline-approval.tsx | Approval identifiers, choice copy and handoff/standing-rule choice construction. Inbox and mutations replaced by props. |
| HyperQuestion.tsx | app/src/components/approvals/question-notice.tsx | Multipart answers serialized as header: answer lines, progressive questionnaire and free text. Network calls replaced by callbacks. |
| HyperToolActivity.tsx | app/src/components/channels/tool-activity.tsx | Tool group disclosure and approvals outside the fold. Caller supplies normalized steps rather than CopilotKit tool registry. |
| HyperComputerDetail.tsx | app/src/components/computer/command-output.tsx | Command output rendering, empty output, truncation, timeout and exit status copy. |
| HyperComputerDetail.tsx | app/src/components/computer/activity-log.tsx | Chronological computer activity supplied as steps. Control callbacks and screenshot are host integration points. |

index.ts is a new HyperTask export barrel. No upstream runtime dependencies copied.
Keyboard number shortcuts and global newest-decision registration are omitted; native radios retain arrow-key selection and forms support Enter. Screenshot rendering is a supplied image, not a live remote control client. Hosts own network calls, approval resolution, screenshot updates and control state. Use stable request IDs and update answer only after successful persistence.
