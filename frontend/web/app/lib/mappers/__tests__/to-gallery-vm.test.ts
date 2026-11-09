import { toGalleryPhotoView } from '../to-gallery-vm';
import type { PhotoPublicResponse } from '@memo/api-client';

/** Contract row factory — minimal public schema (#493). */
function publicPhoto(overrides: Partial<PhotoPublicResponse> = {}): PhotoPublicResponse {
  return { id: 'p1', filename: '/images/gallery/p1.jpg', tags: [], ...overrides };
}

describe('toGalleryPhotoView (#493: PhotoPublicResponse → gallery view)', () => {
  it('maps url from filename and caption from tag strings joined with " · "', () => {
    const vm = toGalleryPhotoView(
      publicPhoto({
        tags: ['масло', 'акварель'],
      }),
    );

    expect(vm).toEqual({
      id: 'p1',
      url: '/images/gallery/p1.jpg',
      caption: 'масло · акварель',
    });
  });

  it('single tag → caption is that tag string', () => {
    const vm = toGalleryPhotoView(
      publicPhoto({ tags: ['акрил'] }),
    );
    expect(vm?.caption).toBe('акрил');
  });

  it('photo without tags gets no caption', () => {
    const vm = toGalleryPhotoView(publicPhoto());
    expect(vm?.caption).toBe('');
  });

  it('allows same-origin paths — absolute and relative', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: '/images/a.jpg' }))?.url).toBe('/images/a.jpg');
    expect(toGalleryPhotoView(publicPhoto({ filename: 'images/a.jpg' }))?.url).toBe('images/a.jpg');
  });

  it('allows full http(s) URLs', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: 'https://cdn.example.com/a.jpg' }))?.url).toBe('https://cdn.example.com/a.jpg');
    expect(toGalleryPhotoView(publicPhoto({ filename: 'http://cdn.example.com/a.jpg' }))?.url).toBe('http://cdn.example.com/a.jpg');
  });

  it('rejects foreign schemes — javascript:, data:', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: 'javascript:alert(1)' }))).toBeNull();
    expect(toGalleryPhotoView(publicPhoto({ filename: 'data:text/html;base64,xxx' }))).toBeNull();
  });

  it('rejects protocol-relative URLs (foreign-host form)', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: '//evil.example.com/a.jpg' }))).toBeNull();
  });

  it('rejects an empty filename', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: '' }))).toBeNull();
  });

  it('normalizes BEFORE the allowlist — whitespace-smuggled schemes are caught (GH #517)', () => {
    // A leading space used to slip past the scheme check and render as a URL.
    expect(toGalleryPhotoView(publicPhoto({ filename: ' javascript:alert(1)' }))).toBeNull();
    expect(toGalleryPhotoView(publicPhoto({ filename: 'javascript:alert(1) \t' }))).toBeNull();
  });

  it('rejects a scheme glued from control characters (GH #517)', () => {
    // "ja<NUL>vascript:" collapses into "javascript:" after control-char
    // removal — the scheme check then rejects it.
    expect(toGalleryPhotoView(publicPhoto({ filename: 'ja\x00vascript:alert(1)' }))).toBeNull();
    expect(toGalleryPhotoView(publicPhoto({ filename: 'data\x1f:text/html;x' }))).toBeNull();
  });

  it('strips control characters inside a same-origin path (GH #517)', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: '/images/a\x00b.jpg' }))?.url).toBe('/images/ab.jpg');
  });

  it('returns null when the filename is only whitespace/control junk (GH #517)', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: ' \x00 \x1f ' }))).toBeNull();
  });

  it('trims outer whitespace on otherwise-legit values (GH #517)', () => {
    expect(toGalleryPhotoView(publicPhoto({ filename: '  /images/a.jpg  ' }))?.url).toBe('/images/a.jpg');
    expect(toGalleryPhotoView(publicPhoto({ filename: '\t https://cdn.example.com/a.jpg \t' }))?.url).toBe('https://cdn.example.com/a.jpg');
  });
});
