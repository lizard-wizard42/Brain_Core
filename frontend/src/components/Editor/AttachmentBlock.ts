import { Node, mergeAttributes } from '@tiptap/core';

export interface AttachmentBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    attachmentBlock: {
      insertAttachmentBlock: (attrs: { url: string; name: string; size?: number; mimeType?: string }) => ReturnType;
    };
  }
}

export const AttachmentBlock = Node.create<AttachmentBlockOptions>({
  name: 'attachmentBlock',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      url: { default: '' },
      name: { default: 'Arquivo' },
      size: { default: 0 },
      mimeType: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="attachment-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'attachment-block',
      }),
    ];
  },

  addCommands() {
    return {
      insertAttachmentBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});

