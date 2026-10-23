import fs from 'fs';
import path from 'path';

export interface DemoFaultLogger {
  info: (message: string) => void;
}

export interface DemoFaultOptions {
  dataDir?: string;
  demoFaultFlag?: boolean;
  argv?: string[];
  logger?: DemoFaultLogger;
}

export interface ReadingSample {
  latency_ms?: number;
  packet_loss_pct?: number;
  latencyMs?: number;
  packetLossPct?: number;
  [key: string]: unknown;
}

export const DEMO_FAULT_CLEARED_LOG = 'DEMO FAULT OFF: cleared by approved fix';

/**
 * Manages the demo fault state controlled by either:
 * 1. The `demo_fault` file inside `dataDir`
 * 2. The `--demo-fault` command-line flag
 */
export class DemoFaultController {
  private readonly dataDir: string;
  private flagActive: boolean;
  private wasActive: boolean;
  private readonly logger: DemoFaultLogger;

  constructor(options: DemoFaultOptions = {}) {
    this.dataDir =
      options.dataDir ??
      process.env.SIGNALBLOOM_DATA_DIR ??
      path.resolve(process.cwd(), 'data');

    if (typeof options.demoFaultFlag === 'boolean') {
      this.flagActive = options.demoFaultFlag;
    } else {
      const args = options.argv ?? process.argv;
      this.flagActive = args.includes('--demo-fault');
    }

    this.logger = options.logger ?? {
      info: (msg: string) => console.log(msg),
    };

    this.wasActive = this.flagActive || this.hasFaultFile();
  }

  public get faultFilePath(): string {
    return path.join(this.dataDir, 'demo_fault');
  }

  public hasFaultFile(): boolean {
    try {
      return fs.existsSync(this.faultFilePath);
    } catch {
      return false;
    }
  }

  /**
   * Checks whether the demo fault is currently active (via `--demo-fault` flag or `demo_fault` file)
   * and logs transitions between on and off states.
   */
  public isActive(): boolean {
    const filePresent = this.hasFaultFile();
    const current = this.flagActive || filePresent;

    if (current && !this.wasActive) {
      this.logger.info('DEMO FAULT ON');
    } else if (!current && this.wasActive) {
      this.logger.info('DEMO FAULT OFF');
    }

    this.wasActive = current;
    return current;
  }

  /**
   * Applies the demo fault (+300 ms latency, +20% packet loss capped at 100%)
   * to a copy of the reading when the fault is active.
   */
  public applyFault<T extends ReadingSample>(reading: T): T {
    if (!this.isActive()) {
      return { ...reading };
    }

    const copy: T = { ...reading };

    if (typeof copy.latency_ms === 'number') {
      copy.latency_ms = copy.latency_ms + 300;
    }
    if (typeof copy.packet_loss_pct === 'number') {
      copy.packet_loss_pct = Math.min(100, copy.packet_loss_pct + 20);
    }
    if (typeof copy.latencyMs === 'number') {
      copy.latencyMs = copy.latencyMs + 300;
    }
    if (typeof copy.packetLossPct === 'number') {
      copy.packetLossPct = Math.min(100, copy.packetLossPct + 20);
    }

    return copy;
  }

  /**
   * Called when a simulated fix finishes.
   * When a simulated fix succeeds while the demo fault is active:
   * - If started by the `demo_fault` file, deletes the file.
   * - If started with the `--demo-fault` flag, turns it off for the rest of the run too.
   * - Logs "DEMO FAULT OFF: cleared by approved fix".
   */
  public onSimulatedFixResult(status: 'succeeded' | 'failed'): boolean {
    if (status !== 'succeeded') {
      return false;
    }
    return this.clearOnApprovedFix();
  }

  public clearOnApprovedFix(): boolean {
    const filePresent = this.hasFaultFile();
    const currentlyActive = this.flagActive || filePresent || this.wasActive;

    if (!currentlyActive) {
      return false;
    }

    if (filePresent) {
      try {
        fs.unlinkSync(this.faultFilePath);
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          throw err;
        }
      }
    }

    if (this.flagActive) {
      this.flagActive = false;
    }

    this.wasActive = false;
    this.logger.info(DEMO_FAULT_CLEARED_LOG);
    return true;
  }
}

export const defaultDemoFaultController = new DemoFaultController();
