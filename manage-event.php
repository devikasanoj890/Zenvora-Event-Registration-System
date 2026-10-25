<?php
require __DIR__ . '/db.php';

$user = require_role(['organizer', 'admin']);
$isAdmin = ($user['role'] === 'admin');

function event_select_sql()
{
    return "SELECT
                e.event_id,
                e.event_name AS title,
                e.description,
                e.category,
                NULL AS image_url,
                e.event_date,
                e.venue AS location,
                e.price,
                e.capacity,
                'active' AS status,
                e.approval_status,
                e.created_by,
                u.full_name AS organizer_name,
                (SELECT COUNT(*)
                 FROM registrations r
                 WHERE r.event_id = e.event_id
                 AND r.booking_status <> 'cancelled') AS registration_count
            FROM events e
            LEFT JOIN users u ON u.user_id = e.created_by";
}

function shape_event($row)
{
    $row['event_id'] = (int) $row['event_id'];
    $row['price'] = (float) $row['price'];
    $row['capacity'] = $row['capacity'] === null
        ? null : (int) $row['capacity'];
    $row['created_by'] = $row['created_by'] === null
        ? null : (int) $row['created_by'];
    $row['registration_count'] = (int) $row['registration_count'];

    return $row;
}

function load_event_for($pdo, $eventId, $user)
{
    $stmt = $pdo->prepare(
        event_select_sql() . ' WHERE e.event_id = ? LIMIT 1'
    );
    $stmt->execute([$eventId]);
    $event = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$event) {
        fail('Event not found.', 404);
    }

    if (
        $user['role'] !== 'admin' &&
        (int) $event['created_by'] !== (int) $user['user_id']
    ) {
        fail('You can only manage your own events.', 403);
    }

    return shape_event($event);
}

function clean_event_fields($data, $existing = null)
{
    $title = trim((string) ($data['title'] ?? ''));
    $description = trim((string) ($data['description'] ?? ''));
    $location = trim((string) ($data['location'] ?? ''));
    $category = trim((string) ($data['category'] ?? 'General'));
    $date = trim((string) ($data['event_date'] ?? ''));
    $priceRaw = $data['price'] ?? null;
    $capacityRaw = $data['capacity'] ?? null;

    if (mb_strlen($title) < 3 || mb_strlen($title) > 150) {
        fail('Event title must be 3 to 150 characters.', 400);
    }

    if ($description === '' || mb_strlen($description) > 5000) {
        fail('Please enter a description (maximum 5000 characters).', 400);
    }

    if (mb_strlen($location) < 2 || mb_strlen($location) > 100) {
        fail('Location must be 2 to 100 characters.', 400);
    }

    if ($category === '') {
        $category = 'General';
    }

    if (mb_strlen($category) > 50) {
        fail('Category must not exceed 50 characters.', 400);
    }

    $parsed = DateTime::createFromFormat('!Y-m-d', $date);
    $errors = DateTime::getLastErrors();

    if (
        !$parsed ||
        ($errors && (
            $errors['warning_count'] > 0 ||
            $errors['error_count'] > 0
        )) ||
        $parsed->format('Y-m-d') !== $date
    ) {
        fail('Please enter a valid event date.', 400);
    }

    $dateChanged = (
        !$existing ||
        substr((string) $existing['event_date'], 0, 10) !== $date
    );

    if ($dateChanged && $date < date('Y-m-d')) {
        fail('The event date cannot be in the past.', 400);
    }

    if (
        $priceRaw === null ||
        $priceRaw === '' ||
        !is_numeric($priceRaw) ||
        (float) $priceRaw < 0 ||
        (float) $priceRaw > 1000000
    ) {
        fail('Enter a valid price. Use 0 for a free event.', 400);
    }

    $price = round((float) $priceRaw, 2);

    $capacity = null;

    if ($capacityRaw !== null && $capacityRaw !== '') {
        $capacity = filter_var($capacityRaw, FILTER_VALIDATE_INT);

        if ($capacity === false || $capacity < 1 || $capacity > 100000) {
            fail('Capacity must be a whole number between 1 and 100000.', 400);
        }
    }

    return [
        'title' => $title,
        'description' => $description,
        'location' => $location,
        'category' => $category,
        'event_date' => $date,
        'price' => $price,
        'capacity' => $capacity
    ];
}

/* GET: List manageable events */
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

    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $events[] = shape_event($row);
    }

    json_out(['success' => true, 'events' => $events]);
}

/* POST: Create, update, approve, reject, cancel or delete */
require_method('POST');

$data = read_json();
$action = (string) ($data['action'] ?? 'create');

/* CREATE EVENT */
if ($action === 'create') {
    $f = clean_event_fields($data);

    $approval = $isAdmin ? 'approved' : 'pending';

    $stmt = $pdo->prepare(
        "INSERT INTO events
        (event_name, category, event_date, venue, price, capacity,
         description, created_by, approval_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );

    $stmt->execute([
        $f['title'],
        $f['category'],
        $f['event_date'],
        $f['location'],
        $f['price'],
        $f['capacity'] ?? 100,
        $f['description'],
        $user['user_id'],
        $approval
    ]);

    json_out([
        'success' => true,
        'message' => $isAdmin
            ? 'Event created and published.'
            : 'Event submitted for administrator approval.',
        'event_id' => (int) $pdo->lastInsertId()
    ], 201);
}

/* Other actions require a valid event ID */
$eventId = filter_var(
    $data['event_id'] ?? null,
    FILTER_VALIDATE_INT
);

if (!$eventId || $eventId <= 0) {
    fail('Invalid event.', 400);
}

$event = load_event_for($pdo, $eventId, $user);

/* UPDATE EVENT */
if ($action === 'update') {
    $f = clean_event_fields($data, $event);

    if (
        $f['capacity'] !== null &&
        $f['capacity'] < $event['registration_count']
    ) {
        fail('Capacity cannot be lower than existing registrations.', 400);
    }

    $approval = $isAdmin
        ? $event['approval_status']
        : 'pending';

    $stmt = $pdo->prepare(
        "UPDATE events
         SET event_name = ?, category = ?, event_date = ?, venue = ?,
             price = ?, capacity = ?, description = ?, approval_status = ?
         WHERE event_id = ?"
    );

    $stmt->execute([
        $f['title'],
        $f['category'],
        $f['event_date'],
        $f['location'],
        $f['price'],
        $f['capacity'] ?? 100,
        $f['description'],
        $approval,
        $eventId
    ]);

    json_out([
        'success' => true,
        'message' => $isAdmin
            ? 'Event updated.'
            : 'Event updated and sent for administrator approval.'
    ]);
}

/* CANCEL EVENT
   This database has no cancelled status column.
   Marking the event rejected prevents it being approved/published. */
if ($action === 'cancel') {
    $stmt = $pdo->prepare(
        "UPDATE events SET approval_status = 'rejected' WHERE event_id = ?"
    );
    $stmt->execute([$eventId]);

    json_out([
        'success' => true,
        'message' => 'Event withdrawn from approval/publication.'
    ]);
}

/* ADMIN-ONLY ACTIONS */
if (in_array($action, ['approve', 'reject', 'delete'], true)) {
    if (!$isAdmin) {
        fail('Administrator access required.', 403);
    }

    if ($action === 'delete') {
        try {
            $pdo->beginTransaction();

            $pdo->prepare(
                'DELETE FROM registrations WHERE event_id = ?'
            )->execute([$eventId]);

            $pdo->prepare(
                'DELETE FROM events WHERE event_id = ?'
            )->execute([$eventId]);

            $pdo->commit();
        } catch (PDOException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }

        json_out([
            'success' => true,
            'message' => 'Event and its registrations deleted.'
        ]);
    }

    $newStatus = $action === 'approve' ? 'approved' : 'rejected';

    $stmt = $pdo->prepare(
        'UPDATE events SET approval_status = ? WHERE event_id = ?'
    );
    $stmt->execute([$newStatus, $eventId]);

    json_out([
        'success' => true,
        'message' => 'Event ' . $newStatus . '.'
    ]);
}

fail('Unknown action.', 400);