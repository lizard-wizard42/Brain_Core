import { afterEach, describe, expect, it } from 'vitest';
import { clearPageDrag, readPageDrag, writePageDrag, pageDropZone, PAGE_DRAG_TYPE } from './pageDrag';
const transfer = () => {
 const data = new Map<string,string>();
 return { setData: (k:string,v:string) => data.set(k,v), getData: (k:string) => data.get(k) ?? '', get types() { return [...data.keys()]; }, effectAllowed: '' } as unknown as DataTransfer;
};
afterEach(clearPageDrag);
describe('Page drag protocol', () => {
 it('carries a page identity between the sidebar and editor without accepting plain text', () => {
  const dt=transfer(); const page={id:'fictional-alpha',title:'Alpha',origin:'editor' as const,reference:false};
  writePageDrag(dt,page);expect(readPageDrag(dt)).toEqual(page);expect(dt.effectAllowed).toBe('move');
  const foreign=transfer();foreign.setData('text/plain','fictional-alpha');expect(readPageDrag(foreign)).toBeNull();
 });
 it('keeps local drag identity available when browser dragover protects getData', () => {
  const dt=transfer();writePageDrag(dt,{id:'a',title:'Alpha',origin:'sidebar',reference:false});
  expect(readPageDrag({types:[PAGE_DRAG_TYPE],getData:()=>''} as unknown as DataTransfer)?.id).toBe('a');
  clearPageDrag();expect(readPageDrag({types:[PAGE_DRAG_TYPE],getData:()=>''} as unknown as DataTransfer)).toBeNull();
 });
 it('rejects malformed payloads', () => {
  const dt=transfer();dt.setData(PAGE_DRAG_TYPE,'{');expect(readPageDrag(dt)).toBeNull();
  dt.setData(PAGE_DRAG_TYPE,JSON.stringify({id:3,origin:'editor'}));expect(readPageDrag(dt)).toBeNull();
 });
 it('distinguishes top, center and bottom targets', () => {
  expect(pageDropZone(102,100,80)).toBe('before');expect(pageDropZone(140,100,80)).toBe('inside');expect(pageDropZone(178,100,80)).toBe('after');
 });
});
