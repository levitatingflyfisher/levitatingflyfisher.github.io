/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const analyze: (a: number, b: number, c: number, d: number) => [number, number];
export const analyze_with_config: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
export const version: () => [number, number];
export const rust_sqlite_wasm_abort: () => void;
export const rust_sqlite_wasm_assert_fail: (a: number, b: number, c: number, d: number) => void;
export const rust_sqlite_wasm_calloc: (a: number, b: number) => number;
export const rust_sqlite_wasm_malloc: (a: number) => number;
export const rust_sqlite_wasm_free: (a: number) => void;
export const rust_sqlite_wasm_getentropy: (a: number, b: number) => number;
export const rust_sqlite_wasm_localtime: (a: number) => number;
export const rust_sqlite_wasm_realloc: (a: number, b: number) => number;
export const sqlite3_os_end: () => number;
export const sqlite3_os_init: () => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
