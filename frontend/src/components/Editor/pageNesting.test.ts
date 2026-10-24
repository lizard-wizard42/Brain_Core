import { beforeEach, describe, expect, it, vi } from 'vitest';
import { movePageInto, PageMoveError } from './pageNesting';
import { api } from '../../api/client';
vi.mock('../../api/client', () => ({ api: { getSubPages: vi.fn(), patchPage: vi.fn(), getPage: vi.fn() } }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.getSubPages).mockResolvedValue([]); vi.mocked(api.patchPage).mockResolvedValue({} as never); vi.mocked(api.getPage).mockResolvedValue({id:'root',revision:5} as never); });
describe('Page nesting transaction', () => {
 it('saves writing before the move and reloads the parent whose revision the server changed', async () => {
  const steps:string[]=[];const save=vi.fn(async()=>{steps.push('save');return true;});
  vi.mocked(api.getSubPages).mockResolvedValue([{sort_order:1000},{sort_order:2000}] as never);
  vi.mocked(api.patchPage).mockImplementation(async()=>{steps.push('move');return {} as never;});
  const parent=await movePageInto('root','alpha','beta',save);
  expect(steps).toEqual(['save','move']);expect(api.patchPage).toHaveBeenCalledWith('alpha',{parent_page_id:'beta',sort_order:3000});
  expect(api.getPage).toHaveBeenCalledWith('root');expect(parent.revision).toBe(5);
 });
 it('does not move when current writing could not be saved', async () => {
  await expect(movePageInto('root','alpha','beta',async()=>false)).rejects.toThrow('salvar');expect(api.patchPage).not.toHaveBeenCalled();
 });
 it('never moves a page into itself or moves the open parent via its own document', async () => {
  await expect(movePageInto('root','alpha','alpha',async()=>true)).rejects.toThrow();
  await expect(movePageInto('root','root','beta',async()=>true)).rejects.toThrow();expect(api.patchPage).not.toHaveBeenCalled();
 });
 it('distinguishes rejection from a committed move whose parent could not be reloaded', async () => {
  vi.mocked(api.patchPage).mockRejectedValueOnce(new Error('API 400 cycle'));
  try {await movePageInto('root','alpha','beta',async()=>true);}catch(error){expect((error as PageMoveError).committed).toBe(false);}
  vi.mocked(api.getPage).mockRejectedValueOnce(new Error('offline'));
  try {await movePageInto('root','alpha','beta',async()=>true);}catch(error){expect((error as PageMoveError).committed).toBe(true);}
 });
});
