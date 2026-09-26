import { requireThat, DomainError } from "./store.js";

/** Native Google Ads REST adapter. OAuth Cloud-project access (v25).
 * No legacy developer-token requirement, retries, arbitrary GAQL or caller URL.
 */
export class GoogleAdsClient {
  lastRequestId: string | null = null;
  constructor(
    private token: () => Promise<string>,
    private loginCustomerId?: string,
    private fetcher: typeof fetch = fetch,
  ) {
    requireThat(
      !loginCustomerId || /^\d+$/.test(loginCustomerId),
      "invalid_manager_account",
    );
  }
  async request(path: string, body?: unknown): Promise<any> {
    requireThat(
      /^customers(?:\/[0-9]+(?:\/[a-zA-Z]+(?::[a-zA-Z]+)?)?|:listAccessibleCustomers)$/.test(
        path,
      ),
      "invalid_google_path",
    );
    const response = await this.fetcher(
      `https://googleads.googleapis.com/v25/${path}`,
      {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          authorization: `Bearer ${await this.token()}`,
          "content-type": "application/json",
          ...(this.loginCustomerId
            ? { "login-customer-id": this.loginCustomerId }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    if (!response.ok)
      throw new DomainError(
        response.status === 401 || response.status === 403
          ? "google_authorization_required"
          : "google_request_failed",
        502,
      );
    this.lastRequestId = response.headers.get("request-id");
    return response.json();
  }
  listAccounts() {
    return this.request("customers:listAccessibleCustomers");
  }
  async search(account: string, query: string): Promise<any[]> {
    requireThat(/^\d+$/.test(account), "invalid_google_account");
    const rows = await this.request(
      `customers/${account}/googleAds:searchStream`,
      { query },
    );
    requireThat(Array.isArray(rows), "invalid_google_response");
    return rows.flatMap((r: any) => r.results || []);
  }
  async verify(account: string) {
    const rows = await this.search(
      account,
      "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status, customer.manager, customer.test_account FROM customer LIMIT 1",
    );
    const customer = rows[0]?.customer;
    requireThat(
      customer &&
        String(customer.id) === account &&
        customer.status === "ENABLED" &&
        !customer.manager,
      "google_account_unavailable",
    );
    return customer;
  }
  mutate(account: string, operations: unknown[], validateOnly = false) {
    return this.request(`customers/${account}/googleAds:mutate`, {
      mutateOperations: operations,
      partialFailure: false,
      validateOnly,
      responseContentType: "RESOURCE_NAME_ONLY",
    });
  }
}
