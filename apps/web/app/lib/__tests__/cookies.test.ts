import { describe, it, expect, beforeEach } from 'vitest';
import { getLocationCookie, setLocationCookie, clearLocationCookie } from '../cookies';

describe('cookies', () => {
  beforeEach(() => {
    // Clear the cookie before each test
    document.cookie = 'memo_location=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  describe('getLocationCookie', () => {
    it('returns null when cookie is not set', () => {
      expect(getLocationCookie()).toBeNull();
    });

    it('returns locationId when cookie is set', () => {
      setLocationCookie('alpika');
      expect(getLocationCookie()).toBe('alpika');
    });

    it('returns locationId with complex value', () => {
      setLocationCookie('grand-hotel-1389');
      expect(getLocationCookie()).toBe('grand-hotel-1389');
    });
  });

  describe('setLocationCookie', () => {
    it('sets the location cookie with correct value', () => {
      setLocationCookie('p1389');
      expect(document.cookie).toContain('memo_location=p1389');
    });

    it('overwrites existing cookie', () => {
      setLocationCookie('alpika');
      setLocationCookie('grand');
      expect(getLocationCookie()).toBe('grand');
    });
  });

  describe('clearLocationCookie', () => {
    it('removes the location cookie', () => {
      setLocationCookie('alpika');
      expect(getLocationCookie()).toBe('alpika');
      clearLocationCookie();
      expect(getLocationCookie()).toBeNull();
    });

    it('does nothing when cookie is not set', () => {
      expect(getLocationCookie()).toBeNull();
      clearLocationCookie();
      expect(getLocationCookie()).toBeNull();
    });
  });
});
