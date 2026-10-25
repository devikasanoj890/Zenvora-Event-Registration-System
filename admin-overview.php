<?php
require __DIR__ . '/db.php';
require_method('GET');

require_role(['admin']);

$row = $pdo->query(
    "SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE role = 'participant') AS participants,
        (SELECT COUNT(*) FROM users WHERE role = 'organizer') AS organizers,
        (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
        (SELECT COUNT(*) FROM events) AS events,
        (SELECT COUNT(*) FROM events WHERE approval_status = 'pending') AS pending_events,
        (SELECT COUNT(*) FROM registrations) AS registrations"
)->fetch();

$counts = [];
foreach ($row as $key => $value) {
    $counts[$key] = (int) $value;
}

json_out(['success' => true, 'counts' => $counts]);