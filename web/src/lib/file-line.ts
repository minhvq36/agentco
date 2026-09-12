/**
 * 🔴 IS THIS LINE A BARE PATH THE CODE PRINTED — or a sentence that happens to
 * END with one? → `ChatPanel §FileLinks` · `office.ts §whereBlock`
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ MEASURED 09/09: A WHOLE PARAGRAPH TURNED INTO ONE FILE BUTTON.
 * │
 * │ `whereBlock` prints its result lines as `  <company>/offices/<id>/<path>`,
 * │ so the renderer matched a line by `line.trim().endsWith(f)` — a suffix
 * │ comparison, deliberately, because the two ends carry different prefixes.
 * │
 * │ What nobody accounted for: the assistant's own report often ENDS with the
 * │ same path — *"…full details saved at: artifacts/P-…/T-01/summary.md"*. That
 * │ line then matched too, and the entire sentence was rendered as a
 * │ monospace, break-all, full-width button. The user saw a long paragraph
 * │ swallowed into a box, and only SOMETIMES — exactly when the model
 * │ happened to finish its sentence on the path.
 * │
 * │ ⚠ THE FIX IS NOT A LOOSER MATCH, IT IS AN ANCHORED ONE. What the code
 * │ prints is a line that is NOTHING BUT a path: the part before the file is
 * │ a directory prefix, so it has no spaces and ends at a `/`. Prose fails
 * │ both tests, and a filename that itself contains spaces still passes —
 * │ those spaces live inside `f`, not in the prefix.
 * │
 * │ ⚠ It stays a SUFFIX comparison and it still never sniffs paths out of
 * │ prose: the candidate list is `files`, which only `whereBlock` fills.
 * │ Short rule, unchanged: only a path THE CODE ITSELF put there is
 * │ clickable. This narrows which LINE is the code's, nothing else.
 * └──────────────────────────────────────────────────────────────────────────
 *
 * @returns the matching entry of `files`, or `undefined` — render the line as
 *          ordinary markdown then.
 */
export function fileLineHit(line: string, files: readonly string[]): string | undefined {
  const bare = line.trim();
  return files.find((f) => {
    if (!f || !bare.endsWith(f)) return false;
    const head = bare.slice(0, bare.length - f.length);
    return (head === '' || head.endsWith('/')) && !/\s/.test(head);
  });
}
