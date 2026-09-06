---
name: vercel-composition-patterns
description: Use when building ui/ components in clean architecture — designing component APIs, refactoring prop proliferation, or composing complex UI. Based on Vercel composition-patterns for scalable React.
---

# React Composition Patterns

> Adapted from Vercel `composition-patterns` for clean architecture with `ui/` components.

## When to Use

- Creating new `ui/` components (Button, MKCard, Overlay, CalendarLine, etc.)
- Refactoring components with too many boolean props (`isOpen`, `isSelected`, `isLoading`)
- Building compound components with shared context
- Designing component APIs for reusability
- Composing sections from smaller ui/ components

## Rule Categories by Priority

| Priority | Category | Impact | Rules |
|----------|----------|--------|-------|
| 1 | Component Architecture | HIGH | Avoid boolean props, compound components |
| 2 | State Management | MEDIUM | Lift state, context interface, decouple implementation |
| 3 | Implementation Patterns | MEDIUM | Explicit variants, children over render props |

---

## 1. Component Architecture (HIGH)

### 1.1 Avoid Boolean Prop Proliferation

**Rule:** Don't add boolean props like `isSelected`, `isExpanded`, `isEditing` to customize component behavior. Each boolean doubles possible states. Use composition instead.

**Incorrect:**
```tsx
// 4 booleans = 16 possible states — unmaintainable
function MKCard({ isSelected, isExpanded, isEditing, isLoading }: Props) {
  return (
    <div>
      {isEditing ? <EditForm /> : isExpanded ? <ExpandedView /> : <CompactView />}
      {isLoading && <Spinner />}
    </div>
  )
}
```

**Correct — separate components:**
```tsx
function MKCardView({ activity }: { activity: ActivityView }) {
  return <div>{activity.serviceName}</div>
}

function MKCardSelected({ activity }: { activity: ActivityView }) {
  return <div className="ring-2 ring-gold">{activity.serviceName}</div>
}

function MKCardEditing({ activity }: { activity: ActivityView }) {
  return <EditForm activity={activity} />
}

// Usage — caller composes what they need
{isEditing ? <MKCardEditing /> : isSelected ? <MKCardSelected /> : <MKCardView />}
```

**Or use variants (see 3.1):**
```tsx
<MKCard variant="selected" activity={a} />
<MKCard variant="editing" activity={a} />
<MKCard variant="default" activity={a} />
```

### 1.2 Compound Components

**Rule:** Structure complex components as compound components with shared context. Subcomponents access shared state via context, not props.

**Use case:** Overlay with Header/Body/Footer, CalendarLine with DatePills, CardStack with Cards.

**Incorrect — monolithic:**
```tsx
function Overlay({ title, children, onClose, actions }: OverlayProps) {
  return (
    <div className="overlay">
      <header><h2>{title}</h2><button onClick={onClose}>×</button></header>
      <main>{children}</main>
      <footer>{actions}</footer>
    </div>
  )
}
```

**Correct — compound:**
```tsx
// Shared context
const OverlayContext = createContext<{ onClose: () => void } | null>(null)

function Overlay({ children }: { children: React.ReactNode }) {
  const onClose = useOverlayClose()
  return (
    <OverlayContext.Provider value={{ onClose }}>
      <div className="overlay">{children}</div>
    </OverlayContext.Provider>
  )
}

Overlay.Header = function OverlayHeader({ children }: { children: React.ReactNode }) {
  return <header className="overlay-header">{children}</header>
}

Overlay.Body = function OverlayBody({ children }: { children: React.ReactNode }) {
  return <main className="overlay-body">{children}</main>
}

Overlay.Close = function OverlayClose() {
  const { onClose } = useContext(OverlayContext)!
  return <button onClick={onClose}>×</button>
}

// Usage
<Overlay>
  <Overlay.Header><Overlay.Close /></Overlay.Header>
  <Overlay.Body>Content</Overlay.Body>
</Overlay>
```

---

## 2. State Management (MEDIUM)

### 2.1 Lift State into Provider Components

**Rule:** Move state into dedicated provider components so sibling components outside the main UI tree can access it without prop drilling.

**Incorrect — state trapped inside component:**
```tsx
function MKCarousel() {
  const [activeIndex, setActiveIndex] = useState(0)
  // Problem: How does the dot indicator outside access activeIndex?
  return (
    <div>
      <CardStack activeIndex={activeIndex} />
    </div>
  )
}
```

**Correct — state in provider:**
```tsx
const CarouselContext = createContext<{
  activeIndex: number
  setActiveIndex: (i: number) => void
} | null>(null)

function CarouselProvider({ children }: { children: React.ReactNode }) {
  const [activeIndex, setActiveIndex] = useState(0)
  return (
    <CarouselContext.Provider value={{ activeIndex, setActiveIndex }}>
      {children}
    </CarouselContext.Provider>
  )
}

function MKCarousel() {
  return (
    <CarouselProvider>
      <CardStack />
      <DotIndicator />  {/* accesses context */}
    </CarouselProvider>
  )
}
```

### 2.2 Context Interface for Dependency Injection

**Rule:** Define a generic interface with `state`, `actions`, `meta` — so the same UI components work with different state implementations (mock, real, different backends).

**Incorrect — UI coupled to specific hook:**
```tsx
function ActivityCard() {
  // Tightly coupled to a specific hook
  const { activity, loading } = useActivities()
  return <div>{activity?.serviceName}</div>
}
```

**Correct — generic interface:**
```tsx
// Generic interface
interface ActivityCardContext {
  state: { activity: ActivityView | null; isLoading: boolean }
  actions: { select: () => void; dismiss: () => void }
}

// Provider implements the interface
function ActivityCardProvider({ activityId, children }: Props) {
  const { data, loading } = useActivityDetail(activityId)
  const [dismissed, setDismissed] = useState(false)
  
  const ctx: ActivityCardContext = {
    state: { activity: dismissed ? null : data, isLoading: loading },
    actions: { select: () => {}, dismiss: () => setDismissed(true) },
  }
  
  return <ActivityCtx.Provider value={ctx}>{children}</ActivityCtx.Provider>
}
```

### 2.3 Decouple State from UI

**Rule:** The provider is the only place that knows *how* state is managed. UI components consume the context — they don't know if state comes from `useState`, `useReducer`, or external store.

**Correct:**
```tsx
// Provider — only file that knows state implementation
function FiltersProvider({ children }: { children: React.ReactNode }) {
  const [filters, dispatch] = useReducer(filtersReducer, initialState)
  // Could swap to useState or Zustand — no UI changes needed
  return <FiltersCtx.Provider value={{ filters, dispatch }}>{children}</FiltersCtx.Provider>
}

// UI — knows nothing about implementation
function FilterPills() {
  const { filters, dispatch } = useContext(FiltersCtx)!
  return filters.map(f => <Pill key={f.id} onClick={() => dispatch({ type: 'toggle', id: f.id })} />)
}
```

---

## 3. Implementation Patterns (MEDIUM)

### 3.1 Explicit Variants Instead of Boolean Modes

**Rule:** Instead of one component with `mode="view" | "edit"` booleans, create explicit variant components or use a `variant` prop with documented options.

**Incorrect:**
```tsx
// What does this render? Need to read the source
<Button outline loading disabled />
```

**Correct:**
```tsx
// Self-documenting — variants are a closed set
<Button variant="primary" />
<Button variant="outline" />
<Button variant="ghost" />
<Button variant="danger" />

// Size as separate, orthogonal prop
<Button variant="primary" size="sm" />
<Button variant="primary" size="lg" />
```

### 3.2 Children Over Render Props

**Rule:** Use `children` for composition instead of `renderX` props. Children are more readable and compose naturally.

**Incorrect:**
```tsx
<Overlay
  renderHeader={() => <h2>Title</h2>}
  renderFooter={() => <button>Save</button>}
/>
```

**Correct:**
```tsx
<Overlay>
  <Overlay.Header><h2>Title</h2></Overlay.Header>
  <Overlay.Body>Content</Overlay.Body>
  <Overlay.Footer><button>Save</button></Overlay.Footer>
</Overlay>
```

### 3.3 Architecture Principles

| Pattern | When to Use | Example |
|---------|------------|---------|
| Compound components | Complex UI with related sub-parts | Overlay, MKCarousel, CalendarLine |
| Variant prop | Small set of visual styles | Button, Badge, Pill |
| Provider + context | State shared across unrelated siblings | Carousel + indicators, Filters + pills |
| Composition (children) | Flexible layout with slots | Overlay, Card sections |
| Generic context interface | Same UI needs to work with different backends | ActivityCard (mock vs real API) |

## Anti-Patterns

| Anti-Pattern | Why Bad | Fix |
|-------------|---------|-----|
| `isXxx` boolean props | Exponential state explosion | Compound components or variants |
| Single component with 3+ modes | Unmaintainable conditionals | Explicit variants |
| Direct API calls in ui/ components | Violates clean architecture | api/ → hooks/ → ui/ |
| `renderX` props | Hard to read, breaks composition | `children` + compound components |
| State in ui/ components (not hooks) | Mixing concerns | Lift to hooks/ or providers |
| Prop drilling beyond 3 levels | Brittle, refactor-heavy | Context provider |
