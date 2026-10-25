<?php
require __DIR__ . '/db.php';

$admin = require_role(['admin']);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $pdo->query(
        'SELECT user_id, full_name, email, role, created_at FROM users ORDER BY user_id DESC'
    );
    $users = [];
    foreach ($stmt->fetchAll() as $row) {
        $row['user_id'] = (int) $row['user_id'];
        $row['role'] = strtolower(trim((string) $row['role']));
        $users[] = $row;
    }
    json_out(['success' => true, 'users' => $users]);
}

require_method('POST');
$data = read_json();
$userId = filter_var(isset($data['user_id']) ? $data['user_id'] : null, FILTER_VALIDATE_INT);
$role = (string) (isset($data['role']) ? $data['role'] : '');

if (!$userId || $userId <= 0 || !in_array($role, ['participant', 'organizer', 'admin'], true)) {
    fail('Invalid user or role.', 400);
}
if ($userId === $admin['user_id'] && $role !== 'admin') {
    fail('You cannot remove your own administrator role.', 400);
}

$check = $pdo->prepare('SELECT user_id FROM users WHERE user_id = ? LIMIT 1');
$check->execute([$userId]);
if (!$check->fetch()) {
    fail('User not found.', 404);
}

$stmt = $pdo->prepare('UPDATE users SET role = ? WHERE user_id = ?');
$stmt->execute([$role, $userId]);

json_out(['success' => true, 'message' => 'User role updated successfully.']);