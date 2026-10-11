# Simplified workflow preview

This static preview turns the T-94 workflow proposal into a navigable, responsive set of sample screens. It uses the Ledger tokens from `src/web/styles.css` and Floor styles from `src/web/floor.css`, plus the bundled IBM Plex fonts. It makes no requests to Factory, T3, GitHub, or other services. Links and controls stay in the local preview.

Open `simplified-workflow.html` from a local web server or the repository preview server. Each screen can also be opened directly with a query parameter:

| Query | Screen |
| --- | --- |
| `?screen=floor` | Floor with all four Needs-you kinds, Counter papers, tracking notes, Shift Log, and the updated scoreboard |
| `?screen=active` | T-94 detail with the DECIDE callout and an open inline Step state control |
| `?screen=review` | T-91 review packet at its reported head |
| `?screen=review&head=changed` | T-91 after new commits; current-head checks pending and CodeRabbit proof belongs to the previous head |
| `?screen=done` | T-88 merge provenance, one Step left open, and earlier review history |
| `?screen=check` | Zero-Step T-62 with the Check dialog open |
| `?screen=rule` | T-97 / PR #20 finish-rule editor with a live “Save and finish” consequence |
| `?screen=blocked` | Blocked Step owner selection and the resulting UNBLOCK paper |
| `?screen=failures` | Closed, stale, outage, disconnected, and non-default-base PR states |
| `?screen=empty` | Task with no Steps and no activity |

At desktop, capture at **1280 × 1000**. At phone size, capture at **390 × 844**. Use full-page captures for ordinary screens and **viewport-only captures for the open Check dialog**. The dialog locks background scrolling and sits 12px inside the phone viewport. The page is phone-first and may scroll vertically. The screen tabs switch between sample variants.

Local interactions include changing a Step state, adding a note or Step, opening Step detail, assigning a blocker owner, toggling exact-head evidence, changing finish-rule options, opening or dismissing the Check dialog, marking a check, and sending a Task back. These changes exist only in the browser page and do not persist. Step-state arrow keys move focus; Enter or Space selects the state. Escape closes the control and returns focus to its dial. The Check dialog traps focus, makes the background inert, and returns focus when dismissed.

The example IDs, PRs, SHAs, evidence, actors, timestamps, and reports are fictional. The sample snapshot is 9 Oct at 14:20: T-62 is awaiting a check, T-91 / PR #18 is open at `a91c4e2`, T-88 / PR #16 merged on 8 Oct at 14:02 (`d4e6f81`), and the separate T-97 / PR #20 rule example merged on 9 Oct at 13:10 (`f97a620`). PR edge-state examples use distinct Task and PR IDs. Legacy PR #12 history has its own sample SHA. Every screen carries the label **Design preview · sample data**.
