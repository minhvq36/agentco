<!--
  Thanks for the work. The boxes below are not paperwork — each one maps to a
  class of bug that has actually slipped through this project before.
-->

## What changes

<!-- One or two sentences. If it fixes a bug: what did the user see? -->

## CLA — first pull request only

- [ ] Not my first pull request (already signed)
- [ ] I am signing the CLA — paste and fill in:

```
I have read the CLA at CLA.md and I hereby sign it.
Name: <your full name>   GitHub: @<your-handle>   Date: <YYYY-MM-DD>
```

> You **keep the copyright** to what you wrote ([CLA.md](../CLA.md) §4). The license you grant is
> what makes the promise *"every release becomes Apache 2.0 after two years"* enforceable.

## Before submitting

- [ ] `npm test` is green
- [ ] Tests added for any **pure functions** touched (they run in under a second, cost zero tokens)
- [ ] If token cost is affected: **measurements included**, with a **nonce** to defeat the cache
      *(without one, the second measurement reads the first one's cache and reports zero difference —
      this trap has been missed twice)*
- [ ] New code, comments and log lines are **English**; user-visible strings went into `src/i18n/`
      *(and no locale was passed into a prompt — the product follows the user's language, not a
      setting. See `docs/CLAUDE.md`)*
- [ ] If a rule documented in `docs/` changed: **the document is updated in this same pull request**
      *(documentation that disagrees with the code is a bug, and the longest-lived kind, because it
      never produces a symptom)*
