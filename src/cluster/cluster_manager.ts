/**
 * Redis Cluster Manager
 * Handles slot allocation, node topology, CLUSTER commands, and -MOVED redirection.
 */

import { keyToSlot, TOTAL_HASH_SLOTS } from "./hash_slot.js";

export interface ClusterNodeInfo {
  id: string;
  ip: string;
  port: number;
  cport: number;
  flags: string[];
  masterId: string;
  startSlot: number;
  endSlot: number;
}

export class ClusterManager {
  private nodeId: string;
  private ip: string;
  private port: number;
  private localSlotsStart: number;
  private localSlotsEnd: number;
  private peers: ClusterNodeInfo[] = [];

  constructor(options?: {
    nodeId?: string;
    ip?: string;
    port?: number;
    startSlot?: number;
    endSlot?: number;
  }) {
    this.nodeId = options?.nodeId || "e761962f1f57b3cd1991911059109527795930c6";
    this.ip = options?.ip || "127.0.0.1";
    this.port = options?.port || 6379;
    this.localSlotsStart = options?.startSlot !== undefined ? options.startSlot : 0;
    this.localSlotsEnd = options?.endSlot !== undefined ? options.endSlot : TOTAL_HASH_SLOTS - 1;
  }

  public getNodeId(): string {
    return this.nodeId;
  }

  public isSlotLocal(slot: number): boolean {
    return slot >= this.localSlotsStart && slot <= this.localSlotsEnd;
  }

  public checkKeyAccess(key: string): { allowed: boolean; redirection?: string; slot: number } {
    const slot = keyToSlot(key);
    if (this.isSlotLocal(slot)) {
      return { allowed: true, slot };
    }

    // Find peer serving this slot
    const peer = this.peers.find(p => slot >= p.startSlot && slot <= p.endSlot);
    const targetIp = peer ? peer.ip : "127.0.0.1";
    const targetPort = peer ? peer.port : 6380;
    return {
      allowed: false,
      slot,
      redirection: `-MOVED ${slot} ${targetIp}:${targetPort}\r\n`,
    };
  }

  public addPeer(peer: ClusterNodeInfo): void {
    this.peers.push(peer);
  }

  public getClusterInfo(): string {
    return [
      "cluster_state:ok",
      `cluster_slots_assigned:${TOTAL_HASH_SLOTS}`,
      `cluster_slots_ok:${TOTAL_HASH_SLOTS}`,
      "cluster_slots_pfail:0",
      "cluster_slots_fail:0",
      `cluster_known_nodes:${this.peers.length + 1}`,
      `cluster_size:${this.peers.length + 1}`,
      "cluster_current_epoch:1",
      "cluster_my_epoch:1",
      "cluster_stats_messages_ping_sent:1",
      "cluster_stats_messages_pong_received:1",
      "cluster_stats_messages_sent:2",
      "cluster_stats_messages_received:1\r\n",
    ].join("\r\n");
  }

  public getClusterNodes(): string {
    const selfLine = `${this.nodeId} ${this.ip}:${this.port}@${this.port + 10000} myself,master - 0 0 1 connected ${this.localSlotsStart}-${this.localSlotsEnd}`;
    const peerLines = this.peers.map(p => {
      const flags = p.flags.join(",");
      return `${p.id} ${p.ip}:${p.port}@${p.cport} ${flags} ${p.masterId} 0 0 1 connected ${p.startSlot}-${p.endSlot}`;
    });

    return [selfLine, ...peerLines].join("\n") + "\n";
  }

  public getClusterSlots(): any[] {
    const selfSlots = [
      this.localSlotsStart,
      this.localSlotsEnd,
      [this.ip, this.port, this.nodeId],
    ];

    const peerSlots = this.peers.map(p => [
      p.startSlot,
      p.endSlot,
      [p.ip, p.port, p.id],
    ]);

    return [selfSlots, ...peerSlots];
  }
}
