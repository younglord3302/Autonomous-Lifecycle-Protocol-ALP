export interface MonolithAnalysis {
  targetPath: string;
  totalFiles: number;
  couplingScore: number; // 0.0 (decoupled) to 1.0 (tightly coupled)
  modules: Record<string, string[]>;
}

export interface MicroservicePlan {
  id: string;
  monolithTarget: string;
  proposedServices: string[];
  serviceBoundaries: Record<string, string[]>;
  couplingScore: number;
  createdAt: string;
}

export class ArchDecomposerEngine {
  /**
   * Analyze monolith directory structure and dependency files into domain modules.
   */
  public analyzeMonolith(targetPath: string, filePaths: string[]): MonolithAnalysis {
    const modules: Record<string, string[]> = {
      auth: [],
      billing: [],
      notifications: [],
      core: [],
    };

    filePaths.forEach((file) => {
      if (file.includes('auth') || file.includes('user') || file.includes('token')) {
        modules.auth.push(file);
      } else if (file.includes('pay') || file.includes('stripe') || file.includes('billing')) {
        modules.billing.push(file);
      } else if (file.includes('email') || file.includes('push') || file.includes('notify')) {
        modules.notifications.push(file);
      } else {
        modules.core.push(file);
      }
    });

    const nonCoreCount = modules.auth.length + modules.billing.length + modules.notifications.length;
    const couplingScore = Math.max(0.1, Math.min(0.95, Number((1 - nonCoreCount / Math.max(1, filePaths.length)).toFixed(2))));

    return {
      targetPath,
      totalFiles: filePaths.length,
      couplingScore,
      modules,
    };
  }

  /**
   * Decompose MonolithAnalysis into discrete ALP `@package` microservices.
   */
  public decompose(analysis: MonolithAnalysis): MicroservicePlan {
    const proposedServices: string[] = [];
    const serviceBoundaries: Record<string, string[]> = {};

    Object.entries(analysis.modules).forEach(([modName, files]) => {
      if (files.length > 0) {
        const serviceName = `service-${modName}`;
        proposedServices.push(serviceName);
        serviceBoundaries[serviceName] = files;
      }
    });

    return {
      id: `refactor-${analysis.targetPath.replace(/[^a-zA-Z0-9]/g, '-')}`,
      monolithTarget: analysis.targetPath,
      proposedServices,
      serviceBoundaries,
      couplingScore: analysis.couplingScore,
      createdAt: new Date().toISOString(),
    };
  }
}
