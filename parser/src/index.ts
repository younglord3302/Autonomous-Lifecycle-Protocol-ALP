import { AlpReader, AlpObject } from './reader';
import { AlpValidator } from './validator';
export * from './error';
export * from './graph';
export * from './loop';
export * from './memory';
export * from './lock-manager';
export * from './policy';
export * from './plugin';
export * from './alpel';
export * from './remote';
export * from './state-store';
export * from './debug';
export * from './swarm-client';
export * from './repo-resolver';
export * from './status';
export * from './schedule';
export * from './contract';
export * from './formal';
export * from './vault';
export * from './event-store';
export * from './visualize';
export * from './anomaly';
export * from './planner';
export * from './negotiate';
export * from './provenance';
export * from './autonomy';
export * from './crdt';
export * from './author';
export * from './migration';
export * from './cost-optimizer';
export * from './bridge';
export * from './identity';
export * from './p2p';
export * from './healing';
export * from './resilience';
export * from './tenant';
export * from './governance';
export * from './domain_trust';
export * from './telemetry';
export * from './zk-proof';
export * from './vector-store';
export * from './did-identity';
export * from './crdt-sync';
export * from './self-healing';
export * from './formal-verification';
export * from './asset-context';
export * from './cost-budget';
export * from './sandbox-env';
export * from './tenant-mesh';
export * from './arch-decomposer';
export * from './edge-model';
export * from './code-index';
export * from './eval-suite';
export * from './prompt-optimizer';
export * from './consensus-vote';
export * from './code-transform';
export * from './event-mesh';
export * from './swarm-marketplace';
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
