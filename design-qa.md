# Design QA

## Source visual truth

- `/Users/agent/.t3/userdata/attachments/4f22dbaf-c1c1-4b15-8f02-80fe0c77a349-0cb76809-b694-4e38-958d-779620128594.png`: current Factory project cards that prompted the layout change.
- `/Users/agent/.t3/userdata/attachments/4f22dbaf-c1c1-4b15-8f02-80fe0c77a349-bdf812c5-6962-41bf-8ba8-927c50351b37.png`: Linear grouped-list reference with status sections, counts, chevrons, and full-width issue rows.

## Implementation evidence

- Implementation: Factory PWA at the local browser preview on port 3001. Port 3000 is occupied by the installed Factory service, so the source checkout was verified on the development port without replacing that service.
- Implementation screenshots: collaborative preview snapshots succeeded at 1280 x 800 and 390 x 844 CSS px.
- Semantic browser evidence: project tasks render under status-group headings with colored status icons, counts, full-width task rows, and independent group-collapse buttons. Expanding a task still exposes its subtask controls. The preview reported no console errors.
- State: Watchtower and Playlister project details were inspected; group collapse was exercised on the Planned section, and task expansion was exercised on a Playlister task.

## Findings

- The project task area now follows the supplied Linear reference’s structure: one list, status-group headers, colored status icons, counts, chevrons, and stacked rows instead of a two-column card grid.
- Existing Factory task metadata, task/subtask CRUD, status menus, verification actions, tracker links, and archive controls remain inside the rows.
- The list remains usable at the narrow viewport; controls stack through the existing responsive rules.

## Comparison history

- The prior status-menu work removed standalone Released/Won't do buttons and added both choices to the subtask status menu.
- This iteration replaced the two-column task-card grid with status-grouped task rows and added independent group collapse controls.
- Desktop and narrow preview snapshots were visually inspected against the supplied Linear grouped-list reference; no P0/P1/P2 layout blocker remained.

## Final result

final result: passed
