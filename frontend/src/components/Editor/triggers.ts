export type EditorTrigger = '@' | '/';

const triggerPatterns: Record<EditorTrigger, RegExp> = {
  '@': /(?:^|\s)@([^@\n]*)$/,
  '/': /(?:^|\s)\/([^/\n]*)$/,
};

export function findTrailingEditorTriggerQuery(textBefore: string, trigger: EditorTrigger): string | null {
  const match = textBefore.match(triggerPatterns[trigger]);
  return match ? match[1] : null;
}
