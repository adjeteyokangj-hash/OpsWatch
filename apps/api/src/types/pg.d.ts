declare module "pg" {
  export class Client {
    constructor(config: {
      connectionString: string;
      ssl?: { rejectUnauthorized: boolean };
      connectionTimeoutMillis?: number;
      statement_timeout?: number;
    });
    connect(): Promise<void>;
    query(sql: string): Promise<{ rows: unknown[] }>;
    end(): Promise<void>;
  }
}
