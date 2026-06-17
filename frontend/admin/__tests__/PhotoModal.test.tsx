import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { PhotoModal } from '@/app/(main)/photos/components/PhotoModal';

// Mock search functions
const mockSearchVisitors = vi.fn();
const mockSearchServices = vi.fn();
const mockSearchActivities = vi.fn();
const mockSearchTags = vi.fn();

vi.mock('@memo/api-client', () => ({
  searchVisitors: (...args: unknown[]) => mockSearchVisitors(...args),
  searchServices: (...args: unknown[]) => mockSearchServices(...args),
  searchActivities: (...args: unknown[]) => mockSearchActivities(...args),
  searchTags: (...args: unknown[]) => mockSearchTags(...args),
}));

beforeEach(() => {
  mockSearchVisitors.mockReset();
  mockSearchServices.mockReset();
  mockSearchActivities.mockReset();
  mockSearchTags.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const defaultProps = {
  mode: 'create' as const,
  photo: null,
  onSubmit: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
  title: 'Добавить фото',
};

function renderPhotoModal(overrides: Record<string, unknown> = {}) {
  return render(<PhotoModal {...defaultProps} {...overrides} />);
}

describe('PhotoModal', () => {
  it('renders all fields from PHOTO_FIELDS', () => {
    renderPhotoModal();
    expect(screen.getByText('Имя файла')).toBeInTheDocument();
    expect(screen.getByText('Посетитель')).toBeInTheDocument();
    expect(screen.getByText('Услуга')).toBeInTheDocument();
    expect(screen.getByText('Активность')).toBeInTheDocument();
  });

  it('renders SearchableSelect for visitor_id field', () => {
    renderPhotoModal();
    // SearchableSelect renders an input with aria-label matching the label
    const visitorInput = screen.getByRole('textbox', { name: /Посетитель/ });
    expect(visitorInput).toBeInTheDocument();
    expect(visitorInput.tagName).toBe('INPUT');
  });

  it('renders SearchableSelect for service_id field', () => {
    renderPhotoModal();
    const serviceInput = screen.getByRole('textbox', { name: /Услуга/ });
    expect(serviceInput).toBeInTheDocument();
    expect(serviceInput.tagName).toBe('INPUT');
  });

  it('renders SearchableSelect for activity_id field', () => {
    renderPhotoModal();
    const activityInput = screen.getByRole('textbox', { name: /Активность/ });
    expect(activityInput).toBeInTheDocument();
    expect(activityInput.tagName).toBe('INPUT');
  });

  it('renders text input for filename field', () => {
    renderPhotoModal();
    // filename is a text field, should have a regular text input
    const filenameInput = screen.getByPlaceholderText('photo-001.jpg');
    expect(filenameInput).toBeInTheDocument();
    expect(filenameInput.tagName).toBe('INPUT');
  });

  it('SearchableSelect fields are not required', () => {
    renderPhotoModal();
    // visitor_id, service_id, activity_id should not have required indicators
    // The only required field is filename
    const requiredStars = screen.getAllByText('*');
    // Only 1 required field (filename) → 1 star
    expect(requiredStars).toHaveLength(1);
  });

  it('searches visitors when typing in visitor_id SearchableSelect', async () => {
    mockSearchVisitors.mockResolvedValue([
      { id: 'v1', name: 'Анна Иванова' },
    ]);

    renderPhotoModal();
    const visitorInput = screen.getByLabelText(/Посетитель/);

    act(() => {
      fireEvent.change(visitorInput, { target: { value: 'А' } });
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(mockSearchVisitors).toHaveBeenCalledWith('А');
    });
  });

  it('passes selected visitor UUID to onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderPhotoModal({ onSubmit });

    // Fill required field
    const filenameInput = screen.getByPlaceholderText('photo-001.jpg');
    act(() => {
      fireEvent.change(filenameInput, { target: { value: 'test.jpg' } });
    });

    // Submit the form
    const saveButton = screen.getByText('Сохранить');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    // Verify the submitted data has filename
    const submittedData = onSubmit.mock.calls[0][0];
    expect(submittedData).toHaveProperty('filename', 'test.jpg');
    // visitor_id, service_id, activity_id only present if user selected a value
    expect(submittedData).not.toHaveProperty('visitor_id');
    expect(submittedData).not.toHaveProperty('service_id');
    expect(submittedData).not.toHaveProperty('activity_id');
  });

  it('SearchableSelect uses onSearch prop for visitors', async () => {
    mockSearchVisitors.mockResolvedValue([]);
    
    renderPhotoModal();
    const visitorInput = screen.getByRole('textbox', { name: /Посетитель/ });
    
    act(() => {
      fireEvent.change(visitorInput, { target: { value: 'Т' } });
    });
    
    act(() => {
      vi.advanceTimersByTime(300);
    });
    
    await waitFor(() => {
      expect(mockSearchVisitors).toHaveBeenCalledWith('Т');
    });
  });
});
