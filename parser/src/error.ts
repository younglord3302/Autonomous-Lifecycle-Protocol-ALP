export class AlpError extends Error {
  public line?: number;
  public column?: number;
  
  constructor(message: string, line?: number, column?: number) {
    const loc = line ? ` at line ${line}${column ? ` column ${column}` : ''}` : '';
    super(`${message}${loc}`);
    this.name = 'AlpError';
    this.line = line;
    this.column = column;
  }
}

export class SyntaxError extends AlpError {
  constructor(message: string, line?: number, column?: number) {
    super(message, line, column);
    this.name = 'SyntaxError';
  }
}

export class IndentationError extends AlpError {
  constructor(message: string, line?: number, column?: number) {
    super(message, line, column);
    this.name = 'IndentationError';
  }
}

export class ValidationError extends AlpError {
  public details: any;
  
  constructor(message: string, details?: any, line?: number, column?: number) {
    super(message, line, column);
    this.name = 'ValidationError';
    this.details = details;
  }
}
