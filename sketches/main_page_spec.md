# Colour Mountains Website Main Page (Mobile First)

## Page Goal

The main page should sell **emotion + quick workshop selection**, not art supplies or a complex schedule.

Key user JTBD:

> "What fun thing can I do today/tomorrow at my hotel?"

Audience specifics:

- most users are **tourists**
- most bookings are **from mobile**
- a significant share of guests are **children aged 7–10**
- the user makes a decision quickly (30–90 seconds)
- the user does not want to deal with a complex calendar

---

# Main UX Principles

1. **Minimum cognitive load**
2. **Show available workshops as fast as possible**
3. **Emotion > technique**
4. **Near you = key value**
5. **Event cards must start on the first screen**
6. **Minimum visual noise**
7. **Shortest path to booking**

---

# Main Page Structure

1. Hero block
2. `Today / Tomorrow / Calendar` toggle
3. Location filter
4. Thin filter pills
5. Horizontal workshop carousel
6. Guest gallery carousel
7. Yandex Maps reviews carousel
8. Sticky chat bar at bottom

---

# 1. Hero block

### Height

Hero should occupy approximately **35% of the screen**.

Important:

The bottom part of the first workshop card must be visible **without scrolling**.

---

### Hero content

#### Background image

Large atmospheric photograph:

- mountains
- painting process
- warm atmosphere
- emotionality

Important:

The image must be aesthetic, premium-feeling, but not cluttered.

---

### Header

Contains:

- logo
- profile icon
- hamburger menu

Minimalist.

---

### Main headline

Large headline.

Example:

> Paint in the mountains  
> and take the emotions home with you

A/B tests are allowed.

---

### Below headline

One line of benefits (not two).

Example:

`Suitable for beginners • All inclusive • Near you`

Minimum visual noise.

---

# 2. Time toggle

Location:

Below hero.

---

### Tabs

- Today
- Tomorrow
- Calendar

UI:

- thin
- minimalist
- without heavy buttons

Similar to segmented control / tabs.

---

### Behavior

#### Today

Shows workshops for today only.

#### Tomorrow

Shows workshops for tomorrow only.

#### Calendar

Opens a full calendar/dates.

The calendar should not be the first screen.

---

# 3. Location filter

Location:

Next to the time toggle.

---

### Purpose

Key value:

> "Workshops near you / at your hotel"

---

### Behavior

By default:

auto-select location or last selected.

Examples:

`📍 Alpika`

or

`🏨 Your hotel: Polyana 1389`

---

### UX

Location — secondary control.

Should not visually compete with date selection.

---

# 4. Pills filters

Thin pills above the carousel.

---

### Values

- All
- For children
- For family
- For adults

---

### Behavior

Filters the workshop carousel.

Should be:

- thin
- lightweight
- unobtrusive

The user can ignore them.

---

# 5. Horizontal workshop carousel

## Most important block on the page

The carousel must be **horizontal**.

Cards should peek **from behind each other (peek effect)**.

The user must see part of the next card.

This provokes a swipe.

---

## Workshop card

### Ratio

Large card.

Premium feel.

---

### Card composition

#### 1. Large image

Large.

Main visual driver.

Example:

- mountain landscape
- sea
- animals
- sunsets

---

#### 2. Title

Large.

Example:

> Mountain landscape

---

#### 3. Key information

Minimum icons.

Format:

`Today, 18:00 • 2.5 hours`

`📍 Alpika`

---

#### 4. Social proof

Do not show emptiness.

Do not use:

❌ 8 spots left

Better:

✅ 3 guests already

or

✅ Group forming

---

#### 5. Technique

Material is mandatory.

Example:

`Acrylic • 30×40`

or

`Oil • 40×50`

Because it is an operational constraint.

Materials cannot be mixed within a group.

---

#### 6. CTA

Large button.

> Book now

---

### What NOT to show

Do not overload the card:

❌ instructor  
❌ long descriptions  
❌ too many icons  
❌ technical details

---

# 6. "Guests with Paintings" carousel

## Goal

Prove:

> "I can do it too"

Especially important for parents.

---

### Format

Horizontal carousel.

Large photos:

- child + painting
- family + painting
- adults + painting

Minimum text.

Can be text-free altogether.

---

### Title

Example:

> Our guests and their paintings

---

# 7. Reviews carousel

## Source

Yandex Maps.

---

### Header

Show trust immediately.

Example:

> ⭐ 4.9 on Yandex Maps  
> 500+ guest reviews

On the right:

> All reviews →

---

### Card format

If there is text:

Show the review.

If only rating:

Compact card:

> ⭐⭐⭐⭐⭐  
> Anna • Yandex Maps

---

### Photo

If the review has a photo — show it.

---

### Important

Reviews and guest photos are **two separate carousels**.

They serve different purposes.

---

# 8. Sticky chat at bottom

Permanently fixed at the bottom.

Like in LLM interfaces.

---

### State

Field is **immediately open**.

Not a button.

Placeholder:

> Need help choosing a workshop?

---

### Quick scenarios

Chips:

`👶 For an 8-year-old child`

`❤️ For two`

`🌧 What to do in the rain`

`⏱ Only have 1 hour`

---

### Goal

Chat = sales assistant.

Helps convert the undecided.

---

# Visual style

## Must be

- premium
- minimal
- warm
- aesthetic
- calm
- lots of whitespace

---

## Avoid

❌ visual noise  
❌ clutter  
❌ too many borders  
❌ heavy buttons  
❌ too many icons  
❌ CRM/service catalog feel

---

# Mobile requirements

## First screen

On the first screen, the user must see:

- hero
- today/tomorrow tabs
- beginning of the workshop carousel

without scrolling.

---

## Horizontal swipe

All carousels swipe horizontally.

---

## Performance

LCP < 2.5s

Priority:

1. hero image
2. first workshop card
3. lazy load the rest

---

# Analytics events

Tracking is mandatory.

Events:

- open_home
- switch_today
- switch_tomorrow
- open_calendar
- change_location
- click_filter_children
- click_filter_family
- swipe_workshop_carousel
- click_workshop
- click_book
- open_chat
- send_chat_message
- open_reviews
- scroll_depth

---

# Main idea of the page

Don't sell:

> an art service

Sell:

> a great experience near you in the mountains
