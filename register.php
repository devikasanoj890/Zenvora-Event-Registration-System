
<?php
require __DIR__ . '/db.php';
require_method('POST');

$user = require_role(['participant']);

$data = read_json();
$eventId = filter_var(
    $data['event_id'] ?? null,
    FILTER_VALIDATE_INT
);

if (!$eventId || $eventId <= 0) {
    fail('Invalid event.', 400);
}

try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare(
        'SELECT event_id, event_name, price, capacity,
                event_date, approval_status
         FROM events
         WHERE event_id = ?
         FOR UPDATE'
    );
    $stmt->execute([$eventId]);
    $event = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$event) {
        $pdo->rollBack();
        fail('Event not found.', 404);
    }

    if ($event['approval_status'] !== 'approved') {
        $pdo->rollBack();
        fail('This event is not approved.', 409);
    }

    if ($event['event_date'] < date('Y-m-d')) {
        $pdo->rollBack();
        fail('This event has already taken place.', 409);
    }

    $dup = $pdo->prepare(
        "SELECT registration_id
         FROM registrations
         WHERE user_id = ? AND event_id = ?
           AND booking_status <> 'cancelled'
         LIMIT 1"
    );
    $dup->execute([$user['user_id'], $eventId]);

    if ($dup->fetch()) {
        $pdo->rollBack();
        fail('You are already registered for this event.', 409);
    }

    if ($event['capacity'] !== null) {
        $count = $pdo->prepare(
            "SELECT COUNT(*)
             FROM registrations
             WHERE event_id = ?
               AND booking_status <> 'cancelled'"
        );
        $count->execute([$eventId]);

        if ((int) $count->fetchColumn() >= (int) $event['capacity']) {
            $pdo->rollBack();
            fail('Sorry, this event is full.', 409);
        }
    }

    $insert = $pdo->prepare(
        "INSERT INTO registrations
            (user_id, event_id, payment_amount,
             payment_status, booking_status)
         VALUES (?, ?, ?, 'not_required', 'confirmed')"
    );

    $insert->execute([
        $user['user_id'],
        $eventId,
        $event['price']
    ]);

    $registrationId = (int) $pdo->lastInsertId();

    $pdo->commit();

    json_out([
        'success' => true,
        'message' => 'You are registered for '
                     . $event['event_name'] . '.',
        'registration_id' => $registrationId
    ], 201);

} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    if (
        isset($e->errorInfo[1]) &&
        (int) $e->errorInfo[1] === 1062
    ) {
        fail('You are already registered for this event.', 409);
    }

    error_log('Registration error: ' . $e->getMessage());

    fail('Unable to save registration. Please check the server logs.', 500);
}
