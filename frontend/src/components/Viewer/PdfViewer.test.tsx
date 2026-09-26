import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PdfViewer } from './PdfViewer';

describe('PdfViewer', () => {
  it('isolates the embedded document from the application origin', () => {
    render(<PdfViewer url="/uploads/report.pdf" title="Report" />);
    const frame = screen.getByTitle('Report');
    expect(frame.getAttribute('src')).toBe('/uploads/report.pdf');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });
});
