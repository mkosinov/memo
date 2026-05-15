import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { StampPanel } from '../app/components/stamp/StampPanel';
import { ScheduleProvider, useSchedule } from '../contexts/ScheduleContext';

// Wrapper that provides ScheduleContext
function Wrapper({ children }: { children: React.ReactNode }) {
  return <ScheduleProvider>{children}</ScheduleProvider>;
}

describe('StampPanel', () => {
  it('renders master, service dropdowns and location checkboxes', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    expect(screen.getByLabelText(/мастер/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/услуга/i)).toBeInTheDocument();
    expect(screen.getByText('Локации')).toBeInTheDocument();
  });

  it('shows ready indicator as not ready initially', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    const indicator = screen.getByTestId('ready-indicator');
    expect(indicator).toHaveAttribute('data-ready', 'false');
  });

  it('becomes ready when master + service + at least one location selected', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // Select master
    const masterSelect = screen.getByLabelText(/мастер/i) as HTMLSelectElement;
    fireEvent.change(masterSelect, { target: { value: 'm1' } });

    // Select service
    const serviceSelect = screen.getByLabelText(/услуга/i) as HTMLSelectElement;
    fireEvent.change(serviceSelect, { target: { value: 's1' } });

    // Select one location
    const locationCheckbox = screen.getByRole('checkbox', { name: /альпика/i });
    fireEvent.click(locationCheckbox);

    const indicator = screen.getByTestId('ready-indicator');
    expect(indicator).toHaveAttribute('data-ready', 'true');
  });

  it('shows summary text when ready', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // Select all required fields
    const masterSelect = screen.getByLabelText(/мастер/i) as HTMLSelectElement;
    fireEvent.change(masterSelect, { target: { value: 'm1' } });

    const serviceSelect = screen.getByLabelText(/услуга/i) as HTMLSelectElement;
    fireEvent.change(serviceSelect, { target: { value: 's1' } });

    const locationCheckbox = screen.getByRole('checkbox', { name: /альпика/i });
    fireEvent.click(locationCheckbox);

    // Summary should contain master short name, service name, and location name
    const summary = screen.getByTestId('stamp-summary');
    expect(summary).toHaveTextContent('Ольга');
    expect(summary).toHaveTextContent('Картина маслом');
    expect(summary).toHaveTextContent('Альпика');
  });

  it('toggles location checkbox on and off', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    const checkbox = screen.getByRole('checkbox', { name: /альпика/i }) as HTMLInputElement;

    // Initially unchecked
    expect(checkbox).not.toBeChecked();

    // Check it
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Uncheck it
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('loses ready state when location is unchecked', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // Set up ready state
    const masterSelect = screen.getByLabelText(/мастер/i) as HTMLSelectElement;
    fireEvent.change(masterSelect, { target: { value: 'm1' } });

    const serviceSelect = screen.getByLabelText(/услуга/i) as HTMLSelectElement;
    fireEvent.change(serviceSelect, { target: { value: 's1' } });

    const locationCheckbox = screen.getByRole('checkbox', { name: /альпика/i });
    fireEvent.click(locationCheckbox);

    expect(screen.getByTestId('ready-indicator')).toHaveAttribute('data-ready', 'true');

    // Uncheck location
    fireEvent.click(locationCheckbox);

    expect(screen.getByTestId('ready-indicator')).toHaveAttribute('data-ready', 'false');
  });
});
