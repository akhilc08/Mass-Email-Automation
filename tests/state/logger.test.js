const fs = require('fs');
const path = require('path');
const os = require('os');

let Logger;
let tmpDir;
let logPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
  logPath = path.join(tmpDir, 'outreach_log.json');
  jest.resetModules();
  Logger = require('../../src/state/logger');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe('Logger', () => {
  test('creates log file on first append', () => {
    const logger = new Logger(logPath);
    logger.append({ status: 'sent', company: 'Test Co' });
    expect(fs.existsSync(logPath)).toBe(true);
  });

  test('appends entry to log', () => {
    const logger = new Logger(logPath);
    logger.append({ status: 'sent', company: 'Test Co' });
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('sent');
  });

  test('accumulates multiple entries', () => {
    const logger = new Logger(logPath);
    logger.append({ status: 'sent' });
    logger.append({ status: 'bounced' });
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(entries).toHaveLength(2);
  });

  test('reads existing log file on init', () => {
    fs.writeFileSync(logPath, JSON.stringify([{ status: 'sent' }]));
    const logger = new Logger(logPath);
    logger.append({ status: 'bounced' });
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(entries).toHaveLength(2);
  });
});
