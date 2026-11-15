export type ProtocolVersion = 2 | 3;

export type RespType =
  | "simple_string"
  | "error"
  | "integer"
  | "bulk_string"
  | "array"
  | "null"
  | "boolean"
  | "double"
  | "blob_error"
  | "map"
  | "set";

export interface ParsedCommand {
  args: string[];
  protocol: ProtocolVersion;
  connectionId?: string;
  requestId?: string;
}

export type FsyncPolicy = "always" | "everysec" | "no";

export type EvictionPolicy = "noeviction" | "allkeys-lru" | "volatile-ttl";

export interface KeyMetadata {
  value: string;
  type: "string" | "hash" | "set";
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number | null;
}
