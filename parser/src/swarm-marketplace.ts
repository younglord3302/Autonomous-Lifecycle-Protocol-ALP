export interface SkillListing {
  id: string;
  providerAgent: string;
  skillName: string;
  category: string;
  costPerCall: number;
  rating: number;
  totalInvocations: number;
  description?: string;
  registeredAt: string;
}

export interface SkillInvocationResult {
  listingId: string;
  callerAgent: string;
  providerAgent: string;
  skillName: string;
  input: string;
  output: string;
  costCharged: number;
  latencyMs: number;
  invokedAt: string;
}

export class SwarmMarketplaceEngine {
  private listings: Map<string, SkillListing> = new Map();
  private invocationLog: SkillInvocationResult[] = [];

  public registerSkill(
    id: string,
    providerAgent: string,
    skillName: string,
    category: string,
    costPerCall: number = 0.01,
    description?: string,
  ): SkillListing {
    const listing: SkillListing = {
      id,
      providerAgent,
      skillName,
      category,
      costPerCall,
      rating: 5.0,
      totalInvocations: 0,
      description,
      registeredAt: new Date().toISOString(),
    };
    this.listings.set(id, listing);
    return listing;
  }

  public discoverSkills(category?: string): SkillListing[] {
    const all = Array.from(this.listings.values());
    if (!category) return all;
    return all.filter(l => l.category === category);
  }

  public invokeSkill(
    listingId: string,
    callerAgent: string,
    input: string,
    executor?: (skillName: string, input: string) => { output: string; latencyMs?: number },
  ): SkillInvocationResult | undefined {
    const listing = this.listings.get(listingId);
    if (!listing) return undefined;

    const defaultExecutor = (skillName: string, inp: string) => ({
      output: `[${skillName}] Processed: "${inp}"`,
      latencyMs: 85,
    });

    const exec = executor || defaultExecutor;
    const res = exec(listing.skillName, input);

    listing.totalInvocations += 1;

    const result: SkillInvocationResult = {
      listingId,
      callerAgent,
      providerAgent: listing.providerAgent,
      skillName: listing.skillName,
      input,
      output: res.output,
      costCharged: listing.costPerCall,
      latencyMs: res.latencyMs ?? 85,
      invokedAt: new Date().toISOString(),
    };

    this.invocationLog.push(result);
    return result;
  }

  public rateSkill(listingId: string, newRating: number): boolean {
    const listing = this.listings.get(listingId);
    if (!listing) return false;
    listing.rating = Math.min(5.0, Math.max(0, Number(((listing.rating + newRating) / 2).toFixed(2))));
    return true;
  }

  public getInvocationLog(): SkillInvocationResult[] {
    return [...this.invocationLog];
  }

  public getListing(id: string): SkillListing | undefined {
    return this.listings.get(id);
  }
}
