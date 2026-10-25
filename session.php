<?php
require __DIR__ . '/db.php';
require_method('GET');

// Returns the user stored in the PHP session (fresh from the database), or null.
json_out(['success' => true, 'user' => current_user()]);