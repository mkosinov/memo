/** One photo card on «Мои фото» (#513). */
export interface MyPhotoCardView {
  id: string;
  /** Same-origin (or full https) url — the guest gallery's allowlisted
   * filename, rendered by the same static-serving mechanism. */
  url: string;
  /** Raw publication flag — drives the badge tint. */
  isPublic: boolean;
  /** «Опубликовано» / «Не опубликовано». */
  isPublicLabel: string;
}
