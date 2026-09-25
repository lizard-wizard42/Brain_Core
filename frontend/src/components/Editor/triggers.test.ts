import { describe, expect, it } from 'vitest';
import { findTrailingEditorTriggerQuery } from './triggers';

describe('findTrailingEditorTriggerQuery', () => {
  it('detecta comandos de barra no inicio ou apos espaco', () => {
    expect(findTrailingEditorTriggerQuery('/', '/')).toBe('');
    expect(findTrailingEditorTriggerQuery('texto /tabela', '/')).toBe('tabela');
  });

  it('ignora barras dentro de datas e caminhos sem separador', () => {
    expect(findTrailingEditorTriggerQuery('hoje e 07/07/26', '/')).toBeNull();
    expect(findTrailingEditorTriggerQuery('https://example.com/a', '/')).toBeNull();
  });

  it('ignora arroba dentro de email', () => {
    expect(findTrailingEditorTriggerQuery('contato user@example.com', '@')).toBeNull();
    expect(findTrailingEditorTriggerQuery('linkar @Projeto', '@')).toBe('Projeto');
  });
});
