import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AlpObject } from './reader';
import { ValidationError } from './error';
// @ts-ignore
import schemas from '@alp/schemas';

export class AlpValidator {
  private ajv: Ajv;
  
  constructor() {
    this.ajv = new Ajv({ strict: false });
    addFormats(this.ajv);
    
    // Pre-compile all schemas
    for (const [name, schema] of Object.entries(schemas)) {
      if (name === 'common') {
        this.ajv.addSchema(schema as any, 'common.schema.json');
      } else {
        this.ajv.addSchema(schema as any, `${name}.schema.json`);
      }
    }
  }
  
  public validate(obj: AlpObject): void {
    if (!obj.id) {
      throw new ValidationError(`Missing required field: id in @${obj._type}`);
    }
    
    const schemaId = `${obj._type}.schema.json`;
    const validate = this.ajv.getSchema(schemaId);
    
    if (!validate) {
      throw new ValidationError(`No schema found for object type: @${obj._type}`);
    }
    
    const isValid = validate(obj);
    if (!isValid) {
      const err = validate.errors?.[0];
      throw new ValidationError(
        `Validation failed for @${obj._type} '${obj.id}': ${err?.instancePath} ${err?.message}`,
        validate.errors
      );
    }
  }
}
