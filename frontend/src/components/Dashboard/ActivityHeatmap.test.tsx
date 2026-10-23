import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap } from './ActivityHeatmap';
import { QuickDailyCapture } from './QuickDailyCapture';

describe('ActivityHeatmap', () => {
  it('renderiza o cabeçalho e calcula o total de contribuições', () => {
    const activityData = [
      { date: '2026-10-20', count: 3 },
      { date: '2026-10-21', count: 5 },
    ];

    render(<ActivityHeatmap activityData={activityData} />);

    expect(screen.getByText(/Consistência & Atividade/)).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });
});

describe('QuickDailyCapture', () => {
  it('permite digitar e salvar nota via botão ou Enter', async () => {
    const onCapture = vi.fn().mockResolvedValue(undefined);
    render(<QuickDailyCapture onCaptureNote={onCapture} />);

    const input = screen.getByPlaceholderText(/Pensamento rápido \/ Daily Log/);
    fireEvent.change(input, { target: { value: 'Minha nota de teste diária' } });

    const btn = screen.getByRole('button', { name: 'Salvar registro rápido' });
    fireEvent.click(btn);

    expect(onCapture).toHaveBeenCalledWith('Minha nota de teste diária');
  });
});
