import { describe, expect, it } from 'vitest';
import { attachPageDragBridge } from './PageDragBridge';
import { readPageDrag, PAGE_DRAG_TYPE } from './pageDrag';
it('writes page identity after an existing native drag handler clears data, including wrapper-retargeted drags', () => {
 const root=document.createElement('div');root.innerHTML='<div data-node-view-wrapper><div data-page-card="alpha" data-page-title="Alpha" data-page-source="child"></div></div>';
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
