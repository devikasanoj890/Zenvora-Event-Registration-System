<?php
require __DIR__ . '/db.php';
require_method('POST');

$data = read_json();
$email = strtolower(trim((string) (isset($data['email']) ? $data['email'] : '')));
$password = (string) (isset($data['password']) ? $data['password'] : '');

if ($email === '' || $password === '') {
    fail('Please enter your email and password.', 400);
}

$stmt = $pdo->prepare(
    'SELECT user_id, full_name, email, password, role FROM users WHERE LOWER(email) = ? LIMIT 1'
);
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user || !password_verify($password, (string) $user['password'])) {
    fail('Invalid email or password.', 401);
}

$role = strtolower(trim((string) $user['role']));
if (!in_array($role, ['participant', 'organizer', 'admin'], true)) {
    fail('This account has no valid role. Please contact an administrator.', 403);
}

// Upgrade the stored hash if PHP's default algorithm/cost has changed.
if (password_needs_rehash($user['password'], PASSWORD_DEFAULT)) {
    $upd = $pdo->prepare('UPDATE users SET password = ? WHERE user_id = ?');
    $upd->execute([password_hash($password, PASSWORD_DEFAULT), $user['user_id']]);
}

// Start a brand-new session identity: wipe anything left from a previous login.
$_SESSION = [];
session_regenerate_id(true);
$_SESSION['user_id'] = (int) $user['user_id'];

json_out([
    'success' => true,
    'message' => 'Login successful.',
    'user' => [
        'user_id'   => (int) $user['user_id'],
        'full_name' => $user['full_name'],
        'email'     => $user['email'],
        'role'      => $role,
    ],
]);