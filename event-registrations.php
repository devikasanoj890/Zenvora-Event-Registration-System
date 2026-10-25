<?php
require __DIR__ . '/db.php';
require_method('GET');

// Organizers see registrations for their own events only; administrators see all.
$user = require_role(['organizer', 'admin']);

$sql = "SELECT r.registration_id, r.booking_status, r.registered_at,
               u.user_id, u.full_name, u.email,
               e.event_id, e.title AS event_title, e.event_date
        FROM registrations r
        INNER JOIN users u ON u.user_id = r.user_id
        INNER JOIN events e ON e.event_id = r.event_id";
$where = [];
$params = [];

if (isset($_GET['event_id']) && $_GET['event_id'] !== '') {
    $eventId = filter_var($_GET['event_id'], FILTER_VALIDATE_INT);
    if (!$eventId || $eventId <= 0) {
        fail('Invalid event.', 400);
    }
    $where[] = 'e.event_id = ?';
    $params[] = $eventId;
}
if ($user['role'] !== 'admin') {
    $where[] = 'e.created_by = ?';
    $params[] = $user['user_id'];
}
if ($where) {
    $sql .= ' WHERE ' . implode(' AND ', $where);
}
$sql .= ' ORDER BY r.registration_id DESC';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

$rows = [];
foreach ($stmt->fetchAll() as $row) {
    $row['registration_id'] = (int) $row['registration_id'];
    $row['user_id'] = (int) $row['user_id'];
    $row['event_id'] = (int) $row['event_id'];
    $rows[] = $row;
}

json_out(['success' => true, 'registrations' => $rows]);