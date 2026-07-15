import type { LanguageInput } from 'shiki';

export const alp: LanguageInput = {
  name: 'alp',
  scopeName: 'source.alp',
  patterns: [
    { include: '#comment' },
    { include: '#directive' },
    { include: '#object' },
    { include: '#reference' },
    { include: '#string' },
    { include: '#status' },
    { include: '#key' },
  ],
  repository: {
    comment: {
      name: 'comment.line.number-sign.alp',
      match: '#[^\\n]*$',
    },
    directive: {
      name: 'keyword.control.directive.alp',
      match: '^\\s*![A-Za-z][\\w-]*',
    },
    object: {
      name: 'entity.name.type.object.alp',
      match: '^\\s*@[A-Za-z][\\w-]*',
    },
    reference: {
      name: 'string.other.reference.alp',
      match: '->\\s*[\\w./:-]+',
    },
    string: {
      name: 'string.quoted.double.alp',
      match: '"[^"\\n]*"',
    },
    status: {
      name: 'constant.other.status.alp',
      match: '\\[[ x~!?-]\\]',
    },
    key: {
      name: 'variable.other.key.alp',
      match: '^\\s*[A-Za-z_][\\w-]*\\s*:',
    },
  },
};

export const ebnf: LanguageInput = {
  name: 'ebnf',
  scopeName: 'source.ebnf',
  patterns: [
    { include: '#comment' },
    { include: '#terminal' },
    { include: '#operator' },
    { include: '#rule' },
  ],
  repository: {
    comment: {
      name: 'comment.line.number-sign.ebnf',
      match: '#[^\\n]*$',
    },
    terminal: {
      name: 'string.quoted.single.ebnf',
      match: "'(?:[^'\\\\]|\\\\.)*'",
    },
    operator: {
      name: 'keyword.operator.ebnf',
      match: '[=|()\\[\\]{}]|[*+?]',
    },
    rule: {
      name: 'entity.name.function.rule.ebnf',
      match: '^[A-Za-z_][\\w-]*(?=\\s*=)',
    },
  },
};
