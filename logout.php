<?php
require __DIR__ . '/db.php';

destroy_session();

json_out(['success' => true, 'message' => 'Logged out successfully.']);