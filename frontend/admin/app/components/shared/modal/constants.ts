// Standard modal cap for all admin modals. The shell sizes to its CONTENT
// up to max-h (GH #262): a short form (PasswordModal) is no longer stretched
// to a fixed height, while tall content (MyDataModal) is capped and its
// overflow-y-auto body scrolls.
// GH #598: a consumer may OPT INTO a fixed height via the `heightClass` prop
// (e.g. the activity modal passes h-[85dvh]); the cap stays — it supplements,
// never replaces.
export const MODAL_CONTAINER_CLASS = 'flex flex-col overflow-hidden max-h-[85vh]';
export const MODAL_MAX_WIDTH = 'max-w-2xl';

// Small variant (compact forms: single field, no scrollable lists)
export const MODAL_SMALL_CLASS = 'flex flex-col overflow-hidden max-h-[60vh]';
export const MODAL_SMALL_MAX_WIDTH = 'max-w-lg';
