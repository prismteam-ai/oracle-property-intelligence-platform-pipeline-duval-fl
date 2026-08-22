declare module 'parquetjs-lite' {
  export class ParquetSchema {
    constructor(schema: Record<string, { type: string; optional?: boolean; repeated?: boolean }>);
  }

  export class ParquetWriter {
    static openFile(schema: ParquetSchema, path: string): Promise<ParquetWriter>;
    static openBuffer(schema: ParquetSchema): Promise<ParquetWriter & { toBuffer(): Buffer }>;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }

  export class ParquetReader {
    static openFile(path: string): Promise<ParquetReader>;
    static openBuffer(buffer: Buffer): Promise<ParquetReader>;
    getCursor(): ParquetCursor;
    getRowCount(): number;
    close(): Promise<void>;
  }

  export class ParquetCursor {
    next(): Promise<Record<string, unknown> | null>;
  }
}
