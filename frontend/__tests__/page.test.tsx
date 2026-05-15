import { render, screen } from '@testing-library/react';
import Home from '../app/page';

describe('Home Page', () => {
  it('renders the Memo heading', () => {
    render(<Home />);
    expect(screen.getByText(/Memo — ColourMountains/i)).toBeInTheDocument();
  });

  it('renders the coming soon text', () => {
    render(<Home />);
    expect(screen.getByText(/Admin Schedule Builder/i)).toBeInTheDocument();
  });
});
