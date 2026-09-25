import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewTableModal } from './NewTableModal';

describe('NewTableModal', () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ''; });

  it('confirma NxM ao clicar na célula da grade, com cabeçalho por padrão', () => {
    const onConfirm = vi.fn();
    render(<NewTableModal onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByTestId('grid-cell-3-4'));
    expect(screen.getByText('3 × 4')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('grid-cell-3-4'));
    expect(onConfirm).toHaveBeenCalledWith(3, 4, true);
  });

  it('usa o fallback numérico para tabelas maiores que a grade', () => {
    const onConfirm = vi.fn();
    render(<NewTableModal onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Linhas'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Colunas'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Inserir'));
    expect(onConfirm).toHaveBeenCalledWith(12, 2, true);
  });

  it('desmarcar "linha de cabeçalho" propaga withHeaderRow=false', () => {
    const onConfirm = vi.fn();
    render(<NewTableModal onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Linha de cabeçalho'));
    fireEvent.click(screen.getByTestId('grid-cell-2-2'));
    expect(onConfirm).toHaveBeenCalledWith(2, 2, false);
  });
});
