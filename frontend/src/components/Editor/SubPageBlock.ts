import { Node, mergeAttributes } from '@tiptap/core';

export interface SubPageBlockOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    subPageBlock: {
      insertSubPageBlock: (attrs: { pageId: string; title: string; icon?: string }) => ReturnType;
    };
  }
}

export const SubPageBlock = Node.create<SubPageBlockOptions>({
  name: 'subPageBlock',

  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      pageId: { default: null },
      title: { default: 'Sem título' },
      icon: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="sub-page-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-type': 'sub-page-block',
      }),
    ];
  },

  addCommands() {
    return {
      insertSubPageBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
