import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API = "http://localhost/zenvora-api";
// Change this to the address that should receive messages from the Contact page.
const CONTACT_EMAIL = "support@zenvora.example";
const FALLBACK_IMAGE = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=900";

const ROLES = ["participant", "organizer", "admin"];
const ROLE_LABELS = { participant: "Participant", organizer: "Event Organizer", admin: "Administrator" };
const EMPTY_EVENT = { title: "", category: "", description: "", event_date: "", location: "", price: "0", capacity: "", image_url: "" };

/* ------------------------------ API layer ------------------------------ */
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${API}/${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError("Cannot reach the Zenvora server. Make sure Apache and MySQL are running in XAMPP.", 0);
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("The server sent an unexpected response. Check the XAMPP PHP error log.", response.status);
  }
  if (!response.ok || data.success === false) throw new ApiError(data.message || "Request failed.", response.status);
  return data;
}

function normalizeUser(raw) {
  if (!raw) return null;
  const role = String(raw.role || "").toLowerCase();
  if (!ROLES.includes(role)) return null;
  return { user_id: Number(raw.user_id), full_name: raw.full_name || "", email: raw.email || "", role };
}

/* ------------------------------ formatting ----------------------------- */
function formatDate(value) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
const formatPrice = (p) => (Number(p) === 0 ? "Free" : `₹${Number(p).toLocaleString("en-IN")}`);
const today = () => new Date().toISOString().slice(0, 10);

/* -------------------------------- App ---------------------------------- */
export default function App() {
  const [page, setPage] = useState("home");
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [events, setEvents] = useState([]);
  const [eventsStatus, setEventsStatus] = useState("loading");
  const [filters, setFilters] = useState({ q: "", category: "all", location: "all", price: "all" });
  const [selectedEvent, setSelectedEvent] = useState(null);

  const [bookings, setBookings] = useState([]);
  const [pendingEvent, setPendingEvent] = useState(null);
  const [registeredResult, setRegisteredResult] = useState(null);
  const [loginIntent, setLoginIntent] = useState(null);

  const [managed, setManaged] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [overview, setOverview] = useState(null);
  const [dashTab, setDashTab] = useState("events");
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({ full_name: "", email: "", password: "" });

  // userRef always holds the user the SERVER says is logged in. Async loaders compare
  // against it so a slow response for a previous account can never overwrite a new one.
  const userRef = useRef(null);

  function notify(type, text) { setNotice({ type, text }); }

  function go(nextPage, nextNotice = null) {
    setNotice(nextNotice);
    setPage(nextPage);
    // Refresh availability whenever the public event pages are opened.
    if (nextPage === "home" || nextPage === "events") loadEvents();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetUserData() {
    setBookings([]); setManaged([]); setRegistrations([]); setAdminUsers([]); setOverview(null);
    setPendingEvent(null); setRegisteredResult(null); setEditing(null); setDashTab("events");
  }

  function applyUser(next) {
    const prev = userRef.current;
    userRef.current = next;
    setUser(next);
    if (!prev || !next || prev.user_id !== next.user_id || prev.role !== next.role) resetUserData();
  }

  function handleError(err) {
    if (err.status === 401 && userRef.current) {
      applyUser(null);
      go("login", { type: "error", text: "Your session has ended. Please log in again." });
    } else {
      notify("error", err.message || "Something went wrong.");
    }
  }

  async function forUser(fetcher, setter) {
    const uid = userRef.current ? userRef.current.user_id : null;
    try {
      const data = await fetcher();
      if ((userRef.current ? userRef.current.user_id : null) === uid) setter(data);
    } catch (err) { handleError(err); }
  }

  /* ----- session: the PHP session is the single source of truth ----- */
  async function refreshSession() {
    try {
      const data = await request("session.php");
      const next = normalizeUser(data.user);
      applyUser(next);
      return next;
    } catch (err) {
      applyUser(null);
      notify("error", err.message);
      return null;
    }
  }

  useEffect(() => {
    refreshSession().finally(() => setAuthReady(true));
    loadEvents();
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role === "participant") loadBookings();
    else {
      loadManaged();
      loadRegistrations();
      if (user.role === "admin") { loadUsers(); loadOverview(); }
    }
  }, [user && user.user_id, user && user.role]);

  /* ------------------------------ loaders ------------------------------ */
  async function loadEvents() {
    setEventsStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const data = await request("events.php");
      setEvents(data.events || []);
      setEventsStatus("ready");
    } catch (err) {
      setEventsStatus("error");
      notify("error", err.message);
    }
  }
  const loadBookings = () => forUser(() => request("my-bookings.php"), (d) => setBookings(d.bookings || []));
  const loadManaged = () => forUser(() => request("manage-event.php"), (d) => setManaged(d.events || []));
  const loadRegistrations = () => forUser(() => request("event-registrations.php"), (d) => setRegistrations(d.registrations || []));
  const loadUsers = () => forUser(() => request("admin-users.php"), (d) => setAdminUsers(d.users || []));
  const loadOverview = () => forUser(() => request("admin-overview.php"), (d) => setOverview(d.counts || null));

  /* ----------------------------- auth actions ---------------------------- */
  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await request("login.php", { method: "POST", body: { email: form.email.trim(), password: form.password } });
      const next = await refreshSession();
      if (!next) throw new Error("Login succeeded but the browser did not keep the session. Open the site at http://localhost:5173 and allow cookies.");
      setForm({ full_name: "", email: "", password: "" });
      if (next.role === "participant" && loginIntent) {
        setPendingEvent(loginIntent);
        setLoginIntent(null);
        go("confirm", { type: "success", text: `Welcome, ${next.full_name}.` });
      } else {
        setLoginIntent(null);
        go(next.role === "participant" ? "events" : "dashboard", { type: "success", text: `Welcome, ${next.full_name}.` });
      }
    } catch (err) {
      notify("error", err.message);
    } finally { setBusy(false); }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await request("register-user.php", { method: "POST", body: { full_name: form.full_name.trim(), email: form.email.trim(), password: form.password } });
      await request("login.php", { method: "POST", body: { email: form.email.trim(), password: form.password } });
      const next = await refreshSession();
      if (!next) throw new Error("Account created, but automatic login failed. Please log in.");
      setForm({ full_name: "", email: "", password: "" });
      go("events", { type: "success", text: `Account created. Welcome to Zenvora, ${next.full_name}!` });
    } catch (err) {
      notify("error", err.message);
    } finally { setBusy(false); }
  }

  async function handleLogout() {
    try {
      await request("logout.php", { method: "POST", body: {} });
    } catch (err) {
      notify("error", `Logout failed: ${err.message}`);
      await refreshSession();
      return;
    }
    const still = await refreshSession();
    if (still) notify("error", "Logout did not complete on the server. Please try again.");
    else go("home", { type: "success", text: "You have been logged out." });
  }

  /* ------------------------- participant actions ------------------------- */
  function startRegistration(event) {
    if (!user) {
      setLoginIntent(event);
      go("login", { type: "info", text: "Please log in to register for an event." });
      return;
    }
    if (user.role !== "participant") { notify("error", "Only participants can register for events."); return; }
    setPendingEvent(event);
    setRegisteredResult(null);
    go("confirm");
  }

  async function confirmRegistration() {
    if (!pendingEvent) return;
    setBusy(true);
    try {
      const data = await request("register.php", { method: "POST", body: { event_id: pendingEvent.event_id } });
      setRegisteredResult({ event: pendingEvent, message: data.message });
      setPendingEvent(null);
      await Promise.all([loadBookings(), loadEvents()]);
      go("registered");
    } catch (err) {
      if (err.status === 409) { await Promise.all([loadBookings(), loadEvents()]); setPendingEvent(null); go("events", { type: "error", text: err.message }); }
      else handleError(err);
    } finally { setBusy(false); }
  }

  /* --------------------- organizer / administrator actions --------------- */
  async function saveEvent(values) {
    setBusy(true);
    try {
      const payload = editing ? { ...values, action: "update", event_id: editing.event_id } : { ...values, action: "create" };
      const data = await request("manage-event.php", { method: "POST", body: payload });
      setEditing(null);
      notify("success", data.message);
      await Promise.all([loadManaged(), loadEvents(), user.role === "admin" ? loadOverview() : Promise.resolve()]);
      return true;
    } catch (err) { handleError(err); return false; }
    finally { setBusy(false); }
  }

  async function eventAction(action, event) {
    const prompts = {
      cancel: `Cancel "${event.title}"? Participants will no longer be able to register.`,
      delete: `Permanently delete "${event.title}" and all of its registrations? This cannot be undone.`
    };
    if (prompts[action] && !window.confirm(prompts[action])) return;
    try {
      const data = await request("manage-event.php", { method: "POST", body: { action, event_id: event.event_id } });
      notify("success", data.message);
      await Promise.all([loadManaged(), loadEvents(), loadRegistrations(), user.role === "admin" ? loadOverview() : Promise.resolve()]);
    } catch (err) { handleError(err); }
  }

  async function changeRole(userId, role) {
    try {
      const data = await request("admin-users.php", { method: "POST", body: { user_id: userId, role } });
      notify("success", data.message);
    } catch (err) { handleError(err); }
    await Promise.all([loadUsers(), loadOverview()]);
  }

  /* ------------------------------ derived data --------------------------- */
  const categories = useMemo(() => [...new Set(events.map((e) => e.category).filter(Boolean))].sort(), [events]);
  const locations = useMemo(() => [...new Set(events.map((e) => e.location).filter(Boolean))].sort(), [events]);
  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return events.filter((e) =>
      (!q || `${e.title} ${e.description} ${e.location} ${e.category}`.toLowerCase().includes(q)) &&
      (filters.category === "all" || e.category === filters.category) &&
      (filters.location === "all" || e.location === filters.location) &&
      (filters.price === "all" || (filters.price === "free" ? e.price === 0 : e.price > 0)));
  }, [events, filters]);
  const registeredIds = useMemo(() => new Set(bookings.map((b) => b.event_id)), [bookings]);

  const isAdmin = user && user.role === "admin";
  const isOrganizer = user && user.role === "organizer";
  const cardProps = {
    user, registeredIds,
    onDetails: (ev) => { setSelectedEvent(ev); go("event"); },
    onRegister: startRegistration
  };

  /* -------------------------------- render ------------------------------- */
  return (
    <div className="app">
      <header className="navbar">
        <button className="brand" onClick={() => go("home")} aria-label="Zenvora home"><span className="brand-icon">Z</span> Zenvora</button>
        <nav className="nav-links" aria-label="Main navigation">
          <button onClick={() => go("home")}>Home</button>
          <button onClick={() => go("events")}>Events</button>
          <button onClick={() => go("about")}>About</button>
          <button onClick={() => go("contact")}>Contact Us</button>
          {user && user.role === "participant" && <button onClick={() => { loadBookings(); go("my-bookings"); }}>My Bookings</button>}
          {user && user.role !== "participant" && <button onClick={() => go("dashboard")}>{isAdmin ? "Admin Dashboard" : "Organizer Dashboard"}</button>}
          {!authReady ? null : !user ? (
            <><button onClick={() => go("login")}>Login</button><button className="nav-signup" onClick={() => go("signup")}>Sign Up</button></>
          ) : (
            <>
              <span className="welcome" aria-label="Signed-in user"><strong>{user.full_name || user.email}</strong><span className={`role-badge role-${user.role}`}>{ROLE_LABELS[user.role]}</span></span>
              <button onClick={handleLogout}>Logout</button>
            </>
          )}
        </nav>
      </header>

      <main>
        {notice && (
          <div className={`message message-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
          </div>
        )}

        {page === "home" && (
          <>
            <section className="hero">
              <div className="hero-content">
                <span className="eyebrow">YOUR NEXT EXPERIENCE STARTS HERE</span>
                <h1>Discover Events.<br />Create Memories.</h1>
                <p>Find exciting events, learn new skills and connect with people who share your interests.</p>
                <button className="primary-btn" onClick={() => go("events")}>Explore Events →</button>
              </div>
              <div className="hero-image"><img src="https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1000" alt="People enjoying a live event" /></div>
            </section>
            <section className="section">
              <div className="section-heading">
                <div><span className="eyebrow">COMING UP</span><h2>Featured Events</h2></div>
                <button className="text-btn" onClick={() => go("events")}>View all events →</button>
              </div>
              <EventList status={eventsStatus} events={events.slice(0, 3)} onRetry={loadEvents} {...cardProps} />
            </section>
            <section className="about-section">
              <span className="eyebrow">ABOUT ZENVORA</span>
              <h2>Every event brings a new possibility.</h2>
              <p>Zenvora makes discovering and registering for workshops, conferences, festivals and networking events simple.</p>
              <button className="primary-btn" onClick={() => go("about")}>Learn More</button>
            </section>
          </>
        )}

        {page === "events" && (
          <section className="section page-section">
            <span className="eyebrow">EXPLORE AND EXPERIENCE</span>
            <h1>All Events</h1>
            <p className="section-description">Search and filter to find an event that inspires you.</p>
            <div className="filter-bar">
              <input type="search" placeholder="Search by name, place or topic" aria-label="Search events" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
              <select aria-label="Category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                <option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select aria-label="Location" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })}>
                <option value="all">All locations</option>{locations.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select aria-label="Price" value={filters.price} onChange={(e) => setFilters({ ...filters, price: e.target.value })}>
                <option value="all">Any price</option><option value="free">Free</option><option value="paid">Paid</option>
              </select>
              <button className="secondary-btn" onClick={() => setFilters({ q: "", category: "all", location: "all", price: "all" })}>Clear</button>
            </div>
            <EventList status={eventsStatus} events={filtered} onRetry={loadEvents} emptyText={events.length ? "No events match your search." : "No upcoming events have been published yet."} {...cardProps} />
          </section>
        )}

        {page === "event" && selectedEvent && (
          <section className="section page-section">
            <button className="text-btn" onClick={() => go("events")}>← Back to events</button>
            <div className="detail-layout">
              <img className="detail-image" src={selectedEvent.image_url || FALLBACK_IMAGE} alt={selectedEvent.title} />
              <div>
                <span className="category-inline">{selectedEvent.category || "Event"}</span>
                <h1>{selectedEvent.title}</h1>
                <p className="detail-text">{selectedEvent.description}</p>
                <dl className="detail-facts">
                  <div><dt>Date</dt><dd>{formatDate(selectedEvent.event_date)}</dd></div>
                  <div><dt>Location</dt><dd>{selectedEvent.location}</dd></div>
                  <div><dt>Price</dt><dd>{formatPrice(selectedEvent.price)}</dd></div>
                  <div><dt>Availability</dt><dd>{selectedEvent.spots_left === null ? "Open registration" : selectedEvent.spots_left === 0 ? "Sold out" : `${selectedEvent.spots_left} spots left`}</dd></div>
                </dl>
                <RegisterButton event={selectedEvent} {...cardProps} />
              </div>
            </div>
          </section>
        )}

        {page === "about" && (
          <section className="section page-section">
            <span className="eyebrow">ABOUT ZENVORA</span>
            <h1>Events made simple</h1>
            <p className="section-description">Zenvora is an event registration platform that connects people with workshops, conferences, festivals and meetups.</p>
            <div className="feature-grid">
              <article className="feature-card"><h3>For participants</h3><p>Browse upcoming events, register in a few clicks and keep track of every booking in one place.</p></article>
              <article className="feature-card"><h3>For organizers</h3><p>Submit events, follow how many people have registered and see who is attending.</p></article>
              <article className="feature-card"><h3>For administrators</h3><p>Review event submissions, manage user roles and keep the platform trustworthy.</p></article>
            </div>
          </section>
        )}

        {page === "contact" && (
          <section className="contact-section">
            <div className="contact-card">
              <span className="eyebrow">WE'D LOVE TO HEAR FROM YOU</span>
              <h1>Contact Us</h1>
              <p>Have a question about an event or a booking? Write to us and we'll get back to you.</p>
              <ContactForm />
            </div>
          </section>
        )}

        {(page === "login" || page === "signup") && (
          <section className="auth-section">
            <form className="auth-card" onSubmit={page === "login" ? handleLogin : handleSignup}>
              <span className="eyebrow">WELCOME TO ZENVORA</span>
              <h1>{page === "login" ? "Welcome Back" : "Create Your Account"}</h1>
              <p>{page === "login" ? "Log in with your registered account." : "Join Zenvora as a participant and start exploring events."}</p>
              {page === "signup" && <label>Full Name<input type="text" required maxLength={100} autoComplete="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>}
              <label>Email Address<input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Password<input type="password" required minLength={page === "signup" ? 8 : undefined} autoComplete={page === "login" ? "current-password" : "new-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
              {page === "signup" && <p className="field-help">At least 8 characters. New accounts are created as participants.</p>}
              <button className="primary-btn auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : page === "login" ? "Login" : "Create Account"}</button>
              <div className="auth-switch">
                {page === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
                <button type="button" onClick={() => go(page === "login" ? "signup" : "login")}>{page === "login" ? "Sign Up" : "Login"}</button>
              </div>
            </form>
          </section>
        )}

        {page === "confirm" && (user && user.role === "participant" && pendingEvent ? (
          <section className="flow-section">
            <div className="flow-card">
              <span className="eyebrow">REGISTRATION CONFIRMATION</span>
              <h1>Confirm Your Registration</h1>
              <p>Please review the event details. Your registration is saved only after you confirm.</p>
              <div className="booking-summary">
                <img src={pendingEvent.image_url || FALLBACK_IMAGE} alt={pendingEvent.title} />
                <div>
                  <h2>{pendingEvent.title}</h2>
                  <p>📅 {formatDate(pendingEvent.event_date)}</p>
                  <p>📍 {pendingEvent.location}</p>
                  <p>Registering as <strong>{user.full_name}</strong> ({user.email})</p>
                  <strong>{formatPrice(pendingEvent.price)}</strong>
                </div>
              </div>
              <p className="payment-note">Zenvora does not collect payments online. Any fee for this event is arranged with the organizer.</p>
              <div className="flow-actions">
                <button className="secondary-btn" onClick={() => { setPendingEvent(null); go("events"); }}>Cancel</button>
                <button className="primary-btn" onClick={confirmRegistration} disabled={busy}>{busy ? "Saving…" : "Confirm Registration"}</button>
              </div>
            </div>
          </section>
        ) : (
          <section className="section page-section"><h1>Nothing to confirm</h1><p>Choose an event first.</p><button className="primary-btn" onClick={() => go("events")}>Browse Events</button></section>
        ))}

        {page === "registered" && registeredResult && (
          <section className="flow-section">
            <div className="flow-card success-card">
              <div className="success-icon">✓</div>
              <h1>Registration Confirmed</h1>
              <p>{registeredResult.message}</p>
              <p className="payment-note">{formatDate(registeredResult.event.event_date)} · {registeredResult.event.location}</p>
              <div className="flow-actions">
                <button className="secondary-btn" onClick={() => go("events")}>Browse More Events</button>
                <button className="primary-btn" onClick={() => go("my-bookings")}>View My Bookings</button>
              </div>
            </div>
          </section>
        )}

        {page === "my-bookings" && (user && user.role === "participant" ? (
          <section className="section page-section">
            <span className="eyebrow">PARTICIPANT AREA</span>
            <h1>My Bookings</h1>
            <p className="section-description">Your event registrations, {user.full_name}.</p>
            {bookings.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">✦</div><h2>No bookings yet</h2><p>Explore events and register for your first experience.</p><button className="primary-btn" onClick={() => go("events")}>Explore Events</button></div>
            ) : (
              <div className="booking-list">
                {bookings.map((b) => (
                  <article className="booking-row" key={b.registration_id}>
                    <img src={b.image_url || FALLBACK_IMAGE} alt={b.title} />
                    <div className="booking-info">
                      <h2>{b.title}</h2>
                      <p>📅 {formatDate(b.event_date)} · 📍 {b.location}</p>
                      <span className={`status-pill ${b.event_status === "cancelled" ? "pill-cancelled" : "pill-approved"}`}>{b.event_status === "cancelled" ? "Event cancelled" : b.booking_status === "confirmed" ? "✓ Registered" : b.booking_status}</span>
                    </div>
                    <strong>{formatPrice(b.price)}</strong>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : <AccessDenied user={user} onLogin={() => go("login")} onHome={() => go("home")} message="My Bookings is available to participants." />)}

        {page === "dashboard" && (user && user.role !== "participant" ? (
          <Dashboard
            user={user} managed={managed} registrations={registrations} adminUsers={adminUsers} overview={overview}
            tab={dashTab} setTab={setDashTab} editing={editing} setEditing={setEditing} busy={busy}
            onSave={saveEvent} onAction={eventAction} onRole={changeRole} />
        ) : <AccessDenied user={user} onLogin={() => go("login")} onHome={() => go("home")} message="This dashboard is only for organizers and administrators." />)}
      </main>

      <footer className="footer">
        <button className="footer-brand" onClick={() => go("home")}>Zenvora</button>
        <p>Discover experiences. Make connections. Create memories.</p>
        <p>© 2026 Zenvora Event Registration System</p>
      </footer>
    </div>
  );
}

/* ----------------------------- small components ----------------------------- */
function AccessDenied({ user, onLogin, onHome, message }) {
  return (
    <section className="section page-section">
      <h1>{user ? "Access denied" : "Please log in"}</h1>
      <p className="section-description">{user ? message : "You need to log in to view this page."}</p>
      {user ? <button className="primary-btn" onClick={onHome}>Return Home</button> : <button className="primary-btn" onClick={onLogin}>Login</button>}
    </section>
  );
}

function ContactForm() {
  const [c, setC] = useState({ name: "", subject: "", message: "" });
  const href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(c.subject || "Question about Zenvora")}&body=${encodeURIComponent(`${c.message}\n\n— ${c.name}`)}`;
  return (
    <form onSubmit={(e) => { e.preventDefault(); window.location.href = href; }}>
      <label className="field-label">Your name<input required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /></label>
      <label className="field-label">Subject<input required value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} /></label>
      <label className="field-label">Message<textarea required rows="5" value={c.message} onChange={(e) => setC({ ...c, message: e.target.value })} /></label>
      <button type="submit" className="primary-btn">Open in Email App</button>
      <p className="payment-note">This opens your email app with the message addressed to {CONTACT_EMAIL}. Nothing is sent until you press Send there.</p>
    </form>
  );
}

function RegisterButton({ event, user, registeredIds, onRegister }) {
  const registered = registeredIds.has(event.event_id);
  const full = event.spots_left === 0;
  const wrongRole = user && user.role !== "participant";
  const label = registered ? "✓ Registered" : full ? "Sold out" : wrongRole ? "Participants only" : "Register";
  return <button type="button" className="register-btn" disabled={registered || full || wrongRole} onClick={() => onRegister(event)}>{label}</button>;
}

function EventList({ status, events, onRetry, emptyText = "No upcoming events have been published yet.", ...rest }) {
  if (status === "loading") return <div className="empty-state"><p>Loading events…</p></div>;
  if (status === "error") return <div className="empty-state"><h2>Events could not be loaded</h2><p>Check that Apache and MySQL are running, then try again.</p><button className="primary-btn" onClick={onRetry}>Try Again</button></div>;
  if (events.length === 0) return <div className="empty-state"><div className="empty-icon">✦</div><p>{emptyText}</p></div>;
  return (
    <div className="event-grid">
      {events.map((event) => (
        <article className="event-card" key={event.event_id}>
          <div className="event-image-wrap"><img className="event-image" src={event.image_url || FALLBACK_IMAGE} alt={event.title} loading="lazy" /><span className="category">{event.category || "Event"}</span></div>
          <div className="event-content">
            <h3>{event.title}</h3>
            <p className="event-description">{event.description}</p>
            <p className="event-detail">📅 {formatDate(event.event_date)}</p>
            <p className="event-detail">📍 {event.location}</p>
            {event.spots_left !== null && <p className="event-detail">{event.spots_left === 0 ? "Sold out" : `${event.spots_left} spots left`}</p>}
            <div className="event-bottom">
              <strong>{formatPrice(event.price)}</strong>
              <div className="card-actions">
                <button type="button" className="text-btn" onClick={() => rest.onDetails(event)}>Details</button>
                <RegisterButton event={event} {...rest} />
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function StatusPills({ event }) {
  return (
    <>
      <span className={`status-pill pill-${event.approval_status}`}>{event.approval_status}</span>
      {event.status === "cancelled" && <span className="status-pill pill-cancelled">cancelled</span>}
    </>
  );
}

/* -------------------------------- dashboards -------------------------------- */
function Dashboard({ user, managed, registrations, adminUsers, overview, tab, setTab, editing, setEditing, busy, onSave, onAction, onRole }) {
  const isAdmin = user.role === "admin";
  const [regFilter, setRegFilter] = useState("all");
  const formRef = useRef(null);

  const stats = isAdmin
    ? [["Users", overview ? overview.users : "–"], ["Events", overview ? overview.events : "–"], ["Registrations", overview ? overview.registrations : "–"], ["Awaiting approval", overview ? overview.pending_events : "–"]]
    : [["My events", managed.length], ["Pending", managed.filter((e) => e.approval_status === "pending").length], ["Approved", managed.filter((e) => e.approval_status === "approved").length], ["Registrations", managed.reduce((n, e) => n + e.registration_count, 0)]];

  const ordered = [...managed].sort((a, b) => (a.approval_status === "pending" ? -1 : 0) - (b.approval_status === "pending" ? -1 : 0));
  const shownRegs = registrations.filter((r) => regFilter === "all" || String(r.event_id) === regFilter);
  const tabs = isAdmin ? [["events", "Events"], ["users", "Users"], ["registrations", "Registrations"]] : [["events", "My Events"], ["registrations", "Registrations"]];

  return (
    <section className="section page-section">
      <span className="eyebrow">{isAdmin ? "ADMINISTRATION" : "EVENT MANAGEMENT"}</span>
      <h1>{isAdmin ? "Administrator Dashboard" : "Organizer Dashboard"}</h1>
      <p className="section-description">{isAdmin ? "Oversee users, events and registrations across Zenvora." : "Create events, track registrations and follow approval status for your own events."}</p>
      <div className="dashboard-grid">{stats.map(([label, value]) => <div className="dashboard-tile" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>

      <div className="tabs" role="tablist">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "tab active" : "tab"} onClick={() => setTab(key)}>{label}</button>)}</div>

      {tab === "events" && (
        <>
          <div className="flow-card wide-card" ref={formRef}>
            <h2>{editing ? "Edit Event" : isAdmin ? "Create an Event" : "Submit a New Event"}</h2>
            <p>{editing ? (isAdmin ? "Changes are saved immediately." : "After saving, the event returns to the administrator for approval.") : isAdmin ? "Events you create are published immediately." : "New events are reviewed by an administrator before they appear on the site."}</p>
            <EventForm key={editing ? editing.event_id : "new"} initial={editing} busy={busy} onSave={onSave} onCancel={editing ? () => setEditing(null) : null} />
          </div>
          <h2 className="list-title">{isAdmin ? "All Events" : "Your Events"}</h2>
          {ordered.length === 0 ? <div className="empty-state"><p>No events yet.</p></div> : (
            <div className="booking-list">
              {ordered.map((ev) => (
                <article className="manage-row" key={ev.event_id}>
                  <div className="booking-info">
                    <h3>{ev.title}</h3>
                    <p>📅 {formatDate(ev.event_date)} · 📍 {ev.location} · {formatPrice(ev.price)}{isAdmin && ev.organizer_name ? ` · by ${ev.organizer_name}` : ""}</p>
                    <p><StatusPills event={ev} /> <span className="count-chip">{ev.registration_count}{ev.capacity ? ` / ${ev.capacity}` : ""} registered</span></p>
                    {!isAdmin && ev.approval_status === "pending" && <p className="field-help">Waiting for administrator approval.</p>}
                    {!isAdmin && ev.approval_status === "rejected" && <p className="field-help">Rejected by an administrator. Edit and save to resubmit.</p>}
                  </div>
                  <div className="row-actions">
                    <button className="secondary-btn" onClick={() => { setEditing(ev); formRef.current && formRef.current.scrollIntoView({ behavior: "smooth" }); }}>Edit</button>
                    {isAdmin && ev.approval_status !== "approved" && <button className="primary-btn small" onClick={() => onAction("approve", ev)}>Approve</button>}
                    {isAdmin && ev.approval_status !== "rejected" && <button className="secondary-btn" onClick={() => onAction("reject", ev)}>Reject</button>}
                    {ev.status === "active" && <button className="secondary-btn" onClick={() => onAction("cancel", ev)}>Cancel event</button>}
                    {isAdmin && <button className="danger-btn" onClick={() => onAction("delete", ev)}>Delete</button>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "users" && isAdmin && (
        <div className="flow-card wide-card">
          <h2>Manage Users</h2>
          <p>Change a user's role. The server re-checks your administrator access on every change.</p>
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
            {adminUsers.map((u) => (
              <tr key={u.user_id}><td>{u.full_name}</td><td>{u.email}</td><td>
                <select aria-label={`Role for ${u.full_name}`} value={u.role} disabled={u.user_id === user.user_id} onChange={(e) => onRole(u.user_id, e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>{u.user_id === user.user_id && <span className="field-help"> (you)</span>}
              </td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}

      {tab === "registrations" && (
        <div className="flow-card wide-card">
          <h2>Registrations</h2>
          <label className="field-label">Event
            <select value={regFilter} onChange={(e) => setRegFilter(e.target.value)}>
              <option value="all">All {isAdmin ? "events" : "my events"}</option>
              {managed.map((ev) => <option key={ev.event_id} value={String(ev.event_id)}>{ev.title}</option>)}
            </select>
          </label>
          {shownRegs.length === 0 ? <p className="field-help">No registrations yet.</p> : (
            <div className="table-wrap"><table><thead><tr><th>Participant</th><th>Email</th><th>Event</th><th>Registered</th><th>Status</th></tr></thead><tbody>
              {shownRegs.map((r) => <tr key={r.registration_id}><td>{r.full_name}</td><td>{r.email}</td><td>{r.event_title}</td><td>{formatDate(r.registered_at)}</td><td>{r.booking_status}</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      )}
    </section>
  );
}

function EventForm({ initial, busy, onSave, onCancel }) {
  const start = initial
    ? { title: initial.title, category: initial.category || "", description: initial.description, event_date: String(initial.event_date).slice(0, 10), location: initial.location, price: String(initial.price), capacity: initial.capacity ? String(initial.capacity) : "", image_url: initial.image_url || "" }
    : EMPTY_EVENT;
  const [v, setV] = useState(start);
  const set = (key) => (e) => setV({ ...v, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const ok = await onSave(v);
    if (ok && !initial) setV(EMPTY_EVENT);
  }

  return (
    <form onSubmit={submit}>
      <label className="field-label">Event title<input required minLength={3} maxLength={150} value={v.title} onChange={set("title")} /></label>
      <div className="form-two-col">
        <label className="field-label">Category<input maxLength={60} list="zenvora-categories" placeholder="e.g. Workshop" value={v.category} onChange={set("category")} /></label>
        <label className="field-label">Location<input required maxLength={150} value={v.location} onChange={set("location")} /></label>
      </div>
      <datalist id="zenvora-categories"><option value="Technology" /><option value="Workshop" /><option value="Business" /><option value="Festival" /><option value="Design" /><option value="Music" /></datalist>
      <label className="field-label">Description<textarea required rows="3" maxLength={5000} value={v.description} onChange={set("description")} /></label>
      <div className="form-two-col">
        <label className="field-label">Date<input type="date" required min={initial ? undefined : today()} value={v.event_date} onChange={set("event_date")} /></label>
        <label className="field-label">Price (₹, 0 for free)<input type="number" required min="0" step="0.01" value={v.price} onChange={set("price")} /></label>
      </div>
      <div className="form-two-col">
        <label className="field-label">Capacity (optional)<input type="number" min="1" step="1" placeholder="Unlimited" value={v.capacity} onChange={set("capacity")} /></label>
        <label className="field-label">Image URL (optional)<input type="url" maxLength={500} placeholder="https://…" value={v.image_url} onChange={set("image_url")} /></label>
      </div>
      <div className="flow-actions">
        {onCancel && <button type="button" className="secondary-btn" onClick={onCancel}>Cancel editing</button>}
        <button className="primary-btn" type="submit" disabled={busy}>{busy ? "Saving…" : initial ? "Save Changes" : "Create Event"}</button>
      </div>
    </form>
  );
}