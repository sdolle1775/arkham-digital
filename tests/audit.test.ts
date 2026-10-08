import test from 'node:test';
import {auditCases} from './audit/cases.js';
for(const entry of auditCases)test('audit '+entry.id+' — '+entry.title,entry.run);
