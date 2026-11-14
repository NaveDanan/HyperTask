# Hyper skills

Adapted from OpenBot at f8af37ab73e96784f174a11104505a965e722cab in /home/naved/HyperTask-OpenBot-baseline. Copyright (c) 2026 CopilotKit, MIT; the full license is preserved in ../LICENSE. HyperTask was developed by NaveDanan.

HyperSkillsPanel adapts app/src/components/skills/{new-skill,edit-skill,skill-fields,skill-tools,skill-agents}.tsx and app/src/components/manage/skill-page.tsx. HyperSkillsApi adapts app/src/lib/plugins/{queries,mutations}.ts and the current /api/agents list mapping in app/src/lib/api/served-today.ts.

Integration: import HyperSkillsPanel from './skills' and render <HyperSkillsPanel />. No props or provider required. Reads /api/plugins and /api/agents (including ?hidden=true), writes /api/plugins/skills and /api/plugins/grants through ../transport. Personal skill creation, fixed-slug editing, instructions, tool declarations, immediate owned-Bot grants, confirmed deletion and visible errors are implemented. No external authorization or secrets are collected. Server remains authoritative for ownership and write permissions; deployment-owned or other users' skills may return a visible refusal when edited.

Uses the design's bordered rows and token-based two-column panel pattern with native labeled checkboxes for tool declarations and immediate grants. Tests mock transport; live Electron/server acceptance belongs to the parent.

Continuation: HyperSkillsPanel accepts `admin` plus exported `HyperSkillsNavigationProps` and `HyperSkillSelection` for parent navigation. Admin creates send `global: true` and include the full Bot roster; personal creates do not publish globally. Hidden owned Bots remain reachable. Skills reload after every attempted mutation, including audit failures after persistence. Title/summary/slug/instruction validation matches upstream, declarations include generic @research/search and @research/fetch roles plus unavailable refs. Parent Memory already mounts this panel beside its learned-skill sharing and review implementation. Learned skill sharing stays owned by that area. Admin detail uses the fixed slug, editable fields, immediate grants and confirmed deletion.
