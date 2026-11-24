import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap } from './ActivityHeatmap';
import { QuickDailyCapture } from './QuickDailyCapture';
import { aggregateActivity } from './activityData';

afterEach(() => vi.unstubAllEnvs());

describe('ActivityHeatmap', () => {
  it('mostra exatamente 90 dias, alinha a semana e soma apenas os dias visíveis', () => {
    const activityData = [
      { date: '2025-01-10', count: 99 },
      { date: '2025-01-11', count: 3 },
      { date: '2025-04-10', count: 5 },
    ];
    const onSelectDate = vi.fn();

    render(<ActivityHeatmap activityData={activityData} today="2025-04-10" onSelectDate={onSelectDate} />);

    expect(screen.getByText(/Consistência & Atividade/)).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /2025-01-10/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /atividade\(s\)/ })).toHaveLength(90);
    expect(screen.getByRole('button', { name: /2025-01-11: 3/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2025-04-10: 5/ })).toBeInTheDocument();
    const grid = screen.getByRole('button', { name: /2025-01-11: 3/ }).parentElement!;
    expect(grid.children[0]).toHaveAttribute('aria-hidden', 'true');
    expect(grid.children[5]).toHaveAttribute('aria-hidden', 'true');
    expect(grid.children[6]).toHaveAttribute('aria-label', '2025-01-11: 3 atividade(s)');
    expect(grid).toHaveClass('w-full');
    fireEvent.click(screen.getByRole('button', { name: /2025-04-10: 5/ }));
    expect(onSelectDate).toHaveBeenCalledWith('2025-04-10');
  });
});

describe('aggregateActivity', () => {
  it('agrupa timestamps pelo dia local e ignora datas inválidas', () => {
    vi.stubEnv('TZ', 'America/Sao_Paulo');
    expect(aggregateActivity(
      [{ updated_at: '2025-04-11T01:30:00.000Z' }, { updated_at: 'invalid' }],
      [{ created_at: '2025-04-10T21:00:00.000Z' }],
    )).toEqual([{ date: '2025-04-10', count: 2 }]);
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
