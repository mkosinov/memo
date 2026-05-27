"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Hero } from "./sections/Hero";
import { Reviews } from "./sections/Reviews";
import { GuestGallery } from "./sections/GuestGallery";
import { CalendarLine } from "./ui/CalendarLine";
import { CategoryFilter } from "./ui/CategoryFilter";
import { LocationFilter } from "./ui/LocationFilter";
import { MKCarousel } from "./ui/MKCarousel";
import { ActivityDetail } from "./ui/ActivityDetail";
import { BookingActivityOverlay } from "./ui/BookingActivityOverlay";
import { BookingPrivateOverlay } from "./ui/BookingPrivateOverlay";
import { HamburgerMenu } from "./ui/HamburgerMenu";
import { useCalendarDays } from "./hooks/useCalendarDays";
import { useActivities } from "./hooks/useActivities";
import { useFilteredActivities } from "./hooks/useFilteredActivities";
import { useLocations } from "./hooks/useLocations";
import { useGallery } from "./hooks/useGallery";
import type { MKCardProps } from "./ui/MKCard";
import type { ActivityView } from "./lib/model/view/activity";
import type { LocationView } from "./lib/model/view/location";
import type { GalleryPhotoView } from "./lib/model/view/gallery";
import type { GuestPhoto } from "./sections/GuestGallery";
import { getLocationCookie, setLocationCookie } from "./lib/cookies";
import { getCurrentPosition } from "./lib/geolocation";

const POLLING_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

/** Map ActivityView → MKCardProps for the carousel */
function toCardProps(vm: ActivityView): MKCardProps & { id: string } {
  return {
    id: vm.id,
    imageUrl: vm.imageUrl,
    category: vm.category,
    title: vm.title,
    time: vm.time,
    duration: vm.duration,
    guestsCount: vm.guestsCount,
    priceMin: vm.priceMin,
    priceMax: vm.priceMax,
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
  _locations: Array<{ id: string }>
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
  const [selectedActivity, setSelectedActivity] = useState<ActivityView | null>(null);
  const [bookingActivity, setBookingActivity] = useState<ActivityView | null>(null);
  const [bookingFromLastCard, setBookingFromLastCard] = useState(false);

  // ── Build 14-day window for background fetch ──
  const today = new Date();
  const dateStart = today.toISOString().split("T")[0];
  const dateEnd = new Date(today);
  dateEnd.setDate(dateEnd.getDate() + 14);
  const dateEndStr = dateEnd.toISOString().split("T")[0];

  // ── Data hooks ──
  // allActivities = single source of truth for 14-day window
  const {
    activities: allActivities,
    isLoading: isAllActivitiesLoading,
  } = useActivities(
    { dateStart, dateEnd: dateEndStr },
    { refetchInterval: POLLING_INTERVAL_MS },
  );

  // Client-side filtering by date, location, category
  const selectedDateStr = selectedDate
    ? selectedDate.toISOString().split("T")[0]
    : null;
  const filteredActivities = useFilteredActivities(
    allActivities,
    selectedDateStr,
    selectedLocation,
    selectedTag,
  );

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
          locations
        );
        if (nearestId) {
          setLocationCookie(nearestId);
        }
      }
    });
  }, [locations]);

  // ── Derived data ──
  const cards = useMemo(() => filteredActivities.map(toCardProps), [filteredActivities]);
  const locationOptions = useMemo(() => locations.map(toLocationOption), [locations]);
  const guestPhotos = useMemo(() => galleryPhotos.map(toGuestPhoto), [galleryPhotos]);

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
    []
  );

  // ── Handlers ──
  const handleSelectDay = useCallback((date: Date) => {
    selectDate(date);
  }, [selectDate]);

  const handleSelectTag = useCallback((tag: string | null) => {
    setSelectedTag(tag);
  }, []);

  const handleSelectLocation = useCallback((locationId: string | null) => {
    setSelectedLocation(locationId);
  }, []);

  const handleSelectCard = useCallback((card: MKCardProps & { id: string }) => {
    const activity = allActivities.find((a) => a.id === card.id);
    if (activity) {
      setSelectedActivity(activity);
    }
  }, [allActivities]);

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
  const handleSelectActivity = useCallback((activity: ActivityView | null) => {
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
  }, [selectedActivity]);

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
    setBookingActivity(null); // Clear any existing booking activity
  }, []);

  const handleShowAgain = useCallback(() => {
    // Reset carousel to show cards again — handled by MKCarousel.resetToStack()
  }, []);

  const handleNextDay = useCallback(() => {
    // Select the next day in the calendar
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
          disabled={isAllActivitiesLoading}
        />

        {/* Фильтры: Локация и Кому в одну аккуратную строку */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#E0E0E1]/30 overflow-x-auto no-scrollbar">
          <LocationFilter
            locations={locationOptions}
            selectedLocation={selectedLocation}
            onSelectLocation={handleSelectLocation}
          />
          <CategoryFilter
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
          activities={allActivities}
          onBook={handleBook}
          onSelectActivity={handleSelectActivity}
        />
      )}

      {/* 10. BookingOverlay (regular) */}
      {bookingActivity && (
        <BookingActivityOverlay
          isOpen={!!bookingActivity}
          onClose={handleCloseBooking}
          activityId={bookingActivity.id}
          activities={allActivities}
        />
      )}

      {/* 11. BookingPrivateOverlay (individual MK) */}
      {bookingFromLastCard && (
        <BookingPrivateOverlay
          isOpen={bookingFromLastCard}
          onClose={() => setBookingFromLastCard(false)}
          preferredDate={selectedDate ? selectedDate.toISOString().split("T")[0] : undefined}
          preferredLocation={selectedLocation ?? undefined}
        />
      )}
    </main>
  );
}
