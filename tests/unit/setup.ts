import { File } from 'node:buffer';
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

Object.defineProperty(globalThis, 'File', { value: File });
