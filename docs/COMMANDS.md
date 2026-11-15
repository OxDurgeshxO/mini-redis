# Command Reference: mini-redis

## 1. Strings

### `SET key value [EX seconds] [PX milliseconds] [NX | XX] [GET]`
Sets key to hold string value.
- `EX`: Set expiration time in seconds.
- `PX`: Set expiration time in milliseconds.
- `NX`: Only set the key if it does not already exist.
- `XX`: Only set the key if it already exists.
- `GET`: Return the old string stored at key, or nil if key did not exist.

### `GET key`
Get the value of key. Returns `nil` (`$-1\r\n`) if key does not exist.

### `DEL key [key ...]`
Removes the specified keys. Returns integer count of removed keys.

### `INCR key` / `DECR key`
Increments or decrements the number stored at key by one. Returns integer result.

### `APPEND key value`
Appends value to key. If key does not exist, it is created. Returns total length.

### `STRLEN key`
Returns the byte length of the string value stored at key.

---

## 2. Keys & TTL

### `EXISTS key [key ...]`
Returns the number of specified keys that exist in the database.

### `EXPIRE key seconds`
Sets a timeout on key in seconds. Returns `1` if timeout was set, `0` if key does not exist.

### `TTL key`
Returns remaining time to live in seconds:
- Remaining seconds if key has an expiration.
- `-1` if key exists but has no associated expire.
- `-2` if key does not exist.

### `PERSIST key`
Removes the existing timeout on key. Returns `1` if timeout was removed, `0` otherwise.

### `KEYS pattern`
Returns all keys matching pattern (glob-style, e.g. `*`, `user:*`).

### `TYPE key`
Returns string representation of the type of the value: `string`, `hash`, `set`, or `none`.

### `RENAME oldkey newkey`
Renames `oldkey` to `newkey`. Returns `+OK` or error if `oldkey` does not exist.

---

## 3. Server & Operations

### `PING [message]`
Returns `+PONG` or returns `message` if provided.

### `ECHO message`
Returns `message`.

### `INFO [section]`
Returns server metadata, connected client count, memory statistics, and command counters.

### `COMMAND`
Returns array of supported commands.

### `FLUSHDB`
Flushes and deletes all keys in the current database.

### `DBSIZE`
Returns the total number of keys currently in the database.

### `CONFIG GET parameter` / `CONFIG SET parameter value`
Reads or alters runtime configurations (`maxmemory`, `maxmemory-policy`).

### `CLIENT LIST`
Returns list of connected clients and connection telemetry.

---

## 4. Persistence

### `SAVE`
Synchronously writes an RDB point-in-time snapshot to disk (`dump.rdb`) with SHA-256 verification.

### `BGSAVE`
Asynchronously initiates an RDB snapshot in the background.

### `BGREWRITEAOF`
Compacts the Append-Only File into a minimal representation of current database state.
