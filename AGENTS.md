## Project Rules

- Always use `bun`

## UI Rules

- Always reach for `shadcn-svelte` before implementing UI manually

## UI Workflow

To verify correctness of UI use this subagent workflow:

- One agent (implementation agent) implements UI code changes
- Another agent (review agent) reviews the UI with screenshots and Playwright
- The review agent either approves or disapproves with feedback
- If disapprove, send review to implementation agent
- Keep looping until review agent approves
