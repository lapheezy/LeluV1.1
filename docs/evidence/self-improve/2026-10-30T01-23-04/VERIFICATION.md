# Run 18: independent verification (by Claude Code, not LÉLU)

**Verdict: no result.** The provider failed and my recorder raced. Nothing in this run measures her ability.

- **First turn:** she captured four panels, found the Projects panel at phone size (25 findings), copied the project and read the code.
- **Provider failure:** at 172 s the only working provider (Fireworks, the other keys return 401) failed mid-request. Her reply became "I'm in offline mode — all AI providers are unreachable".
- **Offline answers:** the app's local offline responder ("Connected — brain") answered the next go-aheads instantly with canned text.
- **Recorder race:** one turn ended in under a second, before the recorder took its "after this message" timestamp. The recorder then waited out the whole 35-minute limit for an end that had already happened. Fixed: the timestamp is now taken before the message is sent.
- **Not interference:** the "Coding: Loop probe N" tasks in the events are the app's own periodic self-test suite (`SelfTestRunner` via `SelfDevelopmentLoop`).

No change was made (empty diff). Nothing was applied to the real project.
