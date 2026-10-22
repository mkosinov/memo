export interface GalleryPhotoView {
  id: string;
  /** Allowlisted filename — same-origin path or full http(s) URL. */
  url: string;
  /** Tag titles joined with " · "; empty when the photo has no tags. */
  caption: string;
}
