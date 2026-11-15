import net from "net";
import { RespParser } from "../protocol/resp/parser.js";
import { ProtocolVersion } from "../protocol/resp/types.js";
import { CommandRouter } from "./router.js";
import { logger } from "../observability/logger.js";

export class ClientConnection {
  public readonly id: string;
  private socket: net.Socket;
  private router: CommandRouter;
  private parser: RespParser = new RespParser();
  private proto: ProtocolVersion = 2;
  private onCloseCallback: () => void;
  private isDestroyed = false;

  constructor(
    id: string,
    socket: net.Socket,
    router: CommandRouter,
    onCloseCallback: () => void
  ) {
    this.id = id;
    this.socket = socket;
    this.router = router;
    this.onCloseCallback = onCloseCallback;

    this.socket.on("data", (chunk: Buffer) => this.handleData(chunk));
    this.socket.on("error", (err: Error) => this.handleError(err));
    this.socket.on("close", () => this.handleClose());
  }

  private handleData(chunk: Buffer): void {
    if (this.isDestroyed) return;

    this.parser.append(chunk);

    const responses: Buffer[] = [];
    while (true) {
      const commandArgs = this.parser.parse();
      if (!commandArgs || commandArgs.length === 0) break;

      const { response, newProto } = this.router.dispatch(commandArgs, this.proto);
      if (newProto !== undefined) {
        this.proto = newProto;
      }
      responses.push(response);
    }

    if (responses.length > 0) {
      const combined = responses.length === 1 ? responses[0] : Buffer.concat(responses);
      const canContinue = this.socket.write(combined);
      if (!canContinue) {
        this.socket.pause();
        this.socket.once("drain", () => {
          this.socket.resume();
        });
      }
    }
  }

  private handleError(err: Error): void {
    logger.debug("Client socket error", { connectionId: this.id, error: err.message });
    this.destroy();
  }

  private handleClose(): void {
    this.destroy();
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.parser.clear();
    try {
      this.socket.destroy();
    } catch {}
    this.onCloseCallback();
  }
}
