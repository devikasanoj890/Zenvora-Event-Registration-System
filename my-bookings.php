
<?php
require __DIR__ . '/db.php';
require_method('GET');

$user = require_role(['participant']);

$stmt = $pdo->prepare(
    "SELECT
        r.registration_id,
        r.booking_status,
        r.registration_date,
        e.event_id,
        e.event_name AS title,
        e.category,
        e.event_date,
        e.venue AS location,
        e.price,
        e.approval_status
     FROM registrations r
     INNER JOIN events e ON e.event_id = r.event_id
     WHERE r.user_id = ?
     ORDER BY r.registration_id DESC"
);

$stmt->execute([$user['user_id']]);

$bookings = [];

foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $row['registration_id'] = (int) $row['registration_id'];
    $row['event_id'] = (int) $row['event_id'];
    $row['price'] = (float) $row['price'];
    $bookings[] = $row;
}

json_out([
    'success' => true,
    'bookings' => $bookings
]);
