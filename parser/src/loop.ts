/**
 * ALP Loop Engine.
 *
 * Manages the iterative improvement cycle:
 *   Understand → Plan → Implement → Test → Review → Reflect → Improve → Repeat
 *
 * This is a behavioral framework — it manages state transitions and emits events.
 * The actual work is performed by the agent that consumes ALP.
 */

export type LoopStage =
  | 'understand'
  | 'plan'
  | 'implement'
  | 'test'
  | 'review'
  | 'reflect'
  | 'improve';

export const LOOP_STAGES: LoopStage[] = [
  'understand',
  'plan',
  'implement',
  'test',
  'review',
  'reflect',
  'improve',
];

export type LoopStatus = 'idle' | 'running' | 'completed' | 'failed' | 'rolled_back';

export interface LoopConfig {
  maxIterations: number;
  completionConditions: string[];
  failureConditions?: string[];
  checkpointPerIteration?: boolean;
  rollbackStrategy?: string;
}

export interface LoopCheckpoint {
  iteration: number;
  stage: LoopStage;
  timestamp: string;
  data: Record<string, any>;
}

export interface LoopEvent {
  type: 'stage_enter' | 'stage_exit' | 'iteration_start' | 'iteration_end' | 'checkpoint' | 'completed' | 'failed';
  iteration: number;
  stage?: LoopStage;
  timestamp: string;
  data?: any;
}

export type LoopEventHandler = (event: LoopEvent) => void;

export class LoopEngine {
  private config: LoopConfig;
  private status: LoopStatus = 'idle';
  private currentIteration: number = 0;
  private currentStage: LoopStage = 'understand';
  private checkpoints: LoopCheckpoint[] = [];
  private listeners: LoopEventHandler[] = [];

  constructor(config: LoopConfig) {
    this.config = {
      checkpointPerIteration: true,
      ...config,
    };
  }

  /**
   * Subscribe to loop events.
   */
  public on(handler: LoopEventHandler): void {
    this.listeners.push(handler);
  }

  /**
   * Run the loop. Calls the provided `executeStage` function for each stage.
   * The function receives the stage name and iteration number, and should
   * return `true` if all completion conditions are met (ending the loop).
   */
  public async run(
    executeStage: (stage: LoopStage, iteration: number) => Promise<boolean>
  ): Promise<{ status: LoopStatus; iterations: number }> {
    this.status = 'running';
    this.currentIteration = 0;

    while (this.currentIteration < this.config.maxIterations) {
      this.currentIteration++;
      this.emit({
        type: 'iteration_start',
        iteration: this.currentIteration,
        timestamp: new Date().toISOString(),
      });

      let completed = false;

      for (const stage of LOOP_STAGES) {
        this.currentStage = stage;

        this.emit({
          type: 'stage_enter',
          iteration: this.currentIteration,
          stage,
          timestamp: new Date().toISOString(),
        });

        try {
          completed = await executeStage(stage, this.currentIteration);
        } catch (err: any) {
          this.status = 'failed';
          this.emit({
            type: 'failed',
            iteration: this.currentIteration,
            stage,
            timestamp: new Date().toISOString(),
            data: { error: err.message },
          });

          if (this.config.rollbackStrategy && this.checkpoints.length > 0) {
            this.status = 'rolled_back';
          }

          return { status: this.status, iterations: this.currentIteration };
        }

        this.emit({
          type: 'stage_exit',
          iteration: this.currentIteration,
          stage,
          timestamp: new Date().toISOString(),
        });

        if (completed) break;
      }

      // Checkpoint after each iteration
      if (this.config.checkpointPerIteration) {
        const checkpoint: LoopCheckpoint = {
          iteration: this.currentIteration,
          stage: this.currentStage,
          timestamp: new Date().toISOString(),
          data: {},
        };
        this.checkpoints.push(checkpoint);
        this.emit({
          type: 'checkpoint',
          iteration: this.currentIteration,
          timestamp: checkpoint.timestamp,
          data: checkpoint,
        });
      }

      this.emit({
        type: 'iteration_end',
        iteration: this.currentIteration,
        timestamp: new Date().toISOString(),
      });

      if (completed) {
        this.status = 'completed';
        this.emit({
          type: 'completed',
          iteration: this.currentIteration,
          timestamp: new Date().toISOString(),
        });
        return { status: this.status, iterations: this.currentIteration };
      }
    }

    // Max iterations reached
    this.status = 'failed';
    this.emit({
      type: 'failed',
      iteration: this.currentIteration,
      timestamp: new Date().toISOString(),
      data: { reason: 'Max iterations reached' },
    });

    return { status: this.status, iterations: this.currentIteration };
  }

  /**
   * Get the last checkpoint.
   */
  public getLastCheckpoint(): LoopCheckpoint | undefined {
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /**
   * Get current engine state.
   */
  public getState(): {
    status: LoopStatus;
    iteration: number;
    stage: LoopStage;
    checkpoints: number;
  } {
    return {
      status: this.status,
      iteration: this.currentIteration,
      stage: this.currentStage,
      checkpoints: this.checkpoints.length,
    };
  }

  private emit(event: LoopEvent): void {
    for (const handler of this.listeners) {
      handler(event);
    }
  }
}
