import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DemoFaultController,
  DEMO_FAULT_CLEARED_LOG,
} from '../demoFault.ts';

describe('DemoFaultController - cleared by approved fix', () => {
  let tempDir: string;
  let logs: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalbloom-demo-fault-'));
    logs = [];
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('deletes the demo_fault file and logs "DEMO FAULT OFF: cleared by approved fix" when a simulated fix succeeds', () => {
    const faultFile = path.join(tempDir, 'demo_fault');
    fs.writeFileSync(faultFile, 'on', 'utf-8');

    const controller = new DemoFaultController({
      dataDir: tempDir,
      demoFaultFlag: false,
      logger: { info: (msg) => logs.push(msg) },
    });

    assert.equal(controller.isActive(), true);
    assert.equal(fs.existsSync(faultFile), true);

    const faultyReading = controller.applyFault({
      latency_ms: 25,
      packet_loss_pct: 0,
    });
    assert.equal(faultyReading.latency_ms, 325);
    assert.equal(faultyReading.packet_loss_pct, 20);

    // Simulated fix succeeds
    const cleared = controller.onSimulatedFixResult('succeeded');

    assert.equal(cleared, true);
    assert.equal(fs.existsSync(faultFile), false, 'demo_fault file should be deleted');
    assert.equal(controller.isActive(), false, 'demo fault should be off after fix');
    assert.deepEqual(logs, [DEMO_FAULT_CLEARED_LOG]);

    // Subsequent readings should be normal
    const normalReading = controller.applyFault({
      latency_ms: 25,
      packet_loss_pct: 0,
    });
    assert.equal(normalReading.latency_ms, 25);
    assert.equal(normalReading.packet_loss_pct, 0);
  });

  it('turns off the --demo-fault flag for the rest of the run and logs "DEMO FAULT OFF: cleared by approved fix" when a simulated fix succeeds', () => {
    const controller = new DemoFaultController({
      dataDir: tempDir,
      argv: ['node', 'agent', '--demo-fault'],
      logger: { info: (msg) => logs.push(msg) },
    });

    assert.equal(controller.isActive(), true);

    const faultyReading = controller.applyFault({
      latency_ms: 30,
      packet_loss_pct: 5,
    });
    assert.equal(faultyReading.latency_ms, 330);
    assert.equal(faultyReading.packet_loss_pct, 25);

    // Simulated fix succeeds
    const cleared = controller.onSimulatedFixResult('succeeded');

    assert.equal(cleared, true);
    assert.equal(controller.isActive(), false, '--demo-fault should stay off for the rest of the run');
    assert.equal(controller.isActive(), false, 'subsequent cycle checks remain off');
    assert.deepEqual(logs, [DEMO_FAULT_CLEARED_LOG]);

    const normalReading = controller.applyFault({
      latency_ms: 30,
      packet_loss_pct: 5,
    });
    assert.equal(normalReading.latency_ms, 30);
    assert.equal(normalReading.packet_loss_pct, 5);
  });

  it('clears both the demo_fault file and the --demo-fault flag when both are active and logs once', () => {
    const faultFile = path.join(tempDir, 'demo_fault');
    fs.writeFileSync(faultFile, '', 'utf-8');

    const controller = new DemoFaultController({
      dataDir: tempDir,
      demoFaultFlag: true,
      logger: { info: (msg) => logs.push(msg) },
    });

    assert.equal(controller.isActive(), true);

    const cleared = controller.onSimulatedFixResult('succeeded');

    assert.equal(cleared, true);
    assert.equal(fs.existsSync(faultFile), false);
    assert.equal(controller.isActive(), false);
    assert.deepEqual(logs, [DEMO_FAULT_CLEARED_LOG]);
  });

  it('does not turn off the demo fault when a simulated fix fails', () => {
    const faultFile = path.join(tempDir, 'demo_fault');
    fs.writeFileSync(faultFile, '', 'utf-8');

    const controller = new DemoFaultController({
      dataDir: tempDir,
      demoFaultFlag: true,
      logger: { info: (msg) => logs.push(msg) },
    });

    const cleared = controller.onSimulatedFixResult('failed');

    assert.equal(cleared, false);
    assert.equal(fs.existsSync(faultFile), true);
    assert.equal(controller.isActive(), true);
    assert.deepEqual(logs, []);
  });

  it('does not log when a simulated fix succeeds while the demo fault is already off', () => {
    const controller = new DemoFaultController({
      dataDir: tempDir,
      demoFaultFlag: false,
      logger: { info: (msg) => logs.push(msg) },
    });

    assert.equal(controller.isActive(), false);

    const cleared = controller.onSimulatedFixResult('succeeded');

    assert.equal(cleared, false);
    assert.equal(controller.isActive(), false);
    assert.deepEqual(logs, []);
  });
});
