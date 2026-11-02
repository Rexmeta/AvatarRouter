type OperatorUser = {
  id: string;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[];
  banned: boolean;
  locked: boolean;
};
type Lookup = (email: string) => Promise<{ totalCount: number; data: OperatorUser[] }>;

/** Resolve an owner-configured email using this runtime's own Clerk tenant.
 * No user creation, metadata changes, browser-controlled role grants or DB writes.
 */
export class LiveOperatorBootstrap {
  private ids = new Set<string>();
  private readonly emails: string[];
  constructor(configured: string | undefined, private readonly environment: string | undefined) {
    const entries = (configured ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    // Reject the entire configuration if malformed; never partially interpret a wildcard.
    this.emails = entries.length <= 10 && entries.every(email => /^[^\s@*,]+@[^\s@*,]+\.[^\s@*,]+$/.test(email))
      ? [...new Set(entries)] : [];
  }

  async resolve(lookup: Lookup, timeoutMs = 8000) {
    this.ids.clear();
    if (this.environment !== "production" || !this.emails.length) {
      return { configuredCount: this.emails.length, resolvedCount: 0 };
    }
    const ids = await Promise.all(this.emails.map(async email => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          lookup(email),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Operator lookup timeout")), timeoutMs);
          }),
        ]);
        if (result.totalCount !== 1 || result.data.length !== 1) return null;
        const user = result.data[0]!;
        if (user.banned || user.locked || !/^user_[A-Za-z0-9]+$/.test(user.id)) return null;
        const primary = user.emailAddresses.find(address => address.id === user.primaryEmailAddressId);
        return primary?.verification?.status === "verified" &&
          primary.emailAddress.trim().toLowerCase() === email ? user.id : null;
      } catch {
        // Lookup failures never grant privileges or expose upstream auth errors.
        return null;
      } finally { clearTimeout(timer); }
    }));
    this.ids = new Set(ids.filter((id): id is string => id !== null));
    return { configuredCount: this.emails.length, resolvedCount: this.ids.size };
  }

  has(userId: string) {
    return this.environment === "production" && this.ids.has(userId);
  }
}

export const liveOperatorBootstrap = new LiveOperatorBootstrap(
  process.env.LIVE_SESSION_OPERATOR_BOOTSTRAP_EMAILS, process.env.NODE_ENV,
);
