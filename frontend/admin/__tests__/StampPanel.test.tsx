import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StampPanel } from '../app/components/stamp/StampPanel';
import { ScheduleProvider } from '../contexts/schedule/ScheduleProvider';
import { NavigationProvider } from '../contexts/NavigationContext';
import { UIProvider } from '../contexts/UIContext';

// Mock api-client so React Query hooks don't make real network calls
vi.mock('@memo/api-client', () => {
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return ({
  getAllMasters: vi.fn().mockResolvedValue([
    { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm2', first_name: 'Юлия', last_name: 'Большакова', color: '#6B7E9C', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm3', first_name: 'Анастасия', last_name: 'П.', color: '#A07060', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm4', first_name: 'Дарья', last_name: 'Тюльпина', color: '#7A6E9C', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm5', first_name: 'Александра', last_name: 'В.', color: '#8A7840', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
    { id: 'm7', first_name: 'Ирина', last_name: 'Горох', color: '#9A5870', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '', updated_at: '' },
  ]),
  getAllLocations: vi.fn().mockResolvedValue([
    { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, archived: false, created_at: '', updated_at: '' },
    { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, archived: false, created_at: '', updated_at: '' },
    { id: 'p1389', name: 'Поляна 1389', address: 'Поляна 1389, 2 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, archived: false, created_at: '', updated_at: '' },
  ]),
  getAllServices: vi.fn().mockResolvedValue([
    { id: 's1', title: 'Картина маслом', description: 'Живопись маслом', image_url: '', specialty: '', min_age: 12, max_age: 99, duration: 150, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    { id: 's2', title: 'Картина акрилом', description: 'Рисование акрилом', image_url: '', specialty: '', min_age: 6, max_age: 99, duration: 120, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    { id: 's3', title: 'Мини-картина акрилом', description: '', image_url: '', specialty: '', min_age: 6, max_age: 99, duration: 90, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    { id: 's4', title: 'Акварель', description: '', image_url: '', specialty: '', min_age: 6, max_age: 12, duration: 150, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    { id: 's5', title: 'Ручная лепка', description: '', image_url: '', specialty: '', min_age: 5, max_age: 99, duration: 90, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    { id: 's6', title: 'Роспись одежды', description: '', image_url: '', specialty: '', min_age: 8, max_age: 99, duration: 120, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    { id: 's7', title: 'Морской пейзаж', description: '', image_url: '', specialty: '', min_age: 12, max_age: 99, duration: 180, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
  ]),
  getActivities: vi.fn().mockResolvedValue(wrap([])),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  });
});

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

// Wrapper that provides both contexts
function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <UIProvider>
          <ScheduleProvider>{children}</ScheduleProvider>
        </UIProvider>
      </NavigationProvider>
    </QueryClientProvider>
  );
}

/** Opens the master combobox (trigger aria-label «Мастер»), waits for options, clicks one. */
async function selectMasterOption(optionTestId: string) {
  fireEvent.click(screen.getByLabelText(/мастер/i));
  const option = await waitFor(() => screen.getByTestId(optionTestId));
  fireEvent.click(option);
}

/** Opens the service combobox (trigger aria-label «Услуга»), waits for options, clicks one. */
async function selectServiceOption(optionTestId: string) {
  fireEvent.click(screen.getByLabelText(/услуга/i));
  const option = await waitFor(() => screen.getByTestId(optionTestId));
  fireEvent.click(option);
}

describe('StampPanel', () => {
  it('renders master, service comboboxes and location checkboxes', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // getByLabelText resolves via the combobox triggers' aria-labels
    expect(screen.getByLabelText(/мастер/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/услуга/i)).toBeInTheDocument();
    expect(screen.getByText('Локации')).toBeInTheDocument();
    // Stable e2e hook on the master wrapper (US-5)
    expect(screen.getByTestId('stamp-master-picker')).toBeInTheDocument();
  });

  it('shows «Не выбран» / «Выберите услугу» as the empty-state trigger labels', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    expect(screen.getByLabelText(/мастер/i)).toHaveTextContent('Не выбран');
    expect(screen.getByLabelText(/услуга/i)).toHaveTextContent('Выберите услугу');
  });

  it('shows master options as «Фамилия Имя» full labels', async () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    fireEvent.click(screen.getByLabelText(/мастер/i));
    const option = await waitFor(() => screen.getByTestId('combobox-option-m1'));
    expect(option).toHaveTextContent('Середа Ольга');
    expect(screen.getByTestId('combobox-option-clear')).toHaveTextContent('Не выбран');
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

  it('becomes ready when master + service + at least one location selected', async () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // Wait for master options to load (from React Query), then select one
    await selectMasterOption('combobox-option-m1');

    // Wait for service options to load, then select one
    await selectServiceOption('combobox-option-s1');

    // Wait for location data to load and select one
    const locationCheckbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /альпика/i }),
    );
    fireEvent.click(locationCheckbox);

    // Wait for stamp state to update
    await waitFor(() => {
      const indicator = screen.getByTestId('ready-indicator');
      expect(indicator).toHaveAttribute('data-ready', 'true');
    });
  });

  it('shows summary text when ready', async () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // Select master via combobox
    await selectMasterOption('combobox-option-m1');

    // Select service via combobox, filtering by typing first
    fireEvent.click(screen.getByLabelText(/услуга/i));
    await waitFor(() => screen.getByTestId('combobox-search'));
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'маслом' } });
    fireEvent.click(await waitFor(() => screen.getByTestId('combobox-option-s1')));

    // Wait for location data to load
    const locationCheckbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /альпика/i }),
    );
    fireEvent.click(locationCheckbox);

    // Summary should contain master short name, service name, and location name
    // (summary reads from the masters array, not from the picker)
    await waitFor(() => {
      const summary = screen.getByTestId('stamp-summary');
      expect(summary).toHaveTextContent('Ольга');
      expect(summary).toHaveTextContent('Картина маслом');
      expect(summary).toHaveTextContent('Альпика');
    });
  });

  it('toggles location checkbox on and off', async () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // Wait for location data to load
    const checkbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /альпика/i }),
    ) as HTMLInputElement;

    // Initially unchecked
    expect(checkbox).not.toBeChecked();

    // Check it
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).toBeChecked());

    // Uncheck it
    fireEvent.click(checkbox);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it('loses ready state when location is unchecked', async () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    // Select master and service via comboboxes
    await selectMasterOption('combobox-option-m1');
    await selectServiceOption('combobox-option-s1');

    // Wait for location data to load
    const locationCheckbox = await waitFor(() =>
      screen.getByRole('checkbox', { name: /альпика/i }),
    );
    fireEvent.click(locationCheckbox);

    // Wait for ready
    await waitFor(() => {
      expect(screen.getByTestId('ready-indicator')).toHaveAttribute('data-ready', 'true');
    });

    // Uncheck location
    fireEvent.click(locationCheckbox);

    // Wait for not ready
    await waitFor(() => {
      expect(screen.getByTestId('ready-indicator')).toHaveAttribute('data-ready', 'false');
    });
  });

  it('renders delete mode toggle button', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    const deleteBtn = screen.getByRole('button', { name: /Режим удаления/i });
    expect(deleteBtn).toBeInTheDocument();
  });

  it('delete mode toggle button turns red when active', () => {
    render(
      <Wrapper>
        <StampPanel />
      </Wrapper>,
    );

    const deleteBtn = screen.getByRole('button', { name: /Режим удаления/i });
    expect(deleteBtn).not.toHaveClass('bg-red-500');

    fireEvent.click(deleteBtn);
    expect(deleteBtn).toHaveClass('bg-red-500');
  });
});
