"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Hero } from "./sections/Hero";
import { Reviews } from "./sections/Reviews";
import { GuestGallery } from "./sections/GuestGallery";
import { CalendarLine } from "./ui/CalendarLine";
import { ActivityTagFilter } from "./ui/ActivityTagFilter";
import { LocationFilter } from "./ui/LocationFilter";
import { MKCarousel } from "./ui/MKCarousel";
import { ActivityDetail } from "./ui/ActivityDetail";
import { BookingActivityOverlay } from "./ui/BookingActivityOverlay";
import { BookingPrivateOverlay } from "./ui/BookingPrivateOverlay";
import { HamburgerMenu } from "./ui/HamburgerMenu";
import { useCalendarDays } from "./hooks/useCalendarDays";
import { useSchedule } from "./hooks/useSchedule";
import { useLocations } from "./hooks/useLocations";
import { useGallery } from "./hooks/useGallery";
import type { MKCardProps } from "./ui/MKCard";
import type { ScheduleView } from "./lib/model/view/schedule";
import type { LocationView } from "./lib/model/view/location";
import type { GalleryPhotoView } from "./lib/model/view/gallery";
import type { GuestPhoto } from "./sections/GuestGallery";
import { getLocationCookie, setLocationCookie } from "./lib/cookies";
import { getCurrentPosition } from "./lib/geolocation";

// ── Backward compat: components still use ActivityView ─────
import type { ActivityView, ActivityTag } from "./lib/model/view/activity";

/** Map ScheduleView → MKCardProps for the carousel */
function toCardProps(vm: ScheduleView): MKCardProps & { id: string } {
  return {
    id: vm.id,
    imageUrl: vm.imageUrl,
    category: vm.tags[0] as MKCardProps["category"],
    title: vm.title,
    time: vm.time,
    duration: vm.duration,
    guestsCount: vm.guestsCount,
    priceMin: vm.priceMin,
    priceMax: vm.priceMax,
  };
}

/** Backward compat adapter: ScheduleView → ActivityView for old UI components */
function toActivityView(s: ScheduleView): ActivityView {
  return {
    id: s.id,
    title: s.title,
    category: (s.tags[0] || "") as ActivityTag,
    imageUrl: s.imageUrl,
    guestPhotos: s.photos?.map((p) => p.url),
    time: s.time,
    duration: s.duration,
    location: s.location,
    guestsCount: s.guestsCount,
    material: s.material,
    size: s.size,
    priceMin: s.priceMin,
    priceMax: s.priceMax,
    teacherName: s.masterName,
    teacherAvatar: s.masterAvatar,
    date: s.date,
    priceFormatted: s.priceFormatted,
    dateFormatted: s.dateFormatted,
    categoryColor: s.tagColors[0] || "#888888",
    nextTimes: s.nextTimes,
    priceDetails: s.priceHint,
    materialDetails: s.materialDetails,
    locationDetails: s.locationHint,
  };
}

/** Map LocationView → LocationFilter location */
function toLocationOption(vm: LocationView): { id: string; name: string } {
  return { id: vm.id, name: vm.name };
}

/** Map GalleryPhotoView → GuestGallery photo */
function toGuestPhoto(vm: GalleryPhotoView): GuestPhoto {
  return { url: vm.url, technique: vm.technique };
}

/**
 * Find the nearest location ID given user coordinates.
 * TODO: Implement haversine distance calculation when locations
 * include latitude/longitude in their DTO.
 */
function findNearestLocationId(
  _latitude: number,
  _longitude: number,
  _locations: Array<{ id: string }>,
): string | null {
  return null;
}

export default function Home() {
  // ── Calendar state (managed by hook) ──
  const { days, selectedDate, selectDate } = useCalendarDays();

  // ── Filter state ──
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  // ── UI state ──
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ScheduleView | null>(null);
  const [bookingActivity, setBookingActivity] = useState<ScheduleView | null>(null);
  const [bookingFromLastCard, setBookingFromLastCard] = useState(false);
  /** Material of the last-viewed service — prefill source for the private booking form (GH #223 §9). */
  const [lastViewedMaterial, setLastViewedMaterial] = useState<string | undefined>(undefined);

  // ── Build 14-day window for background fetch ──
  const today = new Date();
  const dateStart = today.toISOString().split("T")[0];
  const dateEnd = new Date(today);
  dateEnd.setDate(dateEnd.getDate() + 14);
  const dateEndStr = dateEnd.toISOString().split("T")[0];

  // ── Data hooks ──
  const { schedules, getByDate, isLoading } = useSchedule({
    dateStart,
    dateEnd: dateEndStr,
    location: selectedLocation ?? undefined,
    tag: selectedTag ?? undefined,
  });

  // Client-side filtering by date and tag
  const selectedDateStr = selectedDate
    ? selectedDate.toISOString().split("T")[0]
    : null;
  const filteredActivities = useMemo(() => {
    let result = schedules;
    if (selectedDateStr) {
      result = getByDate(selectedDateStr, selectedLocation ?? "all");
    }
    if (selectedTag) {
      result = result.filter((s) => s.tags.includes(selectedTag));
    }
    return result;
  }, [selectedDateStr, selectedLocation, selectedTag, schedules, getByDate]);

  const { locations } = useLocations();
  const { photos: galleryPhotos } = useGallery(12);

  // ── Geolocation: detect user location on mount ──
  useEffect(() => {
    const existing = getLocationCookie();
    if (existing) return;

    getCurrentPosition().then((pos) => {
      if (pos) {
        const nearestId = findNearestLocationId(
          pos.latitude,
          pos.longitude,
          locations,
        );
        if (nearestId) {
          setLocationCookie(nearestId);
        }
      }
    });
  }, [locations]);

  // ── Derived data ──
  const cards = useMemo(
    () => filteredActivities.map(toCardProps),
    [filteredActivities],
  );
  const locationOptions = useMemo(
    () => locations.map(toLocationOption),
    [locations],
  );
  const guestPhotos = useMemo(
    () => galleryPhotos.map(toGuestPhoto),
    [galleryPhotos],
  );

  // Backward compat: adapted schedules for old UI components
  const adaptedActivities = useMemo(
    () => filteredActivities.map(toActivityView),
    [filteredActivities],
  );

  const carouselDateLabel = useMemo(() => {
    if (!selectedDate) return "этот день";
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isSameDate = (d1: Date, d2: Date) =>
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear();

    if (isSameDate(selectedDate, today)) return "сегодня";
    if (isSameDate(selectedDate, tomorrow)) return "завтра";

    return selectedDate.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });
  }, [selectedDate]);

  // ── Last card (custom booking card) ──
  const lastCard = useMemo(
    () =>
      ({
        id: "custom-booking",
        variant: "custom" as const,
        title: "Индивидуальный мастер-класс",
        description: "В удобное для вас время. Материал — на ваш выбор.",
        price: 8200,
      }) as MKCardProps & { id: string },
    [],
  );

  // ── Handlers ──
  const handleSelectDay = useCallback(
    (date: Date) => {
      selectDate(date);
    },
    [selectDate],
  );

  const handleSelectTag = useCallback((tag: string | null) => {
    setSelectedTag(tag);
  }, []);

  const handleSelectLocation = useCallback((locationId: string | null) => {
    setSelectedLocation(locationId);
  }, []);

  const handleSelectCard = useCallback(
    (card: MKCardProps & { id: string }) => {
      const activity = schedules.find((a) => a.id === card.id);
      if (activity) {
        setSelectedActivity(activity);
        // Remember the first material title for the private-booking prefill
        setLastViewedMaterial(activity.material || undefined);
      }
    },
    [schedules],
  );

  const handleBook = useCallback(() => {
    if (selectedActivity) {
      setBookingActivity(selectedActivity);
      setSelectedActivity(null);
    }
  }, [selectedActivity]);

  const handleCloseActivityDetail = useCallback(() => {
    setSelectedActivity(null);
  }, []);

  // ── Switching between activities in ActivityDetail ──
  const switchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const handleSelectActivity = useCallback(
    (activity: ScheduleView | null) => {
      clearTimeout(switchTimerRef.current);
      if (activity === null) {
        setSelectedActivity(null);
        return;
      }
      if (selectedActivity !== null && selectedActivity.id !== activity.id) {
        // Close overlay, then reopen with new activity after exit animation
        setSelectedActivity(null);
        switchTimerRef.current = setTimeout(() => {
          setSelectedActivity(activity);
        }, 300);
      } else {
        setSelectedActivity(activity);
      }
    },
    [selectedActivity],
  );

  const handleCloseBooking = useCallback(() => {
    setBookingActivity(null);
  }, []);

  const handleMenuToggle = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const handleTapLastCard = useCallback(() => {
    setBookingFromLastCard(true);
    setBookingActivity(null);
  }, []);

  const handleShowAgain = useCallback(() => {
    // Reset carousel to show cards again — handled by MKCarousel.resetToStack()
  }, []);

  const handleNextDay = useCallback(() => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    selectDate(next);
  }, [selectedDate, selectDate]);

  return (
    <main className="bg-surface min-h-screen">
      {/* 1. Hero */}

      {/* Hero — scrolls away */}
      <Hero
        onMenuToggle={handleMenuToggle}
        locations={locationOptions}
        selectedLocation={selectedLocation}
        onSelectLocation={handleSelectLocation}
      />

      {/* 2–6. Workspace — sticks to viewport when scrolled into view */}
      <div className="sticky top-0 h-[100dvh] flex flex-col bg-surface">
        {/* CalendarLine */}
        <CalendarLine
          selectedDate={selectedDate}
          days={days}
          onSelectDay={handleSelectDay}
          disabled={isLoading}
        />

        {/* Фильтры: Локация и Кому в одну аккуратную строку */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#E0E0E1]/30 overflow-x-auto no-scrollbar">
          <LocationFilter
            locations={locationOptions}
            selectedLocation={selectedLocation}
            onSelectLocation={handleSelectLocation}
          />
          <ActivityTagFilter
            selectedCategory={selectedTag}
            onSelectCategory={handleSelectTag}
          />
        </div>

        {/* MKCarousel — fills remaining space */}
        <div className="flex-1 min-h-0">
          <MKCarousel
            cards={cards}
            lastCard={lastCard}
            onSelectCard={handleSelectCard}
            onTapLastCard={handleTapLastCard}
            onShowAgain={handleShowAgain}
            onNextDay={handleNextDay}
            dateLabel={carouselDateLabel}
          />
        </div>

        {/* Reviews */}
        <div>
          <Reviews />
        </div>

        {/* GuestGallery — final section of the page */}
        <div className="pb-6">
          <GuestGallery photos={guestPhotos} />
        </div>
      </div>

      {/* 8. HamburgerMenu */}
      <HamburgerMenu isOpen={menuOpen} onClose={handleCloseMenu} />

      {/* 9. ActivityDetail */}
      {selectedActivity && (
        <ActivityDetail
          isOpen={!!selectedActivity}
          onClose={handleCloseActivityDetail}
          activityId={selectedActivity.id}
          activities={adaptedActivities}
          onBook={handleBook}
          onSelectActivity={
            handleSelectActivity as unknown as (a: ActivityView) => void
          }
        />
      )}

      {/* 10. BookingOverlay (regular) */}
      {bookingActivity && (
        <BookingActivityOverlay
          isOpen={!!bookingActivity}
          onClose={handleCloseBooking}
          activityId={bookingActivity.id}
          activities={adaptedActivities}
        />
      )}

      {/* 11. BookingPrivateOverlay (individual MK) */}
      {bookingFromLastCard && (
        <BookingPrivateOverlay
          isOpen={bookingFromLastCard}
          onClose={() => setBookingFromLastCard(false)}
          preferredDate={
            selectedDate
              ? selectedDate.toISOString().split("T")[0]
              : undefined
          }
          preferredLocation={selectedLocation ?? undefined}
          defaultMaterial={lastViewedMaterial}
        />
      )}
    </main>
  );
}
