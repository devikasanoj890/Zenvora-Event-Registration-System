<?php
require __DIR__ . '/db.php';
require_method('POST');

$data = read_json();
$name = trim((string) (isset($data['full_name']) ? $data['full_name'] : ''));
$email = strtolower(trim((string) (isset($data['email']) ? $data['email'] : '')));
$password = (string) (isset($data['password']) ? $data['password'] : '');

if ($name === '' || $email === '' || $password === '') {
    fail('Please fill in all fields.', 400);
}
if (mb_strlen($name) > 100) {
    fail('Name is too long (100 characters maximum).', 400);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 150) {
    fail('Enter a valid email address.', 400);
}
if (strlen($password) < 8) {
    fail('Password must be at least 8 characters.', 400);
}

$check = $pdo->prepare('SELECT user_id FROM users WHERE LOWER(email) = ? LIMIT 1');
$check->execute([$email]);
if ($check->fetch()) {
    fail('This email is already registered.', 409);
}

// Public sign-up can only ever create a participant. The role is never read from the request.
try {
    $insert = $pdo->prepare(
        "INSERT INTO users (full_name, email, password, role) VALUES (?, ?, ?, 'participant')"
    );
    $insert->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT)]);
} catch (PDOException $e) {
    if (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1062) {
        fail('This email is already registered.', 409);
    }
    throw $e;
}

json_out([
    'success' => true,
    'message' => 'Account created successfully.',
    'user_id' => (int) $pdo->lastInsertId(),
], 201);