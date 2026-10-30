# Run 26: no result, because of a tooling defect

**The request** (`request.txt`):
- finish the loop on her run-25 copy;
- do not run `project_copy`, which replaces a copy's contents.

**What happened.** She made no tool call, except two memory recalls. All 8 go-aheads went unused.

Her context said "No project copy exists in the engineering sandbox". So she declined, correctly, to make one, since that would destroy the copy she had been asked to keep.

**The defect.** `EngineeringWorkspace.describe()` reported only copies made in the current browser session.
- That object starts empty on every page load and never asked the server.
- Her copy `default`, with its three edits, was on disk the whole time. It was verified intact after this run.

**Fix.**
- Each runtime probe now also lists the sandbox's copies.
- When this session has made none, her context names the existing ones, says they still hold their edits, and says that `project_copy` with an existing id would replace one.

`tests/self-view.test.ts` covers this.

Run 27 repeats run 26's request on the fixed runtime.
