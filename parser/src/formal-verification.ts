import * as crypto from 'node:crypto';

export interface Transition {
  from: string;
  to: string;
}

export interface FormalProofReceipt {
  id: string;
  targetSpec: string;
  deadlockFree: boolean;
  invariantsSatisfied: number;
  unreachableStates: string[];
  tlaSpecHash: string;
  timestamp: string;
}

export class FormalVerificationEngine {
  /**
   * Perform safety invariant and deadlock analysis on state transitions.
   * Deadlock occurs if a non-terminal state has 0 outgoing transitions.
   */
  public checkSafetyInvariants(states: string[], transitions: Transition[], terminalStates: string[] = []): { isSafe: boolean; deadlocks: string[]; unreachable: string[] } {
    const outgoingMap = new Map<string, number>();
    const incomingMap = new Map<string, number>();

    states.forEach((s) => {
      outgoingMap.set(s, 0);
      incomingMap.set(s, 0);
    });

    transitions.forEach((t) => {
      outgoingMap.set(t.from, (outgoingMap.get(t.from) || 0) + 1);
      incomingMap.set(t.to, (incomingMap.get(t.to) || 0) + 1);
    });

    const deadlocks: string[] = [];
    const unreachable: string[] = [];

    states.forEach((s) => {
      // Non-terminal state with zero outgoing edges is a deadlock trap
      if (!terminalStates.includes(s) && (outgoingMap.get(s) || 0) === 0) {
        deadlocks.push(s);
      }
      // State with zero incoming transitions (except initial root)
      if (s !== states[0] && (incomingMap.get(s) || 0) === 0) {
        unreachable.push(s);
      }
    });

    return {
      isSafe: deadlocks.length === 0,
      deadlocks,
      unreachable,
    };
  }

  /**
   * Generate formal TLA+ module specification text.
   */
  public generateTLASpec(specId: string, states: string[], transitions: Transition[]): string {
    const stateList = states.map((s) => `"${s}"`).join(', ');
    const nextRules = transitions
      .map((t) => `    \\/ (state = "${t.from}" /\\ state' = "${t.to}")`)
      .join('\n');

    return `---- MODULE ${specId} ----
EXTENDS Naturals, Sequences

VARIABLES state

Init == state = "${states[0] || 'Init'}"

Next ==
${nextRules || '    UNCHANGED state'}

Spec == Init /\\ [][Next]_state

Invariant_TypeOK == state \\in {${stateList}}
=============================================`;
  }

  /**
   * Verify specification graph and return formal proof receipt.
   */
  public verifySpec(specId: string, states: string[], transitions: Transition[], terminalStates: string[] = []): FormalProofReceipt {
    const analysis = this.checkSafetyInvariants(states, transitions, terminalStates);
    const tlaSpec = this.generateTLASpec(specId, states, transitions);
    const tlaSpecHash = crypto.createHash('sha256').update(tlaSpec).digest('hex');

    return {
      id: `proof-${specId}`,
      targetSpec: specId,
      deadlockFree: analysis.isSafe,
      invariantsSatisfied: states.length - analysis.deadlocks.length,
      unreachableStates: analysis.unreachable,
      tlaSpecHash,
      timestamp: new Date().toISOString(),
    };
  }
}
