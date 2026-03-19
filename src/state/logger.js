const fs = require('fs');

class Logger {
  constructor(logPath) {
    this.logPath = logPath;
    if (fs.existsSync(logPath)) {
      this.entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
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
