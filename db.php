<?php
// Zenvora shared bootstrap: CORS, JSON helpers, PDO connection, PHP session and role guards.
// Every endpoint does: require __DIR__ . '/db.php';
// IMPORTANT: no whitespace or text may appear before "<?php" in any file in this folder.

ini_set('display_errors', '0');   // never leak PHP warnings into the JSON response
ini_set('log_errors', '1');
error_reporting(E_ALL);

const ZENVORA_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

$zenvoraOrigin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($zenvoraOrigin, ZENVORA_ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $zenvoraOrigin);
    header('Vary: Origin');
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function json_out($payload, $status = 200)
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

function fail($message, $status = 400)
{
    json_out(['success' => false, 'message' => $message], $status);
}

set_exception_handler(function ($e) {
    error_log('Zenvora error: ' . $e->getMessage());
    fail('Server error. Please try again.', 500);
});

// A dedicated session name keeps Zenvora from sharing a PHPSESSID cookie with
// any other project running on http://localhost.
session_name('ZENVORASESSID');
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

try {
    $pdo = new PDO(
        'mysql:host=localhost;dbname=zenvora_db;charset=utf8mb4',
        'root',
        '',
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    error_log('Zenvora DB connection failed: ' . $e->getMessage());
    fail('Database connection failed. Is MySQL running and is zenvora_db imported?', 500);
}

function require_method($method)
{
    if ($_SERVER['REQUEST_METHOD'] !== $method) {
        header('Allow: ' . $method);
        fail('Method not allowed.', 405);
    }
}

function read_json()
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        fail('Invalid request body.', 400);
    }
    return $data;
}

function destroy_session()
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
}

// The session only stores the user id. Name, email and ROLE are always re-read
// from the database, so a role change takes effect immediately and a stale
// session can never show or grant another user's identity.
function current_user()
{
    global $pdo;
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT user_id, full_name, email, role FROM users WHERE user_id = ? LIMIT 1');
    $stmt->execute([(int) $_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user) {
        destroy_session();
        return null;
    }
    $user['user_id'] = (int) $user['user_id'];
    $user['role'] = strtolower(trim((string) $user['role']));
    return $user;
}

function require_login()
{
    $user = current_user();
    if (!$user) {
        fail('Please log in first.', 401);
    }
    return $user;
}

function require_role($roles)
{
    $user = require_login();
    if (!in_array($user['role'], $roles, true)) {
        fail('You do not have permission to do this.', 403);
    }
    return $user;
}