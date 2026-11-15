# Redis Serialization Protocol (RESP) Conformance: mini-redis

## 1. Supported Wire Protocols

`mini-redis` implements full wire compatibility for **RESP2** (default) and protocol negotiation up to **RESP3** via the `HELLO` handshake.

---

## 2. RESP2 Data Types & Wire Format

| Data Type | Byte Prefix | Wire Representation | Example |
|---|---|---|---|
| **Simple String** | `+` | `+<string>\r\n` | `+OK\r\n` |
| **Simple Error** | `-` | `-<error_message>\r\n` | `-ERR unknown command\r\n` |
| **Integer** | `:` | `:[<+|->]<value>\r\n` | `:1000\r\n` |
| **Bulk String** | `$` | `$<length>\r\n<data>\r\n` | `$6\r\nfoobar\r\n` |
| **Null Bulk String** | `$` | `$-1\r\n` | `$-1\r\n` |
| **Array** | `*` | `*<count>\r\n<elements...>` | `*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n` |
| **Null Array** | `*` | `*-1\r\n` | `*-1\r\n` |

---

## 3. Advanced Capabilities

### 3.1 Inline Commands
For human terminal sessions using `telnet` or `nc`, commands can be submitted as space-separated plaintext terminated by `\r\n`:
```text
PING\r\n
+PONG\r\n

SET counter 42\r\n
+OK\r\n

GET counter\r\n
$2\r\n42\r\n
```

### 3.2 Command Pipelining
Clients can send multiple commands in a single TCP socket write without waiting for intermediate responses. `mini-redis` parses every command in the stream sequentially and returns concatenated responses in exact order:
```text
Client -> *3\r\n$3\r\nSET\r\n$1\r\na\r\n$1\r\n1\r\n*2\r\n$4\r\nINCR\r\n$1\r\na\r\n*2\r\n$3\r\nGET\r\n$1\r\na\r\n
Server <- +OK\r\n:2\r\n$1\r\n2\r\n
```

### 3.3 Partial TCP Framing & Boundary Handling
The socket layer maintains an unconsumed byte buffer. When network MTU splits a bulk string or array across packets, the parser holds the partial state until the terminating CRLF arrives, preventing malformed command errors.

### 3.4 Error Codes
Error messages replicate official Redis strings:
- `-ERR wrong number of arguments for 'X' command\r\n`
- `-ERR unknown command \`X\`\r\n`
- `-ERR value is not an integer or out of range\r\n`
- `-ERR syntax error\r\n`
- `-ERR OOM command not allowed when used memory > 'maxmemory'\r\n`
- `-ERR no such key\r\n`

---

## 4. RESP3 Handshake (`HELLO`)

Clients switch to RESP3 using `HELLO 3`. `mini-redis` responds with server capabilities serialized as a RESP3 map (`%`):
```text
Client -> HELLO 3
Server <- %5\r\n$6\r\nserver\r\n$10\r\nmini-redis\r\n$7\r\nversion\r\n$5\r\n2.0.0\r\n$5\r\nproto\r\n$1\r\n3\r\n$4\r\nmode\r\n$10\r\nstandalone\r\n$4\r\nrole\r\n$6\r\nmaster\r\n
```
Under RESP3, null values serialize as `_\r\n`, booleans as `#t\r\n` or `#f\r\n`, sets as `~<len>\r\n`, and maps as `%<len>\r\n`.
