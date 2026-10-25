<?php
require __DIR__ . '/db.php';

// Organizers manage ONLY their own events. Administrators manage every event.
$user = require_role(['organizer', 'admin']);
$isAdmin = ($user['role'] === 'admin');

function event_select_sql()
{
    return "SELECT e.event_id, e.title, e.description, e.category, e.image_url, e.event_date,
                   e.location, e.price, e.capacity, e.status, e.approval_status, e.created_by,
                   u.full_name AS organizer_name,
                   (SELECT COUNT(*) FROM registrations r
                     WHERE r.event_id = e.event_id AND r.booking_status <> 'cancelled') AS registration_count
            FROM events e LEFT JOIN users u ON u.user_id = e.created_by";
}

function shape_event($row)
{
    $row['event_id'] = (int) $row['event_id'];
    $row['price'] = (float) $row['price'];
    $row['capacity'] = ($row['capacity'] === null) ? null : (int) $row['capacity'];
    $row['created_by'] = ($row['created_by'] === null) ? null : (int) $row['created_by'];
    $row['registration_count'] = (int) $row['registration_count'];
    return $row;
}

function load_event_for($pdo, $eventId, $user)
{
    $stmt = $pdo->prepare(event_select_sql() . ' WHERE e.event_id = ? LIMIT 1');
    $stmt->execute([$eventId]);
    $event = $stmt->fetch();
    if (!$event) {
        fail('Event not found.', 404);
    }
    if ($user['role'] !== 'admin' && (int) $event['created_by'] !== $user['user_id']) {
        fail('You can only manage your own events.', 403);
    }
    return shape_event($event);
}

function clean_event_fields($data, $existing)
{
    $title = trim((string) (isset($data['title']) ? $data['title'] : ''));
    $description = trim((string) (isset($data['description']) ? $data['description'] : ''));
    $location = trim((string) (isset($data['location']) ? $data['location'] : ''));
    $category = trim((string) (isset($data['category']) ? $data['category'] : ''));
    $date = trim((string) (isset($data['event_date']) ? $data['event_date'] : ''));
    $imageUrl = trim((string) (isset($data['image_url']) ? $data['image_url'] : ''));
    $priceRaw = isset($data['price']) ? $data['price'] : null;
    $capacityRaw = isset($data['capacity']) ? $data['capacity'] : null;

    if (mb_strlen($title) < 3 || mb_strlen($title) > 150) {
        fail('Event title must be 3 to 150 characters.', 400);
    }
    if ($description === '' || mb_strlen($description) > 5000) {
        fail('Please enter a description (5000 characters maximum).', 400);
    }
    if (mb_strlen($location) < 2 || mb_strlen($location) > 150) {
        fail('Location must be 2 to 150 characters.', 400);
    }
    if ($category === '') {
        $category = 'General';
    }
    if (mb_strlen($category) > 60) {
        fail('Category is too long (60 characters maximum).', 400);
    }

    $parsed = DateTime::createFromFormat('Y-m-d', $date);
    $errors = DateTime::getLastErrors();
    if (!$parsed || ($errors && ($errors['warning_count'] > 0 || $errors['error_count'] > 0)) || $parsed->format('Y-m-d') !== $date) {
        fail('Please enter a valid event date.', 400);
    }
    $dateChanged = (!$existing || substr((string) $existing['event_date'], 0, 10) !== $date);
    if ($dateChanged && $date < date('Y-m-d')) {
        fail('The event date cannot be in the past.', 400);
    }

    if ($priceRaw === null || $priceRaw === '' || !is_numeric($priceRaw) || (float) $priceRaw < 0 || (float) $priceRaw > 1000000) {
        fail('Please enter a valid price (0 for a free event).', 400);
    }
    $price = round((float) $priceRaw, 2);

    $capacity = null;
    if ($capacityRaw !== null && $capacityRaw !== '') {
        $capacity = filter_var($capacityRaw, FILTER_VALIDATE_INT);
        if ($capacity === false || $capacity < 1 || $capacity > 100000) {
            fail('Capacity must be a whole number of at least 1, or left empty for unlimited.', 400);
        }
    }

    $image = null;
    if ($imageUrl !== '') {
        $scheme = strtolower((string) parse_url($imageUrl, PHP_URL_SCHEME));
        if (!filter_var($imageUrl, FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true) || strlen($imageUrl) > 500) {
            fail('Image URL must be a valid http(s) link under 500 characters.', 400);
        }
        $image = $imageUrl;
    }

    return [
        'title' => $title, 'description' => $description, 'location' => $location,
        'category' => $category, 'event_date' => $date, 'price' => $price,
        'capacity' => $capacity, 'image_url' => $image,
    ];
}

// ---------- GET: list the events this user is allowed to manage ----------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sql = event_select_sql();
    $params = [];
    if (!$isAdmin) {
        $sql .= ' WHERE e.created_by = ?';
        $params[] = $user['user_id'];
    }
    $sql .= ' ORDER BY e.event_date DESC, e.event_id DESC';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $events = [];
    foreach ($stmt->fetchAll() as $row) {
        $events[] = shape_event($row);
    }
    json_out(['success' => true, 'events' => $events]);
}

require_method('POST');
$data = read_json();
$action = (string) (isset($data['action']) ? $data['action'] : 'create');

// ---------- create ----------
if ($action === 'create') {
    $f = clean_event_fields($data, null);
    // Administrator events are published at once; organizer events wait for approval.
    $approval = $isAdmin ? 'approved' : 'pending';

    $stmt = $pdo->prepare(
        "INSERT INTO events (title, description, category, image_url, event_date, location,
                             price, capacity, created_by, approval_status, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')"
    );
    $stmt->execute([
        $f['title'], $f['description'], $f['category'], $f['image_url'], $f['event_date'],
        $f['location'], $f['price'], $f['capacity'], $user['user_id'], $approval,
    ]);

    json_out([
        'success'  => true,
        'message'  => $isAdmin ? 'Event created and published.' : 'Event submitted for administrator approval.',
        'event_id' => (int) $pdo->lastInsertId(),
    ], 201);
}

$eventId = filter_var(isset($data['event_id']) ? $data['event_id'] : null, FILTER_VALIDATE_INT);
if (!$eventId || $eventId <= 0) {
    fail('Invalid event.', 400);
}
$event = load_event_for($pdo, $eventId, $user);

// ---------- update ----------
if ($action === 'update') {
    $f = clean_event_fields($data, $event);
    if ($f['capacity'] !== null && $f['capacity'] < $event['registration_count']) {
        fail('Capacity cannot be lower than the ' . $event['registration_count'] . ' existing registrations.', 400);
    }
    // An organizer's edit goes back to the administrator for review; an admin's edit stays approved/as-is.
    $approval = $isAdmin ? $event['approval_status'] : 'pending';

    $stmt = $pdo->prepare(
        'UPDATE events SET title = ?, description = ?, category = ?, image_url = ?, event_date = ?,
                           location = ?, price = ?, capacity = ?, approval_status = ?
         WHERE event_id = ?'
    );
    $stmt->execute([
        $f['title'], $f['description'], $f['category'], $f['image_url'], $f['event_date'],
        $f['location'], $f['price'], $f['capacity'], $approval, $eventId,
    ]);

    json_out([
        'success' => true,
        'message' => $isAdmin ? 'Event updated.' : 'Event updated and sent for administrator re-approval.',
    ]);
}

// ---------- cancel (organizer: own events, admin: any) ----------
if ($action === 'cancel') {
    $stmt = $pdo->prepare("UPDATE events SET status = 'cancelled' WHERE event_id = ?");
    $stmt->execute([$eventId]);
    json_out(['success' => true, 'message' => 'Event cancelled.']);
}

// ---------- admin-only actions ----------
if ($action === 'approve' || $action === 'reject' || $action === 'delete') {
    if (!$isAdmin) {
        fail('Administrator access required.', 403);
    }

    if ($action === 'delete') {
        try {
            $pdo->beginTransaction();
            $pdo->prepare('DELETE FROM registrations WHERE event_id = ?')->execute([$eventId]);
            $pdo->prepare('DELETE FROM events WHERE event_id = ?')->execute([$eventId]);
            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        json_out(['success' => true, 'message' => 'Event and its registrations deleted.']);
    }

    $newStatus = ($action === 'approve') ? 'approved' : 'rejected';
    $stmt = $pdo->prepare('UPDATE events SET approval_status = ? WHERE event_id = ?');
    $stmt->execute([$newStatus, $eventId]);
    json_out(['success' => true, 'message' => 'Event ' . $newStatus . '.']);
}

fail('Unknown action.', 400);