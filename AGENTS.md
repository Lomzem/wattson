## Project Rules

- Always use `bun`
- Never include code or make changes to @read_only . It should only be used as a read-only reference
- A priority of this web app is to preserve user data across sessions

## UI Rules

- Always reach for `shadcn-svelte` before implementing UI manually

## UI Workflow

To verify correctness of UI use this subagent workflow:

- One agent (implementation agent) implements UI code changes
- Another agent (review agent) reviews the UI with screenshots and Playwright
- The review agent either approves or disapproves with feedback
- If disapprove, send review to implementation agent
- Keep looping until review agent approves

## Writing Tests

- Avoid writing **change-detector tests**. See https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html
