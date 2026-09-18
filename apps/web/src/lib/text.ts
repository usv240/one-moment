// How transcript text is shown, never how it is stored.
//
// AssemblyAI marks a cut-off word with a trailing dash ("refill my" plus a dash).
// Shown as an ellipsis: the same meaning, and how the fast ear formats the same
// moment. The data itself is never altered.
export const shownTranscript = (s: string) => s.replace(/\s*\u2014/g, '...');
