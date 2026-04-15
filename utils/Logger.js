const fs = require('fs');
const path = require('path');

class Logger {
  constructor() {
    this.logsDir = path.join(__dirname, '../logs');
    
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }

    this.logFile = path.join(this.logsDir, `${this.getDateString()}.log`);
    this.errorFile = path.join(this.logsDir, `${this.getDateString()}-error.log`);
    this.gameFile = path.join(this.logsDir, `${this.getDateString()}-game.log`);
  }

  getDateString() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  getCurrentTime() {
    return new Date().toISOString();
  }

  formatLog(level, message, data = null) {
    const timestamp = this.getCurrentTime();
    let log = `[${timestamp}] [${level}] ${message}`;
    if (data) {
      log += ` | ${JSON.stringify(data)}`;
    }
    return log;
  }

  log(level, message, data = null) {
    const formattedLog = this.formatLog(level, message, data);
    console.log(formattedLog);
    
    try {
      fs.appendFileSync(this.logFile, formattedLog + '\n');
    } catch (error) {
      console.error('Error writing to log file:', error);
    }
  }

  info(message, data = null) {
    this.log('INFO', message, data);
  }

  warn(message, data = null) {
    this.log('WARN', message, data);
  }

  error(message, data = null) {
    const formattedLog = this.formatLog('ERROR', message, data);
    console.error(formattedLog);
    
    try {
      fs.appendFileSync(this.logFile, formattedLog + '\n');
      fs.appendFileSync(this.errorFile, formattedLog + '\n');
    } catch (error) {
      console.error('Error writing to error log file:', error);
    }
  }

  game(message, data = null) {
    const formattedLog = this.formatLog('GAME', message, data);
    console.log(formattedLog);
    
    try {
      fs.appendFileSync(this.gameFile, formattedLog + '\n');
      fs.appendFileSync(this.logFile, formattedLog + '\n');
    } catch (error) {
      console.error('Error writing to game log file:', error);
    }
  }

  debug(message, data = null) {
    if (process.env.NODE_ENV === 'development') {
      this.log('DEBUG', message, data);
    }
  }
}

module.exports = Logger;