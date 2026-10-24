import { toGalleryPhotoView } from '../to-gallery-vm';
import type { PhotoResponse } from '@memo/api-client';

/** Contract row factory — full PhotoResponse shape (GH #479 gallery migration). */
function photoResponse(overrides: Partial<PhotoResponse> = {}): PhotoResponse {
  return {
    id: 'p1',
    filename: '/images/gallery/p1.jpg',
    client_id: null,
    service_id: null,
    activity_id: null,
    location_id: null,
    is_public: true,
    tags: [],
    client_name: null,
    created_at: '2026-10-19T10:00:00Z',
    updated_at: '2026-10-19T10:00:00Z',
    ...overrides,
  };
}

describe('toGalleryPhotoView (GH #479: PhotoResponse → gallery view)', () => {
  it('maps url from filename and caption from tag titles joined with " · "', () => {
    const vm = toGalleryPhotoView(
      photoResponse({
        tags: [
          { id: 't1', title: 'масло' },
          { id: 't2', title: 'акварель' },
        ],
      }),
    );

    expect(vm).toEqual({
      id: 'p1',
      url: '/images/gallery/p1.jpg',
      caption: 'масло · акварель',
    });
  });

  it('single tag → caption is that tag title', () => {
    const vm = toGalleryPhotoView(
      photoResponse({ tags: [{ id: 't1', title: 'акрил' }] }),
    );
    expect(vm?.caption).toBe('акрил');
  });

  it('photo without tags gets no caption', () => {
    const vm = toGalleryPhotoView(photoResponse());
    expect(vm?.caption).toBe('');
  });

  it('allows same-origin paths — absolute and relative', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: '/images/a.jpg' }))?.url).toBe('/images/a.jpg');
    expect(toGalleryPhotoView(photoResponse({ filename: 'images/a.jpg' }))?.url).toBe('images/a.jpg');
  });

  it('allows full http(s) URLs', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: 'https://cdn.example.com/a.jpg' }))?.url).toBe('https://cdn.example.com/a.jpg');
    expect(toGalleryPhotoView(photoResponse({ filename: 'http://cdn.example.com/a.jpg' }))?.url).toBe('http://cdn.example.com/a.jpg');
  });

  it('rejects foreign schemes — javascript:, data:', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: 'javascript:alert(1)' }))).toBeNull();
    expect(toGalleryPhotoView(photoResponse({ filename: 'data:text/html;base64,xxx' }))).toBeNull();
  });

  it('rejects protocol-relative URLs (foreign-host form)', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: '//evil.example.com/a.jpg' }))).toBeNull();
  });

  it('rejects an empty filename', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: '' }))).toBeNull();
  });

  it('normalizes BEFORE the allowlist — whitespace-smuggled schemes are caught (GH #517)', () => {
    // A leading space used to slip past the scheme check and render as a URL.
    expect(toGalleryPhotoView(photoResponse({ filename: ' javascript:alert(1)' }))).toBeNull();
    expect(toGalleryPhotoView(photoResponse({ filename: 'javascript:alert(1) \t' }))).toBeNull();
  });

  it('rejects a scheme glued from control characters (GH #517)', () => {
    // "ja<NUL>vascript:" collapses into "javascript:" after control-char
    // removal — the scheme check then rejects it.
    expect(toGalleryPhotoView(photoResponse({ filename: 'ja\x00vascript:alert(1)' }))).toBeNull();
    expect(toGalleryPhotoView(photoResponse({ filename: 'data\x1f:text/html;x' }))).toBeNull();
  });

  it('strips control characters inside a same-origin path (GH #517)', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: '/images/a\x00b.jpg' }))?.url).toBe('/images/ab.jpg');
  });

  it('returns null when the filename is only whitespace/control junk (GH #517)', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: ' \x00 \x1f ' }))).toBeNull();
  });

  it('trims outer whitespace on otherwise-legit values (GH #517)', () => {
    expect(toGalleryPhotoView(photoResponse({ filename: '  /images/a.jpg  ' }))?.url).toBe('/images/a.jpg');
    expect(toGalleryPhotoView(photoResponse({ filename: '\t https://cdn.example.com/a.jpg \t' }))?.url).toBe('https://cdn.example.com/a.jpg');
  });
});
