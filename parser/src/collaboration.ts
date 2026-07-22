/**
 * ALP CollaborationEngine — Real-time multiplayer conflict resolution (v37.0.0).
 *
 * Provides session-based multi-agent concurrent editing of `.alp` documents
 * with LWW conflict resolution, presence tracking, operation logging,
 * and branch/merge with three-way conflict detection.
 */

export type OperationType = 'insert' | 'update' | 'delete';

export interface CollabOperation {
  id: string;
  docId: string;
  type: OperationType;
  path: string;
  value?: any;
  previousValue?: any;
  agentId: string;
  timestamp: number;
  vectorClock: Record<string, number>;
}

export interface PresenceInfo {
  agentId: string;
  cursor?: string;
  lastSeen: number;
  color: string;
  status: 'active' | 'idle' | 'disconnected';
}

export interface CollabSession {
  docId: string;
  createdAt: number;
  agents: Map<string, PresenceInfo>;
  operations: CollabOperation[];
  state: Record<string, any>;
  branches: Map<string, CollabBranch>;
}

export interface CollabBranch {
  branchId: string;
  sourceDocId: string;
  forkedAt: number;
  forkedFromOp: number;
  state: Record<string, any>;
  operations: CollabOperation[];
}

export interface MergeResult {
  merged: Record<string, any>;
  conflicts: ConflictMarker[];
  operationsApplied: number;
}

export interface ConflictMarker {
  path: string;
  localValue: any;
  remoteValue: any;
  resolution: 'local_wins' | 'remote_wins' | 'unresolved';
}

const AGENT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8C471', '#82E0AA',
];

let opCounter = 0;

export class CollaborationEngine {
  private sessions: Map<string, CollabSession> = new Map();

  /**
   * Create a new collaboration session for a document.
   */
  createSession(docId: string, initialState?: Record<string, any>): CollabSession {
    if (this.sessions.has(docId)) {
      return this.sessions.get(docId)!;
    }
    const session: CollabSession = {
      docId,
      createdAt: Date.now(),
      agents: new Map(),
      operations: [],
      state: initialState ? { ...initialState } : {},
      branches: new Map(),
    };
    this.sessions.set(docId, session);
    return session;
  }

  /**
   * Join an existing session.
   */
  joinSession(docId: string, agentId: string): PresenceInfo | null {
    const session = this.sessions.get(docId);
    if (!session) return null;

    const colorIdx = session.agents.size % AGENT_COLORS.length;
    const presence: PresenceInfo = {
      agentId,
      lastSeen: Date.now(),
      color: AGENT_COLORS[colorIdx],
      status: 'active',
    };
    session.agents.set(agentId, presence);
    return presence;
  }

  /**
   * Leave a session.
   */
  leaveSession(docId: string, agentId: string): boolean {
    const session = this.sessions.get(docId);
    if (!session) return false;
    const presence = session.agents.get(agentId);
    if (presence) {
      presence.status = 'disconnected';
      presence.lastSeen = Date.now();
    }
    return session.agents.delete(agentId);
  }

  /**
   * Get all agents present in a session.
   */
  getPresence(docId: string): PresenceInfo[] {
    const session = this.sessions.get(docId);
    if (!session) return [];
    return Array.from(session.agents.values());
  }

  /**
   * Apply an operation to a document with LWW conflict resolution.
   */
  applyOperation(
    docId: string,
    type: OperationType,
    path: string,
    agentId: string,
    value?: any
  ): CollabOperation | null {
    const session = this.sessions.get(docId);
    if (!session) return null;

    // Update vector clock
    const clock: Record<string, number> = {};
    for (const op of session.operations) {
      for (const [agent, tick] of Object.entries(op.vectorClock)) {
        clock[agent] = Math.max(clock[agent] || 0, tick);
      }
    }
    clock[agentId] = (clock[agentId] || 0) + 1;

    const previousValue = session.state[path];

    const op: CollabOperation = {
      id: `op-${++opCounter}`,
      docId,
      type,
      path,
      value,
      previousValue,
      agentId,
      timestamp: Date.now(),
      vectorClock: { ...clock },
    };

    // Apply to state
    switch (type) {
      case 'insert':
      case 'update':
        session.state[path] = value;
        break;
      case 'delete':
        delete session.state[path];
        break;
    }

    session.operations.push(op);

    // Update agent presence
    const presence = session.agents.get(agentId);
    if (presence) {
      presence.lastSeen = Date.now();
      presence.cursor = path;
      presence.status = 'active';
    }

    return op;
  }

  /**
   * Get the operation log for a session.
   */
  getOperationLog(docId: string): CollabOperation[] {
    const session = this.sessions.get(docId);
    return session ? [...session.operations] : [];
  }

  /**
   * Get the current converged document snapshot.
   */
  getSnapshot(docId: string): Record<string, any> {
    const session = this.sessions.get(docId);
    return session ? { ...session.state } : {};
  }

  /**
   * Fork a branch from the current document state.
   */
  fork(docId: string, branchId: string): CollabBranch | null {
    const session = this.sessions.get(docId);
    if (!session) return null;

    const branch: CollabBranch = {
      branchId,
      sourceDocId: docId,
      forkedAt: Date.now(),
      forkedFromOp: session.operations.length,
      state: { ...session.state },
      operations: [],
    };
    session.branches.set(branchId, branch);
    return branch;
  }

  /**
   * Three-way merge a branch back into the main document.
   * Uses LWW for conflicting scalar edits.
   */
  mergeBranch(docId: string, branchId: string): MergeResult | null {
    const session = this.sessions.get(docId);
    if (!session) return null;

    const branch = session.branches.get(branchId);
    if (!branch) return null;

    const conflicts: ConflictMarker[] = [];
    const merged = { ...session.state };
    let opsApplied = 0;

    // Detect keys modified in both main and branch since fork
    const mainOpsAfterFork = session.operations.slice(branch.forkedFromOp);
    const mainModifiedPaths = new Set(mainOpsAfterFork.map(op => op.path));

    for (const [path, branchValue] of Object.entries(branch.state)) {
      if (mainModifiedPaths.has(path) && merged[path] !== branchValue) {
        // Conflict: both main and branch modified this path
        const mainValue = merged[path];
        // LWW: branch wins if it was edited more recently
        const branchOp = branch.operations.filter(o => o.path === path).pop();
        const mainOp = mainOpsAfterFork.filter(o => o.path === path).pop();

        const branchTs = branchOp?.timestamp ?? branch.forkedAt;
        const mainTs = mainOp?.timestamp ?? 0;

        if (branchTs >= mainTs) {
          merged[path] = branchValue;
          conflicts.push({ path, localValue: mainValue, remoteValue: branchValue, resolution: 'remote_wins' });
        } else {
          conflicts.push({ path, localValue: mainValue, remoteValue: branchValue, resolution: 'local_wins' });
        }
      } else {
        merged[path] = branchValue;
      }
      opsApplied++;
    }

    // Handle deletions in branch
    for (const key of Object.keys(session.state)) {
      if (!(key in branch.state) && !mainModifiedPaths.has(key)) {
        delete merged[key];
        opsApplied++;
      }
    }

    session.state = merged;
    session.branches.delete(branchId);

    return { merged: { ...merged }, conflicts, operationsApplied: opsApplied };
  }

  /**
   * Get a session by document ID.
   */
  getSession(docId: string): CollabSession | undefined {
    return this.sessions.get(docId);
  }
}
