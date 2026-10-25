
<?php
require __DIR__ . '/db.php';
require_method('GET');

$stmt = $pdo->query(
    "SELECT
        e.event_id,
        e.event_name,
        e.description,
        e.category,
        e.event_date,
        e.venue,
        e.price,
        e.capacity,
        e.approval_status,
        (
            SELECT COUNT(*)
            FROM registrations r
            WHERE r.event_id = e.event_id
              AND r.booking_status <> 'cancelled'
        ) AS registered_count
     FROM events e
     WHERE e.approval_status = 'approved'
       AND e.event_date >= CURDATE()
     ORDER BY e.event_date ASC, e.event_id ASC"
);

$events = [];

foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $capacity = $row['capacity'] === null
        ? null
        : (int) $row['capacity'];

    $registered = (int) $row['registered_count'];

    $events[] = [
        'event_id'         => (int) $row['event_id'],
        'title'            => $row['event_name'],
        'event_name'       => $row['event_name'],
        'description'      => $row['description'],
        'category'         => $row['category'],
        'image_url'        => null,
        'event_date'       => $row['event_date'],
        'location'         => $row['venue'],
        'venue'            => $row['venue'],
        'price'            => (float) $row['price'],
        'capacity'         => $capacity,
        'registered_count' => $registered,
        'spots_left'       => $capacity === null
            ? null
            : max(0, $capacity - $registered),
        'approval_status'  => $row['approval_status']
    ];
}

json_out([
    'success' => true,
    'events' => $events
]);
