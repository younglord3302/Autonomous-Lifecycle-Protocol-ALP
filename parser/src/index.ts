import { AlpReader, AlpObject } from './reader';
import { AlpValidator } from './validator';
export * from './error';
export * from './graph';
export * from './loop';
export * from './memory';
export * from './lock-manager';
export * from './policy';
export * from './state-store';
export * from './swarm-client';
export * from './repo-resolver';
export { AlpObject, AlpReader };

export class AlpParser {
  private reader: AlpReader;
  private validator: AlpValidator;
  
  constructor() {
    this.reader = new AlpReader();
    this.validator = new AlpValidator();
  }
  
  /**
   * Parse raw .alp content into objects (no validation).
   */
  public parse(content: string): AlpObject[] {
    return this.reader.parse(content);
  }

  /**
   * Non-fatal notices (e.g. `!deprecated`) from the most recent parse.
   */
  public get warnings(): string[] {
    return this.reader.warnings;
  }

  /**
   * Parse and validate .alp content against JSON schemas.
   */
  public parseAndValidate(content: string): AlpObject[] {
    const objects = this.reader.parse(content);
    
    for (const obj of objects) {
      this.validator.validate(obj);
    }
    
    return objects;
  }
}
