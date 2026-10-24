import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { SubPageBlock } from './SubPageBlock';
import { PageDragBridge } from './PageDragBridge';
import { expect, it, vi } from 'vitest';
import { attachPageDragBridge } from './PageDragBridge';
import { readPageDrag, PAGE_DRAG_TYPE } from './pageDrag';
it('writes page identity after an existing native drag handler clears data, including wrapper-retargeted drags', () => {
 const root=document.createElement('div');root.innerHTML='<div class="react-renderer node-subPageBlock"><div data-node-view-wrapper><div data-page-card="alpha" data-page-title="Alpha" data-page-source="child"></div></div></div>';
 const values=new Map<string,string>();const dt={getData:(k:string)=>values.get(k)??'',setData:(k:string,v:string)=>values.set(k,v),get types(){return [...values.keys()];},effectAllowed:''} as unknown as DataTransfer;
 root.addEventListener('dragstart',()=>{values.clear();values.set('text/html','native slice');});
 const cleanup=attachPageDragBridge(root,()=>true);
 const event=new Event('dragstart',{bubbles:true});Object.defineProperty(event,'dataTransfer',{value:dt});
 root.firstElementChild!.dispatchEvent(event);
 expect(dt.getData('text/html')).toBe('native slice');expect(readPageDrag(dt)?.id).toBe('alpha');expect(dt.types).toContain(PAGE_DRAG_TYPE);
 cleanup();values.clear();root.firstElementChild!.dispatchEvent(event);expect(dt.types).not.toContain(PAGE_DRAG_TYPE);
});
it('never creates a page move payload for read-only views or unrelated text drags',()=>{
 const root=document.createElement('div');root.innerHTML='<p>Fictional text</p>';
 const values=new Map<string,string>();const dt={getData:(k:string)=>values.get(k)??'',setData:(k:string,v:string)=>values.set(k,v),get types(){return [...values.keys()];}} as unknown as DataTransfer;
 const cleanup=attachPageDragBridge(root,()=>false);const event=new Event('dragstart',{bubbles:true});Object.defineProperty(event,'dataTransfer',{value:dt});root.firstElementChild!.dispatchEvent(event);expect(values.size).toBe(0);cleanup();
});

it('selects the dragged page before native serialization instead of moving a previous text selection',()=>{
 const PageNode=SubPageBlock.extend({addNodeView(){return ({node})=>{
  const dom=document.createElement('div');dom.className='react-renderer node-subPageBlock';
  const card=document.createElement('div');card.dataset.pageCard=node.attrs.pageId;card.dataset.pageTitle=node.attrs.title;card.dataset.pageSource='child';dom.append(card);return {dom};
 };}});
 const editor=new Editor({element:document.createElement('div'),extensions:[StarterKit,PageNode,PageDragBridge],content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Before'}]},{type:'subPageBlock',attrs:{pageId:'alpha',title:'Alpha'}}]}});
 try {
  editor.commands.setTextSelection({from:2,to:3});
  vi.spyOn(editor.view,'posAtCoords').mockReturnValue({pos:2,inside:0});
  const data=new Map<string,string>();const dt={files:[],clearData:()=>data.clear(),setData:(k:string,v:string)=>data.set(k,v),getData:(k:string)=>data.get(k)??'',get types(){return [...data.keys()];},effectAllowed:''} as unknown as DataTransfer;
  const event=new Event('dragstart',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:dt});
  editor.view.dom.querySelector('.node-subPageBlock')!.dispatchEvent(event);
  expect(editor.view.dragging?.slice.content.firstChild?.type.name).toBe('subPageBlock');
  expect(dt.getData('text/html')).toContain('sub-page-block');expect(readPageDrag(dt)?.id).toBe('alpha');
 } finally {editor.destroy();}
});
