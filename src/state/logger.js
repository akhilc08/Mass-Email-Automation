const fs = require('fs');

class Logger {
  constructor(logPath) {
    this.logPath = logPath;
    if (fs.existsSync(logPath)) {
      try {
        this.entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
      } catch {
        console.warn(`Warning: could not parse ${logPath}, starting fresh log`);
        this.entries = [];
      }
    } else {
      this.entries = [];
    }
  }

  append(entry) {
    this.entries.push(entry);
    fs.writeFileSync(this.logPath, JSON.stringify(this.entries, null, 2));
  }
}

module.exports = Logger;
