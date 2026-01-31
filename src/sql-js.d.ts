declare module 'sql.js' {
  interface Database {
    run(sql: string, params?: any[]): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    free(): boolean;
    reset(): void;
  }

  interface SqlJsStatic {
    Database: new () => Database;
  }

  export interface Database {
    run(sql: string, params?: any[]): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface Statement {
    bind(params?: any[]): boolean;
    step(): boolean;
    free(): boolean;
    reset(): void;
  }

  export default function initSqlJs(config?: any): Promise<SqlJsStatic>;
}
