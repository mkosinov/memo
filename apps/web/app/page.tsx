"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Hero } from "./sections/Hero";
import { Reviews } from "./sections/Reviews";
import { GuestGallery } from "./sections/GuestGallery";
import { CalendarLine } from "./components/CalendarLine";
import { FilterPills } from "./components/FilterPills";
import { LocationFilter } from "./components/LocationFilter";
import { MKCarousel } from "./components/MKCarousel";
import { ActivityDetail } from "./components/ActivityDetail";
import { BookingOverlay } from "./components/BookingOverlay";
import { ChatBar } from "./components/ChatBar";
import { HamburgerMenu } from "./components/HamburgerMenu";
import { useCalendarDays } from "./hooks/useCalendarDays";
import { useActivities } from "./hooks/useActivities";
import { useLocations } from "./hooks/useLocations";
import { useGallery } from "./hooks/useGallery";
import type { MKCardProps } from "./components/MKCard";
import type { ActivityViewModel } from "./lib/model/view/activity";
import type { LocationViewModel } from "./lib/model/view/location";
import type { GalleryPhotoViewModel } from "./lib/model/view/gallery";
import type { GuestPhoto } from "./sections/GuestGallery";
import { getLocationCookie, setLocationCookie } from "./lib/cookies";
import { getCurrentPosition } from "./lib/geolocation";

/** Map ActivityViewModel → MKCardProps for the carousel */
function toCardProps(vm: ActivityViewModel): MKCardProps & { id: string } {
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

/** Map ActivityViewModel → ActivityDetail activity prop */
function toActivityDetail(vm: ActivityViewModel): React.ComponentProps<typeof ActivityDetail>["activity"] {
  return {
    id: vm.id,
    imageUrl: vm.imageUrl,
    teacherName: vm.teacherName,
    teacherAvatar: vm.teacherAvatar,
    date: vm.dateFormatted,
    time: vm.time,
    material: vm.material,
    priceMin: vm.priceMin,
    priceMax: vm.priceMax,
    location: vm.location.name,
  };
}

/** Map ActivityViewModel → BookingOverlay activity prop */
function toBookingActivity(vm: ActivityViewModel): React.ComponentProps<typeof BookingOverlay>["activity"] {
  return {
    imageUrl: vm.imageUrl,
    title: vm.title,
    time: `${vm.dateFormatted}, ${vm.time}`,
    location: vm.location.name,
    adultPrice: vm.priceMax,
    childPrice: Math.round(vm.priceMax * 0.7),
  };
}

/** Map LocationViewModel → LocationFilter location */
function toLocationOption(vm: LocationViewModel): { id: string; name: string } {
  return { id: vm.id, name: vm.name };
}

/** Map GalleryPhotoViewModel → GuestGallery photo */
function toGuestPhoto(vm: GalleryPhotoViewModel): GuestPhoto {
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
  const { days, selectedDate, selectDate, tab, setTab } = useCalendarDays();

  // ── Filter state ──
  const [selectedCategory, setSelectedCategory] = useState<string | null>("вместе");
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);

  // ── UI state ──
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<ActivityViewModel | null>(null);
  const [bookingActivity, setBookingActivity] = useState<ActivityViewModel | null>(null);
  const [bookingFromLastCard, setBookingFromLastCard] = useState(false);

  // ── Build filters for activities ──
  const activityFilters = useMemo(() => {
    const filters: { date?: string; location?: string; category?: string } = {};
    if (selectedDate) {
      filters.date = selectedDate.toISOString().split("T")[0];
    }
    if (selectedLocation) {
      filters.location = selectedLocation;
    }
    if (selectedCategory) {
      filters.category = selectedCategory;
    }
    return filters;
  }, [selectedDate, selectedLocation, selectedCategory]);

  // ── Data hooks ──
  const { activities } = useActivities(activityFilters);
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
  const cards = useMemo(() => activities.map(toCardProps), [activities]);
  const locationOptions = useMemo(() => locations.map(toLocationOption), [locations]);
  const guestPhotos = useMemo(() => galleryPhotos.map(toGuestPhoto), [galleryPhotos]);

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

  const handleSelectCategory = useCallback((category: string | null) => {
    setSelectedCategory(category);
  }, []);

  const handleSelectLocation = useCallback((locationId: string | null) => {
    setSelectedLocation(locationId);
  }, []);

  const handleSelectCard = useCallback((card: MKCardProps & { id: string }) => {
    const activity = activities.find((a) => a.id === card.id);
    if (activity) {
      setSelectedActivity(activity);
    }
  }, [activities]);

  const handleBook = useCallback(() => {
    if (selectedActivity) {
      setBookingActivity(selectedActivity);
      setSelectedActivity(null);
    }
  }, [selectedActivity]);

  const handleCloseActivityDetail = useCallback(() => {
    setSelectedActivity(null);
  }, []);

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

  return (
    <main className="min-h-screen bg-surface">
      {/* 1. Hero */}
      <Hero onMenuToggle={handleMenuToggle} />

      {/* 2. CalendarLine (sticky) */}
      <CalendarLine
        selectedDate={selectedDate}
        days={days}
        onSelectDay={handleSelectDay}
        tab={tab}
        onTabChange={setTab}
      />

      {/* 3. FilterPills + LocationFilter (single row) */}
      <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto no-scrollbar">
        <LocationFilter
          locations={locationOptions}
          selectedLocation={selectedLocation}
          onSelectLocation={handleSelectLocation}
        />
        <FilterPills
          selectedCategory={selectedCategory}
          onSelectCategory={handleSelectCategory}
        />
      </div>

      {/* 4. MKCarousel */}
      <MKCarousel
        cards={cards}
        lastCard={lastCard}
        onSelectCard={handleSelectCard}
        onTapLastCard={handleTapLastCard}
      />

      {/* 5. Reviews */}
      <Reviews />

      {/* 6. GuestGallery */}
      <GuestGallery photos={guestPhotos} />

      {/* 7. ChatBar (fixed bottom) */}
      <ChatBar />

      {/* 8. HamburgerMenu */}
      <HamburgerMenu isOpen={menuOpen} onClose={handleCloseMenu} />

      {/* 9. ActivityDetail */}
      {selectedActivity && (
        <ActivityDetail
          isOpen={!!selectedActivity}
          onClose={handleCloseActivityDetail}
          activity={toActivityDetail(selectedActivity)}
          onBook={handleBook}
        />
      )}

      {/* 10. BookingOverlay */}
      {(bookingActivity || bookingFromLastCard) && (
        <BookingOverlay
          isOpen={!!bookingActivity || bookingFromLastCard}
          onClose={() => {
            handleCloseBooking();
            setBookingFromLastCard(false);
          }}
          activity={
            bookingFromLastCard
              ? {
                  imageUrl: "",
                  title: "Индивидуальный мастер-класс",
                  time: "По согласованию",
                  location: "На ваш выбор",
                  adultPrice: 8200,
                  childPrice: Math.round(8200 * 0.7),
                }
              : toBookingActivity(bookingActivity!)
          }
        />
      )}
    </main>
  );
}
