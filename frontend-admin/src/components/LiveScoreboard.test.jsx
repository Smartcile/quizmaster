import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreboardTable } from './LiveScoreboard.jsx';

// ScoreboardTable is the pure render half of the live scoreboard (the default
// export only adds data-fetching + socket refresh). It drives the per-round
// breakdown on every surface.
const base = {
  teamSizeScoring: true,
  hasBrownie: true,
  hasWhoami: true,
  rounds: [
    { id: 10, name: 'Round 1', format: 'standard' },
    { id: 20, name: 'Picture Round', format: 'intermission' },
  ],
  teams: [
    { id: 1, name: 'Alpha', size: 2, size_points: 4, brownie_total: 0, whoami_points: 2, round_scores: { 10: 10, 20: 2 }, doubled_round_id: 10, total: 18 },
    { id: 2, name: 'Beta', size: 10, size_points: -4, brownie_total: 3, whoami_points: 0, round_scores: { 10: 1 }, doubled_round_id: null, total: 0 },
  ],
};

describe('ScoreboardTable', () => {
  it('shows the loading and empty states', () => {
    const { rerender } = render(<ScoreboardTable data={null} loaded={false} />);
    expect(screen.getByText(/Loading scores/i)).toBeInTheDocument();

    rerender(<ScoreboardTable data={{ ...base, teams: [] }} loaded />);
    expect(screen.getByText(/No teams have scored/i)).toBeInTheDocument();
  });

  it('renders a column per round plus Starting / Who Am I? / Bonus / Total', () => {
    render(<ScoreboardTable data={base} loaded />);
    expect(screen.getByRole('columnheader', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Starting' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Round 1' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Picture Round' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Who Am I?' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Bonus' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeInTheDocument();
  });

  it('hides Starting / Who Am I? / Bonus columns when not applicable', () => {
    render(<ScoreboardTable data={{ ...base, teamSizeScoring: false, hasBrownie: false, hasWhoami: false }} loaded />);
    expect(screen.queryByRole('columnheader', { name: 'Starting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Who Am I?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Bonus' })).not.toBeInTheDocument();
  });

  it('formats signed handicap/bonus and marks the doubled round with ×2', () => {
    render(<ScoreboardTable data={base} loaded />);
    // Alpha's starting is +4, Beta's is -4
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('-4')).toBeInTheDocument();
    // Beta's bonus 3 → +3
    expect(screen.getByText('+3')).toBeInTheDocument();
    // Exactly one ×2 marker, on Alpha's doubled round
    expect(screen.getAllByText('×2')).toHaveLength(1);
    expect(screen.getByText('×2').closest('td')).toHaveClass('sb-doubled');
  });

  it('gives the top team the gold medal row', () => {
    render(<ScoreboardTable data={base} loaded />);
    expect(screen.getByText('🥇').closest('tr')).toHaveClass('sb-row-leader');
  });
});
